import test from "node:test";
import assert from "node:assert/strict";
import {
  createStockfishClient,
  parseUciBestMove,
  parseUciInfo,
  scoreToWhitePerspective,
  STANDARD_INITIAL_FEN,
  uciMoveToSan,
  uciPvToSan,
} from "./index.js";

class FakeWorker {
  constructor() {
    this.messages = [];
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
  }

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(message) {
    this.onmessage?.({ data: message });
  }

  fail(error = new Error("worker failure")) {
    this.onerror?.({ error });
  }
}

function createTimerController() {
  let nextId = 1;
  const callbacks = new Map();

  return {
    setTimer(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    clearTimer(id) {
      callbacks.delete(id);
    },
    runAll() {
      const pending = Array.from(callbacks.values());
      callbacks.clear();
      pending.forEach((callback) => callback());
    },
    size() {
      return callbacks.size;
    },
  };
}

function createClientHarness(options = {}) {
  const workers = [];
  const client = createStockfishClient({
    workerUrl: "/stockfish.js",
    timeoutMs: 1000,
    workerFactory(url) {
      assert.equal(url, "/stockfish.js");
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    ...options,
  });

  return { client, workers };
}

test("UCI info parser cuva si side-to-move i bijelu perspektivu", () => {
  const fenAfterE4 =
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
  const parsed = parseUciInfo(
    "info depth 12 seldepth 18 multipv 2 score cp 34 nodes 1500 pv e7e5 g1f3",
    fenAfterE4,
  );

  assert.deepEqual(parsed.score, {
    type: "cp",
    value: 34,
    perspective: "side-to-move",
  });
  assert.deepEqual(parsed.whiteScore, {
    type: "cp",
    value: -34,
    perspective: "white",
  });
  assert.equal(parsed.depth, 12);
  assert.equal(parsed.selectiveDepth, 18);
  assert.equal(parsed.multiPv, 2);
  assert.equal(parsed.nodes, 1500);
  assert.deepEqual(parsed.pv, ["e7e5", "g1f3"]);
  assert.equal(parseUciInfo("info depth 12 nodes 10", fenAfterE4), null);
});

test("mate score i bestmove parser zadrzavaju strukturirane vrijednosti", () => {
  assert.deepEqual(
    scoreToWhitePerspective(
      { type: "mate", value: 3 },
      STANDARD_INITIAL_FEN,
    ),
    { type: "mate", value: 3, perspective: "white" },
  );
  assert.deepEqual(parseUciBestMove("bestmove e2e4 ponder e7e5"), {
    bestMove: "e2e4",
    ponder: "e7e5",
  });
  assert.deepEqual(parseUciBestMove("bestmove (none)"), {
    bestMove: null,
    ponder: null,
  });
  assert.equal(parseUciBestMove("info depth 1"), null);
});

test("mate nula cuva pobjednicku perspektivu na matiranoj poziciji", () => {
  const blackIsMated =
    "7k/6Q1/6K1/8/8/8/8/8 b - - 0 1";
  const whiteIsMated =
    "8/8/8/8/8/6k1/6q1/7K w - - 0 1";

  assert.deepEqual(
    scoreToWhitePerspective(
      { type: "mate", value: 0 },
      blackIsMated,
    ),
    { type: "mate", value: 1, perspective: "white" },
  );
  assert.deepEqual(
    scoreToWhitePerspective(
      { type: "mate", value: 0 },
      whiteIsMated,
    ),
    { type: "mate", value: -1, perspective: "white" },
  );
});

test("UCI potezi i PV pretvaraju se u SAN bez rusenja na losem unosu", () => {
  assert.equal(uciMoveToSan(STANDARD_INITIAL_FEN, "e2e4"), "e4");
  assert.equal(uciMoveToSan(STANDARD_INITIAL_FEN, "nije-potez"), "nije-potez");
  assert.deepEqual(
    uciPvToSan(STANDARD_INITIAL_FEN, ["e2e4", "e7e5", "g1f3"]),
    ["e4", "e5", "Nf3"],
  );
  assert.deepEqual(
    uciPvToSan(STANDARD_INITIAL_FEN, ["e2e4", "lose"]),
    ["e2e4", "lose"],
  );
});

test("klijent izvodi UCI handshake i MultiPV konfiguraciju", async () => {
  const { client, workers } = createClientHarness();
  const initialized = client.initialize({
    multiPv: 3,
    uciOptions: { Hash: 32 },
  });
  const worker = workers[0];

  assert.deepEqual(worker.messages, ["uci"]);
  worker.emit("uciok");
  assert.deepEqual(worker.messages, [
    "uci",
    "setoption name Hash value 32",
    "setoption name MultiPV value 3",
    "isready",
  ]);
  worker.emit("readyok");
  await initialized;

  assert.equal(client.isReady(), true);
  assert.equal(client.isAnalyzing(), false);
});

test("analiza prikuplja MultiPV linije i zavrsava na bestmove", async () => {
  const infoUpdates = [];
  const { client, workers } = createClientHarness();
  const initialized = client.initialize({ multiPv: 2 });
  const worker = workers[0];
  worker.emit("uciok");
  worker.emit("readyok");
  await initialized;

  const analysis = client.analyzeFen(STANDARD_INITIAL_FEN, {
    depth: 10,
    onInfo: (info) => infoUpdates.push(info),
  });
  assert.deepEqual(worker.messages.slice(-2), [
    `position fen ${STANDARD_INITIAL_FEN}`,
    "go depth 10",
  ]);

  worker.emit(
    "info depth 8 multipv 2 score cp 10 nodes 100 pv d2d4 d7d5",
  );
  worker.emit(
    "info depth 10 multipv 1 score cp 25 nodes 200 pv e2e4 e7e5",
  );
  worker.emit(
    "info depth 10 multipv 2 score cp 12 nodes 220 pv d2d4 d7d5",
  );
  worker.emit("bestmove e2e4 ponder e7e5");
  const result = await analysis;

  assert.equal(infoUpdates.length, 3);
  assert.equal(result.bestMove, "e2e4");
  assert.equal(result.bestMoveSan, "e4");
  assert.equal(result.ponder, "e7e5");
  assert.deepEqual(
    result.lines.map((line) => [line.multiPv, line.depth, line.pvSan]),
    [
      [1, 10, ["e4", "e5"]],
      [2, 10, ["d4", "d5"]],
    ],
  );
});

test("otkazivanje salje stop, ceka bestmove i odbija aktivnu analizu", async () => {
  const { client, workers } = createClientHarness();
  const initialized = client.initialize();
  const worker = workers[0];
  worker.emit("uciok");
  worker.emit("readyok");
  await initialized;

  const analysis = client.analyzeFen(STANDARD_INITIAL_FEN, { depth: 8 });
  const rejected = assert.rejects(
    analysis,
    (error) => error.code === "analysis-cancelled",
  );
  const stopped = client.cancelAnalysis();

  assert.equal(worker.messages.at(-1), "stop");
  assert.equal(client.isAnalyzing(), true);
  worker.emit("bestmove e2e4");

  assert.equal(await stopped, true);
  await rejected;
  assert.equal(client.isAnalyzing(), false);
});

test("timeout otkazivanja terminira worker ako bestmove ne stigne", async () => {
  const timers = createTimerController();
  const { client, workers } = createClientHarness({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  const initialized = client.initialize();
  const worker = workers[0];
  worker.emit("uciok");
  worker.emit("readyok");
  await initialized;

  const analysis = client.analyzeFen(STANDARD_INITIAL_FEN, { depth: 8 });
  const rejected = assert.rejects(
    analysis,
    (error) => error.code === "cancellation-timeout",
  );
  const stopped = client.cancelAnalysis();

  assert.equal(timers.size(), 1);
  timers.runAll();

  assert.equal(await stopped, true);
  await rejected;
  assert.equal(worker.terminated, true);
  assert.equal(client.isAnalyzing(), false);
});

test("timeout terminira worker i ne ostavlja djelomicno spreman klijent", async () => {
  const timers = createTimerController();
  const { client, workers } = createClientHarness({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  const initialized = client.initialize();
  const worker = workers[0];

  assert.equal(timers.size(), 1);
  timers.runAll();
  await assert.rejects(
    initialized,
    (error) => error.code === "initialization-timeout",
  );
  assert.equal(worker.terminated, true);
  assert.equal(client.isReady(), false);
});

test("timeout aktivne analize salje stop, odbija posao i terminira worker", async () => {
  const timers = createTimerController();
  const { client, workers } = createClientHarness({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  const initialized = client.initialize();
  const worker = workers[0];
  worker.emit("uciok");
  worker.emit("readyok");
  await initialized;

  const analysis = client.analyzeFen(STANDARD_INITIAL_FEN, { depth: 14 });
  assert.equal(timers.size(), 1);
  timers.runAll();

  await assert.rejects(
    analysis,
    (error) => error.code === "analysis-timeout",
  );
  assert.equal(worker.messages.at(-1), "stop");
  assert.equal(worker.terminated, true);
  assert.equal(client.isReady(), false);
  assert.equal(client.isAnalyzing(), false);
});

test("worker greska odbija analizu, a dispose salje quit i terminira worker", async () => {
  const { client, workers } = createClientHarness();
  const initialized = client.initialize();
  const worker = workers[0];
  worker.emit("uciok");
  worker.emit("readyok");
  await initialized;

  const analysis = client.analyzeFen(STANDARD_INITIAL_FEN, { depth: 6 });
  worker.fail();
  await assert.rejects(
    analysis,
    (error) => error.code === "worker-error",
  );
  assert.equal(worker.terminated, true);

  const reinitialized = client.initialize();
  const nextWorker = workers[1];
  nextWorker.emit("uciok");
  nextWorker.emit("readyok");
  await reinitialized;
  client.dispose();

  assert.equal(nextWorker.messages.at(-1), "quit");
  assert.equal(nextWorker.terminated, true);
  assert.equal(client.isReady(), false);
  await assert.rejects(
    client.analyzeFen(STANDARD_INITIAL_FEN, { depth: 4 }),
    (error) => error.code === "client-disposed",
  );
});
