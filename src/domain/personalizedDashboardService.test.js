import test from "node:test";
import assert from "node:assert/strict";
import {
  createAnalysisRun,
  createGame,
  createMemoryDomainRepository,
  createMoveAnalysis,
  createPlayer,
  loadPersonalizedDashboard,
} from "./index.js";

const NOW = "2026-07-26T10:00:00.000Z";

function player(id, displayName) {
  return createPlayer(
    { id, displayName, aliases: [] },
    { now: NOW },
  );
}

function game(id, playerId, playedAt = null) {
  return createGame(
    {
      id,
      title: "Ana - Iva",
      rawPgn:
        '[White "Ana"]\n[Black "Iva"]\n[Result "1-0"]\n\n1. e4 e5 1-0',
      headers: {
        White: "Ana",
        Black: "Iva",
        Result: "1-0",
        Opening: "Open Game",
        ...(playedAt ? { Date: playedAt } : {}),
      },
      players: { whitePlayerId: playerId, blackPlayerId: null },
      result: "1-0",
      source: { kind: "migration" },
    },
    { now: NOW },
  );
}

function run(id, gameId, completedAt = NOW) {
  return createAnalysisRun(
    {
      id,
      gameIds: [gameId],
      engine: { name: "Stockfish", version: "18" },
      settings: { depth: 12, multiPv: 1, uciOptions: {} },
      status: "completed",
      progress: { completed: 2, total: 2 },
      completedAt,
    },
    { now: NOW },
  );
}

function move(id, playerId, gameId, runId, overrides = {}) {
  return createMoveAnalysis({
    id,
    analysisRunId: runId,
    gameId,
    playerId,
    ply: overrides.ply || 1,
    color: overrides.color || "white",
    phase: overrides.phase || "opening",
    beforeFen: "before",
    afterFen: "after",
    playedMove: { san: "e4", uci: "e2e4" },
    bestMove: { san: "d4", uci: "d2d4" },
    beforeEvaluation: { type: "cp", value: 20 },
    afterEvaluation: { type: "cp", value: -80 },
    centipawnLoss: overrides.loss ?? 100,
    classification: overrides.classification || "mistake",
  });
}

function repositoryFixture() {
  const ana = player("player-ana", "Ana");
  const ivo = player("player-ivo", "Ivo");
  const analyzedGame = game("game-1", ana.id);
  const analysisRun = run("run-1", analyzedGame.id);

  return createMemoryDomainRepository({
    schemaVersion: 1,
    players: [ivo, ana],
    games: [analyzedGame],
    analysisRuns: [analysisRun],
    moveAnalyses: [
      move("move-1", ana.id, analyzedGame.id, analysisRun.id),
      move("opponent", ivo.id, analyzedGame.id, analysisRun.id, {
        color: "black",
        loss: 250,
        classification: "blunder",
      }),
    ],
    positionEvaluations: [],
    trainingTasks: [],
    trainingAttempts: [],
  });
}

test("dashboard bez odabira ostaje read-only pregled dostupnih profila", async () => {
  const repository = repositoryFixture();
  const before = await repository.readSnapshot();
  const dashboard = await loadPersonalizedDashboard({ repository });

  assert.deepEqual(
    dashboard.players.map((item) => [
      item.displayName,
      item.analyzedMoves,
    ]),
    [
      ["Ana", 1],
      ["Ivo", 1],
    ],
  );
  assert.equal(dashboard.selectedPlayer, null);
  assert.equal(dashboard.report, null);
  assert.deepEqual(await repository.readSnapshot(), before);
});

test("odabrani profil dobiva agregate i porijeklo samo svojih poteza", async () => {
  const repository = repositoryFixture();
  const dashboard = await loadPersonalizedDashboard({
    repository,
    playerId: "player-ana",
  });

  assert.equal(dashboard.report.overall.sampleSize, 1);
  assert.equal(dashboard.report.overall.averageLoss, 100);
  assert.equal(dashboard.report.byGame.length, 1);
  assert.equal(dashboard.report.byGame[0].title, "Ana - Iva");
  assert.equal(dashboard.report.byGame[0].accuracy, 100 * Math.exp(-100 / 220));
  assert.equal(dashboard.report.byOpening[0].key, "Open Game");
  assert.equal(dashboard.sources.length, 1);
  assert.deepEqual(dashboard.sources[0], {
    runId: "run-1",
    found: true,
    moveCount: 1,
    gameCount: 1,
    engine: { name: "Stockfish", version: "18" },
    settings: { depth: 12, multiPv: 1, uciOptions: {} },
    completedAt: NOW,
  });
});

