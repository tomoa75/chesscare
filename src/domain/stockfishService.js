import { Chess } from "chess.js";

export class StockfishServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "StockfishServiceError";
    this.code = code;
  }
}

function parseIntegerField(line, fieldName) {
  const match = line.match(new RegExp(`\\b${fieldName} (-?\\d+)`));
  return match ? Number(match[1]) : null;
}

function sideToMoveFromFen(fen) {
  try {
    return new Chess(fen).turn();
  } catch (error) {
    throw new StockfishServiceError(
      "invalid-fen",
      "FEN za Stockfish analizu nije valjan.",
      { cause: error },
    );
  }
}

export function scoreToWhitePerspective(score, fen) {
  if (
    !score ||
    !["cp", "mate"].includes(score.type) ||
    !Number.isFinite(score.value)
  ) {
    throw new TypeError("UCI evaluacija nije valjana.");
  }

  const sideToMove = sideToMoveFromFen(fen);
  const value =
    score.type === "mate" && score.value === 0
      ? sideToMove === "w"
        ? -1
        : 1
      : sideToMove === "w"
        ? score.value
        : -score.value;

  return {
    type: score.type,
    value,
    perspective: "white",
  };
}

export function parseUciInfo(line, fen) {
  if (typeof line !== "string" || !line.startsWith("info ")) return null;

  const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
  if (!scoreMatch) return null;

  const pvMatch = line.match(/\bpv (.+)$/);
  const score = {
    type: scoreMatch[1],
    value: Number(scoreMatch[2]),
    perspective: "side-to-move",
  };

  return {
    depth: parseIntegerField(line, "depth"),
    selectiveDepth: parseIntegerField(line, "seldepth"),
    multiPv: parseIntegerField(line, "multipv") ?? 1,
    nodes: parseIntegerField(line, "nodes"),
    score,
    whiteScore: scoreToWhitePerspective(score, fen),
    pv: pvMatch ? pvMatch[1].trim().split(/\s+/).filter(Boolean) : [],
    raw: line,
  };
}

export function parseUciBestMove(line) {
  if (typeof line !== "string") return null;

  const match = line.match(
    /^bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?/,
  );
  if (!match) return null;

  return {
    bestMove: match[1] === "(none)" ? null : match[1],
    ponder: match[2] || null,
  };
}

function uciMoveParts(move) {
  if (typeof move !== "string") return null;
  const match = move.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/i);

  if (!match) return null;

  return {
    from: match[1].toLowerCase(),
    to: match[2].toLowerCase(),
    promotion: match[3]?.toLowerCase(),
  };
}

export function uciMoveToSan(fen, move) {
  if (!move || move === "(none)") return "";
  const parts = uciMoveParts(move);
  if (!parts) return move;

  try {
    const chess = new Chess(fen);
    return chess.move(parts)?.san || move;
  } catch {
    return move;
  }
}

export function uciPvToSan(fen, moves) {
  const uciMoves = Array.isArray(moves)
    ? moves
    : String(moves || "").trim().split(/\s+/).filter(Boolean);

  try {
    const chess = new Chess(fen);

    return uciMoves.map((move) => {
      const parts = uciMoveParts(move);
      if (!parts) throw new Error("Neispravan UCI potez.");
      return chess.move(parts)?.san || move;
    });
  } catch {
    return uciMoves;
  }
}

function requireWorkerFactory(workerFactory) {
  if (typeof workerFactory !== "function") {
    throw new TypeError("workerFactory mora biti funkcija.");
  }
  return workerFactory;
}

function requirePositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${fieldName} mora biti pozitivan cijeli broj.`);
  }
  return value;
}

export function createStockfishClient(options = {}) {
  const workerFactory = requireWorkerFactory(options.workerFactory);
  const setTimer = options.setTimer || globalThis.setTimeout;
  const clearTimer = options.clearTimer || globalThis.clearTimeout;
  const defaultTimeoutMs = options.timeoutMs ?? 15000;
  let worker = null;
  let ready = false;
  let disposed = false;
  let initializePending = null;
  let analysisPending = null;
  let configuredMultiPv = 1;

  function clearPendingTimer(pending) {
    if (pending?.timer !== null) {
      clearTimer(pending.timer);
      pending.timer = null;
    }
  }

  function terminateWorker() {
    worker?.terminate?.();
    worker = null;
    ready = false;
  }

  function failInitialization(error) {
    if (!initializePending) return;
    clearPendingTimer(initializePending);
    initializePending.reject(error);
    initializePending = null;
    terminateWorker();
  }

  function failAnalysis(error, terminate = false) {
    if (!analysisPending) return;
    clearPendingTimer(analysisPending);
    analysisPending.reject(error);
    analysisPending.stopResolve?.();
    analysisPending = null;
    if (terminate) terminateWorker();
  }

  function handleWorkerError(event) {
    const error = new StockfishServiceError(
      "worker-error",
      "Stockfish worker je prijavio gresku.",
      { cause: event?.error || event },
    );

    failInitialization(error);
    failAnalysis(error, true);
    if (!initializePending && !analysisPending) terminateWorker();
  }

  function handleMessage(event) {
    const line = String(event?.data ?? event);

    if (line === "uciok" && initializePending?.stage === "uci") {
      for (const [name, value] of Object.entries(
        initializePending.uciOptions,
      )) {
        worker.postMessage(`setoption name ${name} value ${value}`);
      }
      worker.postMessage(
        `setoption name MultiPV value ${configuredMultiPv}`,
      );
      initializePending.stage = "ready";
      worker.postMessage("isready");
      return;
    }

    if (line === "readyok" && initializePending?.stage === "ready") {
      clearPendingTimer(initializePending);
      ready = true;
      initializePending.resolve();
      initializePending = null;
      return;
    }

    if (!analysisPending) return;

    const info = parseUciInfo(line, analysisPending.fen);
    if (info) {
      analysisPending.lines.set(info.multiPv, info);
      analysisPending.onInfo?.(info);
      return;
    }

    const bestMove = parseUciBestMove(line);
    if (!bestMove) return;

    const pending = analysisPending;
    clearPendingTimer(pending);
    analysisPending = null;

    if (pending.cancelled) {
      pending.reject(
        new StockfishServiceError(
          "analysis-cancelled",
          "Stockfish analiza je otkazana.",
        ),
      );
      pending.stopResolve?.();
      return;
    }

    pending.resolve({
      ...bestMove,
      bestMoveSan: bestMove.bestMove
        ? uciMoveToSan(pending.fen, bestMove.bestMove)
        : "",
      lines: Array.from(pending.lines.values())
        .sort((left, right) => left.multiPv - right.multiPv)
        .map((item) => ({
          ...item,
          pvSan: uciPvToSan(pending.fen, item.pv),
        })),
    });
  }

  async function initialize(config = {}) {
    if (disposed) {
      throw new StockfishServiceError(
        "client-disposed",
        "Stockfish klijent je zatvoren.",
      );
    }
    if (ready) return;
    if (initializePending) return initializePending.promise;

    configuredMultiPv = requirePositiveInteger(
      config.multiPv ?? 1,
      "MultiPV",
    );
    const timeoutMs = requirePositiveInteger(
      config.timeoutMs ?? defaultTimeoutMs,
      "Timeout",
    );

    try {
      worker = workerFactory(options.workerUrl);
    } catch (error) {
      throw new StockfishServiceError(
        "worker-start-failed",
        "Stockfish worker se nije mogao pokrenuti.",
        { cause: error },
      );
    }

    if (
      !worker ||
      typeof worker.postMessage !== "function" ||
      typeof worker.terminate !== "function"
    ) {
      terminateWorker();
      throw new StockfishServiceError(
        "invalid-worker",
        "workerFactory nije vratio valjani worker.",
      );
    }

    worker.onmessage = handleMessage;
    worker.onerror = handleWorkerError;

    const promise = new Promise((resolve, reject) => {
      initializePending = {
        promise: null,
        resolve,
        reject,
        timer: null,
        stage: "uci",
        uciOptions: config.uciOptions || {},
      };
    });
    initializePending.promise = promise;
    initializePending.timer = setTimer(() => {
      failInitialization(
        new StockfishServiceError(
          "initialization-timeout",
          "Stockfish se nije javio na vrijeme.",
        ),
      );
    }, timeoutMs);
    worker.postMessage("uci");

    return promise;
  }

  function analyzeFen(fen, config = {}) {
    if (disposed) {
      return Promise.reject(
        new StockfishServiceError(
          "client-disposed",
          "Stockfish klijent je zatvoren.",
        ),
      );
    }
    if (!ready || !worker) {
      return Promise.reject(
        new StockfishServiceError(
          "client-not-ready",
          "Stockfish klijent nije spreman.",
        ),
      );
    }
    if (analysisPending) {
      return Promise.reject(
        new StockfishServiceError(
          "analysis-in-progress",
          "Stockfish vec analizira drugu poziciju.",
        ),
      );
    }

    sideToMoveFromFen(fen);
    const depth = requirePositiveInteger(config.depth, "Dubina");
    const timeoutMs = requirePositiveInteger(
      config.timeoutMs ?? defaultTimeoutMs,
      "Timeout",
    );
    const promise = new Promise((resolve, reject) => {
      analysisPending = {
        resolve,
        reject,
        timer: null,
        fen,
        lines: new Map(),
        onInfo: config.onInfo,
        cancelled: false,
        stopResolve: null,
      };
    });

    analysisPending.timer = setTimer(() => {
      worker?.postMessage("stop");
      failAnalysis(
        new StockfishServiceError(
          "analysis-timeout",
          "Stockfish analiza je prekoracila vremensko ogranicenje.",
        ),
        true,
      );
    }, timeoutMs);
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage(`go depth ${depth}`);

    return promise;
  }

  function cancelAnalysis() {
    if (!analysisPending || analysisPending.cancelled) {
      return Promise.resolve(false);
    }

    analysisPending.cancelled = true;
    clearPendingTimer(analysisPending);
    const stopped = new Promise((resolve) => {
      analysisPending.stopResolve = () => resolve(true);
    });
    analysisPending.timer = setTimer(() => {
      failAnalysis(
        new StockfishServiceError(
          "cancellation-timeout",
          "Stockfish nije potvrdio zaustavljanje na vrijeme.",
        ),
        true,
      );
    }, defaultTimeoutMs);
    worker.postMessage("stop");
    return stopped;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;

    const error = new StockfishServiceError(
      "client-disposed",
      "Stockfish klijent je zatvoren.",
    );
    failInitialization(error);
    failAnalysis(error);

    if (worker) {
      try {
        worker.postMessage("quit");
      } finally {
        terminateWorker();
      }
    }
  }

  return Object.freeze({
    initialize,
    analyzeFen,
    cancelAnalysis,
    dispose,
    isReady: () => ready,
    isAnalyzing: () => analysisPending !== null,
  });
}
