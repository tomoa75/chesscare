import test from "node:test";
import assert from "node:assert/strict";
import {
  createAnalysisRun,
  createMemoryDomainRepository,
  createPositionCacheKey,
  replayMoves,
  runPositionAnalysisJob,
  STANDARD_INITIAL_FEN,
} from "./index.js";

const NOW = "2026-07-25T16:00:00.000Z";
const AFTER_E4_FEN = replayMoves(["e4"]).fen();

function analysisRun(id, options = {}) {
  return createAnalysisRun(
    {
      id,
      gameIds: ["game-1"],
      engine: {
        name: "Stockfish",
        version: options.engineVersion || "18",
      },
      settings: {
        depth: options.depth || 8,
        multiPv: options.multiPv || 1,
        uciOptions: options.uciOptions || { Hash: 16 },
      },
      status: "queued",
      progress: { completed: 0, total: 0 },
    },
    { now: NOW },
  );
}

class FakeStockfishClient {
  constructor(options = {}) {
    this.initializeCalls = [];
    this.analysisCalls = [];
    this.cancelCalls = 0;
    this.failAtCall = options.failAtCall ?? null;
  }

  async initialize(config) {
    this.initializeCalls.push(config);
  }

  async analyzeFen(fen, config) {
    this.analysisCalls.push({ fen, config });

    if (this.analysisCalls.length === this.failAtCall) {
      throw new Error("Simulirani kvar enginea");
    }

    return {
      bestMove: null,
      lines: [
        {
          multiPv: 1,
          depth: config.depth,
          whiteScore: {
            type: "cp",
            value: fen === STANDARD_INITIAL_FEN ? 20 : 10,
            perspective: "white",
          },
          pv: [],
        },
      ],
    };
  }

  async cancelAnalysis() {
    this.cancelCalls += 1;
    return true;
  }
}

test("cache kljuc je stabilan za redoslijed UCI opcija", async () => {
  const first = await createPositionCacheKey({
    fen: STANDARD_INITIAL_FEN,
    engine: { name: "Stockfish", version: "18" },
    settings: {
      depth: 10,
      multiPv: 2,
      uciOptions: { Threads: 1, Hash: 32 },
    },
  });
  const second = await createPositionCacheKey({
    fen: STANDARD_INITIAL_FEN,
    engine: { name: "Stockfish", version: "18" },
    settings: {
      depth: 10,
      multiPv: 2,
      uciOptions: { Hash: 32, Threads: 1 },
    },
  });

  assert.equal(first, second);
  assert.match(first, /^position-sha256:[a-f0-9]{64}$/);
});

test("dubina, verzija enginea i UCI postavke mijenjaju cache kljuc", async () => {
  const base = {
    fen: STANDARD_INITIAL_FEN,
    engine: { name: "Stockfish", version: "18" },
    settings: { depth: 8, multiPv: 1, uciOptions: { Hash: 16 } },
  };
  const keys = await Promise.all([
    createPositionCacheKey(base),
    createPositionCacheKey({
      ...base,
      settings: { ...base.settings, depth: 9 },
    }),
    createPositionCacheKey({
      ...base,
      engine: { ...base.engine, version: "19" },
    }),
    createPositionCacheKey({
      ...base,
      settings: { ...base.settings, uciOptions: { Hash: 32 } },
    }),
  ]);

  assert.equal(new Set(keys).size, 4);
});

test("batch deduplicira pozicije i sprema napredak nakon svake analize", async () => {
  const repository = createMemoryDomainRepository();
  const client = new FakeStockfishClient();
  const progress = [];
  const result = await runPositionAnalysisJob({
    repository,
    stockfishClient: client,
    run: analysisRun("run-1"),
    positions: [STANDARD_INITIAL_FEN, STANDARD_INITIAL_FEN, AFTER_E4_FEN],
    now: () => NOW,
    onProgress: (update) => progress.push(update),
  });

  assert.equal(result.run.status, "completed");
  assert.deepEqual(result.run.progress, { completed: 2, total: 2 });
  assert.equal(result.cacheHits, 0);
  assert.equal(result.analyzed, 2);
  assert.equal(result.evaluations.length, 2);
  assert.equal(client.initializeCalls.length, 1);
  assert.equal(client.analysisCalls.length, 2);
  assert.deepEqual(
    progress.map((update) => update.completed),
    [1, 2],
  );
  assert.equal((await repository.listPositionEvaluations()).length, 2);
  assert.equal(
    (await repository.getAnalysisRun("run-1")).status,
    "completed",
  );
});