test("nepoznat profil daje jasnu gresku", async () => {
  await assert.rejects(
    loadPersonalizedDashboard({
      repository: repositoryFixture(),
      playerId: "missing",
    }),
    /Profil igraca 'missing' ne postoji/,
  );
});

test("nedostajuce izvorne veze daju upozorenja bez rusenja izvjestaja", async () => {
  const ana = player("player-ana", "Ana");
  const repository = createMemoryDomainRepository({
    schemaVersion: 1,
    players: [ana],
    games: [],
    analysisRuns: [],
    moveAnalyses: [
      move("orphan", ana.id, "missing-game", "missing-run"),
    ],
    positionEvaluations: [],
    trainingTasks: [],
    trainingAttempts: [],
  });
  const dashboard = await loadPersonalizedDashboard({
    repository,
    playerId: ana.id,
  });

  assert.equal(dashboard.report.overall.sampleSize, 1);
  assert.deepEqual(
    dashboard.warnings.map((warning) => warning.code),
    ["missing-game", "missing-analysis-run"],
  );
  assert.equal(dashboard.sources[0].found, false);
});

test("dashboard prosljeduje vremenski raspon domenskom izvjestaju", async () => {
  const ana = player("player-ana", "Ana");
  const datedGame = game("dated", ana.id, "2024.06.01");
  const analysisRun = run("dated-run", datedGame.id);
  const repository = createMemoryDomainRepository({
    schemaVersion: 1,
    players: [ana],
    games: [datedGame],
    analysisRuns: [analysisRun],
    moveAnalyses: [
      move("dated-move", ana.id, datedGame.id, analysisRun.id),
    ],
    positionEvaluations: [],
    trainingTasks: [],
    trainingAttempts: [],
  });
  const dashboard = await loadPersonalizedDashboard({
    repository,
    playerId: ana.id,
    period: { from: "2025-01-01" },
  });

  assert.equal(dashboard.report.overall.sampleSize, 0);
  assert.equal(dashboard.report.period.excludedOutsideRangeMoves, 1);
});

test("profil koristi najnoviju zavrsenu generaciju istog poteza", async () => {
  const ana = player("player-ana", "Ana");
  const analyzedGame = game("game-refresh", ana.id);
  const olderRun = run(
    "run-older",
    analyzedGame.id,
    "2026-07-25T10:00:00.000Z",
  );
  const newerRun = run(
    "run-newer",
    analyzedGame.id,
    "2026-07-26T10:00:00.000Z",
  );
  const repository = createMemoryDomainRepository({
    schemaVersion: 1,
    players: [ana],
    games: [analyzedGame],
    analysisRuns: [olderRun, newerRun],
    moveAnalyses: [
      move("move-older", ana.id, analyzedGame.id, olderRun.id, {
        loss: 300,
        classification: "blunder",
      }),
      move("move-newer", ana.id, analyzedGame.id, newerRun.id, {
        loss: 60,
        classification: "inaccuracy",
      }),
    ],
    positionEvaluations: [],
    trainingTasks: [],
    trainingAttempts: [],
  });

  const dashboard = await loadPersonalizedDashboard({
    repository,
    playerId: ana.id,
  });

  assert.equal(dashboard.report.gamesAnalyzed, 1);
  assert.equal(dashboard.report.overall.sampleSize, 1);
  assert.equal(dashboard.report.overall.averageLoss, 60);
  assert.equal(dashboard.report.overall.classifications.blunder, 0);
  assert.equal(dashboard.report.overall.classifications.inaccuracy, 1);
  assert.equal(dashboard.sources.length, 1);
  assert.equal(dashboard.sources[0].runId, newerRun.id);
  assert.equal(dashboard.summary.selectedMoveAnalyses, 1);
  assert.equal(dashboard.summary.supersededMoveAnalyses, 1);
});
