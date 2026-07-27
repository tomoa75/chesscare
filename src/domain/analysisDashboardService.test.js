import test from "node:test";
import assert from "node:assert/strict";
import {
  createAnalysisRun,
  createGame,
  createMemoryDomainRepository,
  createPositionCacheKey,
  createPositionEvaluation,
  createPositionTimeline,
  createLineFromPgn,
  loadAnalysisJobsDashboard,
} from "./index.js";

const NOW = "2026-07-26T09:00:00.000Z";
const PGN = [
  '[Event "Test"]',
  '[White "Ana"]',
  '[Black "Marko"]',
  '[Result "1-0"]',
  "",
  "1. e4 e5 1-0",
].join("\n");
const ENGINE = { name: "Stockfish", version: "18" };
const SETTINGS = { depth: 8, multiPv: 1, uciOptions: { Hash: 16 } };

function game(id = "game-1", rawPgn = PGN) {
  return createGame(
    {
      id,
      title: `Partija ${id}`,
      rawPgn,
      headers: { White: "Ana", Black: "Marko", Result: "1-0" },
      players: {},
      result: "1-0",
      source: { kind: "migration" },
      fingerprint: `sha256:${id}`,
    },
    { now: NOW },
  );
}

function run(id, status, progress, gameIds = ["game-1"]) {
  return createAnalysisRun(
    {
      id,
      gameIds,
      engine: ENGINE,
      settings: SETTINGS,
      status,
      progress,
      completedAt: status === "completed" ? NOW : null,
      error: status === "failed" ? "Prekinuta analiza" : null,
    },
    { now: NOW },
  );
}

function baseSnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    players: [],
    games: [game()],
    analysisRuns: [],
    moveAnalyses: [],
    positionEvaluations: [],
    trainingTasks: [],
    trainingAttempts: [],
    ...overrides,
  };
}

test("queued posao izvodi ciljne pozicije iz povezanog PGN-a", async () => {
  const repository = createMemoryDomainRepository(
    baseSnapshot({
      analysisRuns: [run("queued", "queued", { completed: 0, total: 0 })],
    }),
  );
  const dashboard = await loadAnalysisJobsDashboard({ repository });
  const job = dashboard.jobs[0];

  assert.equal(job.targets.total, 3);
  assert.equal(job.targets.remaining, 3);
  assert.equal(job.resume.allowed, true);
  assert.equal(job.resume.code, "ready-to-start");
  assert.equal(job.games[0].title, "Partija game-1");
});

test("failed i cancelled posao s jednakim brojem ciljeva mogu se nastaviti", async () => {
  const repository = createMemoryDomainRepository(
    baseSnapshot({
      analysisRuns: [
        run("failed", "failed", { completed: 1, total: 3 }),
        run("cancelled", "cancelled", { completed: 2, total: 3 }),
      ],
    }),
  );
  const dashboard = await loadAnalysisJobsDashboard({ repository });

  assert.equal(dashboard.jobs.every((job) => job.resume.allowed), true);
  assert.equal(
    dashboard.jobs.every((job) => job.resume.code === "ready-to-resume"),
    true,
  );
  assert.equal(dashboard.summary.resumable, 2);
});

test("running, completed i posao s promijenjenim brojem ciljeva nisu sigurni", async () => {
  const repository = createMemoryDomainRepository(
    baseSnapshot({
      analysisRuns: [
        run("running", "running", { completed: 1, total: 3 }),
        run("completed", "completed", { completed: 3, total: 3 }),
        run("mismatch", "failed", { completed: 1, total: 4 }),
      ],
    }),
  );
  const dashboard = await loadAnalysisJobsDashboard({ repository });
  const byId = new Map(dashboard.jobs.map((job) => [job.id, job]));

  assert.equal(byId.get("running").resume.code, "active-run");
  assert.equal(byId.get("completed").resume.code, "already-completed");
  assert.equal(
    byId.get("mismatch").resume.code,
    "target-count-mismatch",
  );
});

test("nedostajuca partija i neispravan PGN blokiraju nastavak", async () => {
  const repository = createMemoryDomainRepository(
    baseSnapshot({
      games: [game("broken", "nije valjani PGN")],
      analysisRuns: [
        run("missing", "failed", { completed: 0, total: 1 }, [
          "missing-game",
        ]),
        run("broken", "queued", { completed: 0, total: 0 }, ["broken"]),
      ],
    }),
  );
  const dashboard = await loadAnalysisJobsDashboard({ repository });
  const byId = new Map(dashboard.jobs.map((job) => [job.id, job]));

  assert.equal(byId.get("missing").warnings[0].code, "missing-game");
  assert.equal(byId.get("missing").resume.allowed, false);
  assert.equal(byId.get("broken").warnings[0].code, "invalid-game-pgn");
  assert.equal(byId.get("broken").resume.allowed, false);
});

test("kompatibilna evaluacija se prepoznaje kao cache pogodak", async () => {
  const line = createLineFromPgn(PGN);
  const firstFen = createPositionTimeline(line.moves, {
    initialFen: line.initialFen,
  })[0].fen;
  const cacheKey = await createPositionCacheKey({
    fen: firstFen,
    engine: ENGINE,
    settings: SETTINGS,
  });
  const evaluation = createPositionEvaluation(
    {
      id: "evaluation-1",
      cacheKey,
      fen: firstFen,
      engine: ENGINE,
      settings: SETTINGS,
      lines: [
        {
          multiPv: 1,
          depth: 8,
          score: { type: "cp", value: 20, perspective: "white" },
          bestMove: "e2e4",
          pv: ["e2e4"],
        },
      ],
    },
    { now: NOW },
  );
  const repository = createMemoryDomainRepository(
    baseSnapshot({
      analysisRuns: [run("failed", "failed", { completed: 1, total: 3 })],
      positionEvaluations: [evaluation],
    }),
  );
  const dashboard = await loadAnalysisJobsDashboard({ repository });

  assert.equal(dashboard.jobs[0].targets.cached, 1);
  assert.equal(dashboard.jobs[0].targets.remaining, 2);
  assert.equal(dashboard.summary.cachedPositions, 1);
});