test("ponovljeni posao koristi cache i ne pokrece engine", async () => {
  const repository = createMemoryDomainRepository();
  const firstClient = new FakeStockfishClient();
  const positions = [STANDARD_INITIAL_FEN, AFTER_E4_FEN];

  await runPositionAnalysisJob({
    repository,
    stockfishClient: firstClient,
    run: analysisRun("cache-prvi"),
    positions,
    now: () => NOW,
  });

  const cachedClient = new FakeStockfishClient();
  const cached = await runPositionAnalysisJob({
    repository,
    stockfishClient: cachedClient,
    run: analysisRun("cache-drugi"),
    positions,
    now: () => NOW,
  });

  assert.equal(cached.cacheHits, 2);
  assert.equal(cached.analyzed, 0);
  assert.equal(cachedClient.initializeCalls.length, 0);
  assert.equal(cachedClient.analysisCalls.length, 0);
});

test("promjena dubine ne koristi nekompatibilan cache", async () => {
  const repository = createMemoryDomainRepository();
  const firstClient = new FakeStockfishClient();

  await runPositionAnalysisJob({
    repository,
    stockfishClient: firstClient,
    run: analysisRun("depth-8", { depth: 8 }),
    positions: [STANDARD_INITIAL_FEN],
    now: () => NOW,
  });

  const deeperClient = new FakeStockfishClient();
  const deeper = await runPositionAnalysisJob({
    repository,
    stockfishClient: deeperClient,
    run: analysisRun("depth-12", { depth: 12 }),
    positions: [STANDARD_INITIAL_FEN],
    now: () => NOW,
  });

  assert.equal(deeper.cacheHits, 0);
  assert.equal(deeper.analyzed, 1);
  assert.equal(deeperClient.analysisCalls[0].config.depth, 12);
  assert.equal((await repository.listPositionEvaluations()).length, 2);
});

test("kvar cuva djelomicni napredak, a novi posao nastavlja iz cachea", async () => {
  const repository = createMemoryDomainRepository();
  const failingClient = new FakeStockfishClient({ failAtCall: 2 });
  const positions = [STANDARD_INITIAL_FEN, AFTER_E4_FEN];

  await assert.rejects(
    runPositionAnalysisJob({
      repository,
      stockfishClient: failingClient,
      run: analysisRun("failed-run"),
      positions,
      now: () => NOW,
    }),
    /Simulirani kvar enginea/,
  );

  const failedRun = await repository.getAnalysisRun("failed-run");
  assert.equal(failedRun.status, "failed");
  assert.deepEqual(failedRun.progress, { completed: 1, total: 2 });
  assert.match(failedRun.error, /Simulirani kvar enginea/);
  assert.equal((await repository.listPositionEvaluations()).length, 1);

  const resumedClient = new FakeStockfishClient();
  const resumed = await runPositionAnalysisJob({
    repository,
    stockfishClient: resumedClient,
    run: analysisRun("resumed-run"),
    positions,
    now: () => NOW,
  });

  assert.equal(resumed.cacheHits, 1);
  assert.equal(resumed.analyzed, 1);
  assert.equal(resumed.run.status, "completed");
  assert.equal(resumedClient.analysisCalls.length, 1);
});

test("vec otkazan signal sprema cancelled status bez pokretanja enginea", async () => {
  const repository = createMemoryDomainRepository();
  const client = new FakeStockfishClient();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    runPositionAnalysisJob({
      repository,
      stockfishClient: client,
      run: analysisRun("cancelled-run"),
      positions: [STANDARD_INITIAL_FEN],
      signal: controller.signal,
      now: () => NOW,
    }),
    (error) => error.code === "analysis-cancelled",
  );

  const cancelledRun = await repository.getAnalysisRun("cancelled-run");
  assert.equal(cancelledRun.status, "cancelled");
  assert.deepEqual(cancelledRun.progress, { completed: 0, total: 1 });
  assert.equal(client.initializeCalls.length, 0);
  assert.equal(client.analysisCalls.length, 0);
});

