import test from "node:test";
import assert from "node:assert/strict";
import {
  createAnalysisRun,
  createGame,
  createMemoryDomainRepository,
  createPositionCacheKey,
  createPositionEvaluation,
  executeStoredAnalysisJob,
  STANDARD_INITIAL_FEN,
} from "./index.js";

const NOW = "2026-07-26T11:00:00.000Z";
const ENGINE = { name: "Stockfish", version: "18" };
const SETTINGS = { depth: 8, multiPv: 1, uciOptions: { Hash: 16 } };
const PGN = [
  '[Event "Test"]',
  '[White "Ana"]',
  '[Black "Marko"]',
  '[Result "1-0"]',
  "",
  "1. e4 e5 1-0",
].join("\n");

function game() {
  return createGame(
    {
      id: "game-1",
      title: "Test partija",
      rawPgn: PGN,
      headers: { White: "Ana", Black: "Marko", Result: "1-0" },
      players: {},
      result: "1-0",
      source: { kind: "migration" },
      fingerprint: "sha256:game-1",
    },
    { now: NOW },
  );
}

function run(status = "queued", progress = { completed: 0, total: 3 }) {
  return createAnalysisRun(
    {
      id: `run-${status}`,
      gameIds: ["game-1"],
      engine: ENGINE,
      settings: SETTINGS,
      status,
      progress,
      completedAt: status === "completed" ? NOW : null,
      error: status === "failed" ? "Prethodni kvar" : null,
    },
    { now: NOW },
  );
}

function repository(analysisRun, evaluations = [], games = [game()]) {
  return createMemoryDomainRepository({
    schemaVersion: 1,
    players: [],
    games,
    analysisRuns: [analysisRun],
    moveAnalyses: [],
    positionEvaluations: evaluations,
    trainingTasks: [],
    trainingAttempts: [],
  });
}

class FakeStockfishClient {
  constructor(options = {}) {
    this.initializeCalls = 0;
    this.analysisCalls = [];
    this.cancelCalls = 0;
    this.abortController = options.abortController || null;
  }

  async initialize() {
    this.initializeCalls += 1;
  }

  async analyzeFen(fen, config) {
    this.analysisCalls.push({ fen, config });

    if (this.abortController && this.analysisCalls.length === 1) {
      this.abortController.abort();
      const error = new Error("Otkazano u fake klijentu");
      error.code = "analysis-cancelled";
      throw error;
    }

    return {
      bestMove: "e2e4",
      lines: [
        {
          multiPv: 1,
          depth: config.depth,
          whiteScore: {
            type: "cp",
            value: 20,
            perspective: "white",
          },
          pv: ["e2e4"],
        },
      ],
    };
  }

  async cancelAnalysis() {
    this.cancelCalls += 1;
    return true;
  }
}

test("queued spremljeni posao prolazi do completed statusa", async () => {
  const domainRepository = repository(run());
  const client = new FakeStockfishClient();
  const progress = [];
  const result = await executeStoredAnalysisJob({
    repository: domainRepository,
    stockfishClient: client,
    runId: "run-queued",
    now: () => NOW,
    onProgress: (update) => progress.push(update.completed),
  });

  assert.equal(result.run.status, "completed");
  assert.deepEqual(result.run.progress, { completed: 3, total: 3 });
  assert.equal(client.analysisCalls.length, 3);
  assert.deepEqual(progress, [1, 2, 3]);
  assert.equal(
    (await domainRepository.getAnalysisRun("run-queued")).status,
    "completed",
  );
});

test("failed posao koristi kompatibilni cache i analizira samo ostatak", async () => {
  const cacheKey = await createPositionCacheKey({
    fen: STANDARD_INITIAL_FEN,
    engine: ENGINE,
    settings: SETTINGS,
  });
  const evaluation = createPositionEvaluation(
    {
      id: "cached-initial",
      cacheKey,
      fen: STANDARD_INITIAL_FEN,
      engine: ENGINE,
      settings: SETTINGS,
      lines: [
        {
          multiPv: 1,
          depth: 8,
          score: { type: "cp", value: 15, perspective: "white" },
          bestMove: "e2e4",
          pv: ["e2e4"],
        },
      ],
    },
    { now: NOW },
  );
  const domainRepository = repository(
    run("failed", { completed: 1, total: 3 }),
    [evaluation],
  );
  const client = new FakeStockfishClient();
  const result = await executeStoredAnalysisJob({
    repository: domainRepository,
    stockfishClient: client,
    runId: "run-failed",
    now: () => NOW,
  });

  assert.equal(result.cacheHits, 1);
  assert.equal(result.analyzed, 2);
  assert.equal(client.analysisCalls.length, 2);
});

test("running i completed poslovi ne pokrecu klijent", async () => {
  for (const status of ["running", "completed"]) {
    const domainRepository = repository(
      run(status, { completed: status === "completed" ? 3 : 1, total: 3 }),
    );
    const client = new FakeStockfishClient();

    await assert.rejects(
      executeStoredAnalysisJob({
        repository: domainRepository,
        stockfishClient: client,
        runId: `run-${status}`,
        now: () => NOW,
      }),
      (error) =>
        error.code ===
        (status === "running" ? "active-run" : "already-completed"),
    );
    assert.equal(client.initializeCalls, 0);
  }
});

test("nedostajuca povezana partija blokira izvrsavanje", async () => {
  const domainRepository = repository(
    run("failed", { completed: 0, total: 1 }),
    [],
    [],
  );
  const client = new FakeStockfishClient();

  await assert.rejects(
    executeStoredAnalysisJob({
      repository: domainRepository,
      stockfishClient: client,
      runId: "run-failed",
      now: () => NOW,
    }),
    (error) => error.code === "invalid-targets",
  );
  assert.equal(client.initializeCalls, 0);
});

test("otkazivanje sprema cancelled status i oslobada posao za novi pokusaj", async () => {
  const domainRepository = repository(run());
  const controller = new AbortController();
  const cancellingClient = new FakeStockfishClient({
    abortController: controller,
  });

  await assert.rejects(
    executeStoredAnalysisJob({
      repository: domainRepository,
      stockfishClient: cancellingClient,
      runId: "run-queued",
      signal: controller.signal,
      now: () => NOW,
    }),
    (error) => error.code === "analysis-cancelled",
  );
  assert.equal(
    (await domainRepository.getAnalysisRun("run-queued")).status,
    "cancelled",
  );

  const retryClient = new FakeStockfishClient();
  const retried = await executeStoredAnalysisJob({
    repository: domainRepository,
    stockfishClient: retryClient,
    runId: "run-queued",
    now: () => NOW,
  });
  assert.equal(retried.run.status, "completed");
});

