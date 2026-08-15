import { Chess } from "chess.js";
import {
  createAnalysisRun,
  createPositionEvaluation,
} from "./analysis.js";
import { sha256Hex, stableStringify } from "./stableHash.js";

export class AnalysisJobError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "AnalysisJobError";
    this.code = code;
  }
}

function requireEngine(engine) {
  if (
    !engine ||
    typeof engine.name !== "string" ||
    !engine.name.trim() ||
    typeof engine.version !== "string" ||
    !engine.version.trim()
  ) {
    throw new TypeError("Engine mora imati naziv i verziju.");
  }

  return {
    name: engine.name.trim(),
    version: engine.version.trim(),
  };
}

function requireSettings(settings) {
  if (
    !settings ||
    !Number.isInteger(settings.depth) ||
    settings.depth < 1 ||
    !Number.isInteger(settings.multiPv ?? 1) ||
    (settings.multiPv ?? 1) < 1
  ) {
    throw new TypeError("Postavke analize nisu valjane.");
  }

  const uciOptions = settings.uciOptions ?? {};
  if (!uciOptions || typeof uciOptions !== "object" || Array.isArray(uciOptions)) {
    throw new TypeError("UCI postavke moraju biti objekt.");
  }

  return {
    depth: settings.depth,
    multiPv: settings.multiPv ?? 1,
    uciOptions: Object.fromEntries(
      Object.entries(uciOptions).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
}

function canonicalFen(fen) {
  try {
    return new Chess(fen).fen();
  } catch (error) {
    throw new AnalysisJobError(
      "invalid-fen",
      "Pozicija za analizu nema valjani FEN.",
      { cause: error },
    );
  }
}

export async function createPositionCacheKey(input) {
  const descriptor = {
    schemaVersion: 1,
    fen: canonicalFen(input?.fen),
    engine: requireEngine(input?.engine),
    settings: requireSettings(input?.settings),
  };

  return `position-sha256:${await sha256Hex(stableStringify(descriptor))}`;
}

async function createTargets(positions, engine, settings) {
  if (!Array.isArray(positions)) {
    throw new TypeError("Pozicije za analizu moraju biti polje.");
  }

  const byCacheKey = new Map();

  for (const position of positions) {
    const fen = canonicalFen(
      typeof position === "string" ? position : position?.fen,
    );
    const cacheKey = await createPositionCacheKey({
      fen,
      engine,
      settings,
    });

    if (!byCacheKey.has(cacheKey)) {
      byCacheKey.set(cacheKey, { cacheKey, fen });
    }
  }

  return Array.from(byCacheKey.values());
}

function cachedLinesFromResult(result, settings) {
  if (!Array.isArray(result?.lines) || result.lines.length === 0) {
    throw new AnalysisJobError(
      "missing-engine-evaluation",
      "Stockfish nije vratio nijednu evaluacijsku liniju.",
    );
  }

  return result.lines.map((line, index) => ({
    multiPv: line.multiPv ?? index + 1,
    depth: line.depth ?? settings.depth,
    score: line.whiteScore,
    bestMove: line.pv?.[0] || result.bestMove || null,
    pv: line.pv || [],
  }));
}

function updateRun(run, changes) {
  return createAnalysisRun({
    ...run,
    ...changes,
    progress: changes.progress || run.progress,
  });
}

function cancellationError() {
  return new AnalysisJobError(
    "analysis-cancelled",
    "Batch analiza je otkazana.",
  );
}

export async function runPositionAnalysisJob(options) {
  const {
    repository,
    stockfishClient,
    positions,
    signal,
    onProgress,
  } = options;
  const now = options.now || (() => new Date().toISOString());

  if (
    !repository ||
    typeof repository.readSnapshot !== "function" ||
    typeof repository.saveAnalysisRun !== "function" ||
    typeof repository.savePositionEvaluation !== "function"
  ) {
    throw new TypeError("Repozitorij ne podrzava analiticke poslove.");
  }
  if (
    !stockfishClient ||
    typeof stockfishClient.initialize !== "function" ||
    typeof stockfishClient.analyzeFen !== "function"
  ) {
    throw new TypeError("Stockfish klijent nije valjan.");
  }

  let run = createAnalysisRun(options.run);
  const targets = await createTargets(positions, run.engine, run.settings);
  const snapshot = await repository.readSnapshot();
  const cachedByKey = new Map(
    snapshot.positionEvaluations.map((evaluation) => [
      evaluation.cacheKey,
      evaluation,
    ]),
  );
  const resultsByKey = new Map();
  const missingTargets = [];
  const forceRefresh = run.forceRefresh === true;

  for (const target of targets) {
    const cached = forceRefresh ? null : cachedByKey.get(target.cacheKey);
    if (cached) {
      resultsByKey.set(target.cacheKey, cached);
    } else {
      missingTargets.push(target);
    }
  }

  let completed = resultsByKey.size;
  let analyzed = 0;
  const startedAt = run.startedAt || now();
  run = updateRun(run, {
    status: "running",
    startedAt,
    completedAt: null,
    error: null,
    progress: { completed, total: targets.length },
  });
  await repository.saveAnalysisRun(run);

  const handleAbort = () => {
    void stockfishClient.cancelAnalysis?.();
  };
  signal?.addEventListener?.("abort", handleAbort, { once: true });

  try {
    if (signal?.aborted) throw cancellationError();

    if (missingTargets.length > 0) {
      await stockfishClient.initialize({
        multiPv: run.settings.multiPv,
        uciOptions: run.settings.uciOptions,
      });
    }

    for (const target of missingTargets) {
      if (signal?.aborted) throw cancellationError();

      const result = await stockfishClient.analyzeFen(target.fen, {
        depth: run.settings.depth,
      });
      const evaluation = createPositionEvaluation(
        {
          id: `position-evaluation-${target.cacheKey.split(":")[1]}`,
          cacheKey: target.cacheKey,
          fen: target.fen,
          engine: run.engine,
          settings: run.settings,
          lines: cachedLinesFromResult(result, run.settings),
        },
        { now: now() },
      );

      await repository.savePositionEvaluation(evaluation);
      resultsByKey.set(target.cacheKey, evaluation);
      analyzed += 1;
      completed += 1;
      run = updateRun(run, {
        progress: { completed, total: targets.length },
      });
      await repository.saveAnalysisRun(run);
      onProgress?.({
        run,
        completed,
        total: targets.length,
        cacheHits: targets.length - missingTargets.length,
        analyzed,
      });
    }

    run = updateRun(run, {
      status: "completed",
      completedAt: now(),
      progress: { completed: targets.length, total: targets.length },
    });
    await repository.saveAnalysisRun(run);

    return {
      run,
      evaluations: targets.map((target) => resultsByKey.get(target.cacheKey)),
      cacheHits: targets.length - missingTargets.length,
      analyzed,
    };
  } catch (error) {
    const cancelled =
      signal?.aborted || error?.code === "analysis-cancelled";
    run = updateRun(run, {
      status: cancelled ? "cancelled" : "failed",
      completedAt: null,
      error: cancelled ? null : String(error?.message || error),
      progress: { completed, total: targets.length },
    });
    await repository.saveAnalysisRun(run);
    throw cancelled ? cancellationError() : error;
  } finally {
    signal?.removeEventListener?.("abort", handleAbort);
  }
}
