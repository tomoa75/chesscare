import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmAllCompletedPersonalizedMaterialization,
  createAllCompletedPersonalizedMaterializationPreview,
  createAnalysisRun,
  createGame,
  createMemoryDomainRepository,
  createPlayer,
  createPositionCacheKey,
  createPositionEvaluation,
  extractPlayerMoveContexts,
  loadPersonalizedDashboard,
} from "./index.js";

const NOW = "2026-07-27T12:00:00.000Z";
const ENGINE = { name: "Stockfish", version: "18" };
const SETTINGS = {
  depth: 8,
  multiPv: 1,
  uciOptions: { Hash: 16 },
};

function game(id, title, white, black, players, moves) {
  return createGame(
    {
      id,
      title,
      rawPgn: [
        `[Event "${title}"]`,
        `[White "${white}"]`,
        `[Black "${black}"]`,
        '[Result "*"]',
        "",
        `${moves} *`,
      ].join("\n"),
      headers: { Event: title, White: white, Black: black, Result: "*" },
      players,
      result: "*",
      source: { kind: "migration" },
      fingerprint: `sha256:${id}`,
    },
    { now: NOW },
  );
}

function completedRun(id, gameId, completedAt) {
  return createAnalysisRun(
    {
      id,
      gameIds: [gameId],
      engine: ENGINE,
      settings: SETTINGS,
      status: "completed",
      progress: { completed: 1, total: 1 },
      completedAt,
    },
    { now: NOW },
  );
}

async function evaluation(fen, value, bestMove = null) {
  const cacheKey = await createPositionCacheKey({
    fen,
    engine: ENGINE,
    settings: SETTINGS,
  });

  return createPositionEvaluation(
    {
      id: `evaluation-${cacheKey.slice(-16)}`,
      cacheKey,
      fen,
      engine: ENGINE,
      settings: SETTINGS,
      lines: [
        {
          multiPv: 1,
          depth: SETTINGS.depth,
          score: { type: "cp", value, perspective: "white" },
          bestMove,
          pv: bestMove ? [bestMove] : [],
        },
      ],
    },
    { now: NOW },
  );
}

test("profil materijalizira i agregira dvije igraceve partije iz dva zavrsena posla", async () => {
  const ana = createPlayer(
    { id: "player-ana", displayName: "Ana", aliases: [] },
    { now: NOW },
  );
  const iva = createPlayer(
    { id: "player-iva", displayName: "Iva", aliases: [] },
    { now: NOW },
  );
  const marko = createPlayer(
    { id: "player-marko", displayName: "Marko", aliases: [] },
    { now: NOW },
  );
  const games = [
    game(
      "game-1",
      "Ana bijelim",
      "Ana",
      "Iva",
      { whitePlayerId: ana.id, blackPlayerId: iva.id },
      "1. d4 d5",
    ),
    game(
      "game-2",
      "Ana crnim",
      "Marko",
      "Ana",
      { whitePlayerId: marko.id, blackPlayerId: ana.id },
      "1. e4 e5",
    ),
    game(
      "game-3",
      "Bez Ane",
      "Iva",
      "Marko",
      { whitePlayerId: iva.id, blackPlayerId: marko.id },
      "1. c4 c5",
    ),
  ];
  const runs = [
    completedRun("run-game-1", "game-1", "2026-07-27T10:00:00.000Z"),
    completedRun("run-game-2", "game-2", "2026-07-27T11:00:00.000Z"),
    completedRun("run-game-3", "game-3", "2026-07-27T12:00:00.000Z"),
  ];
  const contexts = extractPlayerMoveContexts(games, ana).contexts;
  const evaluationsByFen = new Map();

  for (const context of contexts) {
    if (!evaluationsByFen.has(context.beforeFen)) {
      evaluationsByFen.set(
        context.beforeFen,
        await evaluation(context.beforeFen, 50, context.playedMove.uci),
      );
    }
    if (!evaluationsByFen.has(context.afterFen)) {
      evaluationsByFen.set(
        context.afterFen,
        await evaluation(context.afterFen, 0),
      );
    }
  }

  const repository = createMemoryDomainRepository({
    schemaVersion: 1,
    players: [ana, iva, marko],
    games,
    analysisRuns: runs,
    moveAnalyses: [],
    positionEvaluations: [...evaluationsByFen.values()],
    trainingTasks: [],
    trainingAttempts: [],
  });
  const preview =
    await createAllCompletedPersonalizedMaterializationPreview({
      repository,
      playerId: ana.id,
    });

  assert.equal(preview.summary.gamesInRun, 2);
  assert.equal(preview.summary.gamesMatched, 2);
  assert.equal(preview.summary.runsMatched, 2);
  assert.equal(preview.summary.generated, 2);
  assert.deepEqual(
    preview.diagnostics.map((item) => item.gameId),
    ["game-1", "game-2"],
  );
  assert.equal(
    new Set(preview.moveAnalyses.map((move) => move.analysisRunId)).size,
    2,
  );
  assert.equal(
    new Set(preview.moveAnalyses.map((move) => move.gameId)).size,
    2,
  );

  await confirmAllCompletedPersonalizedMaterialization({
    repository,
    playerId: ana.id,
    previewToken: preview.token,
  });
  const savedPreview =
    await createAllCompletedPersonalizedMaterializationPreview({
      repository,
      playerId: ana.id,
    });
  console.table(
    savedPreview.diagnostics.map((item) => ({
      gameId: item.gameId,
      White: item.white,
      Black: item.black,
      linkedPlayerId: item.linkedPlayerId,
      analysisRunId: item.analysisRunId,
      analysisStatus: item.analysisStatus,
      savedAnalyzedMoves: item.savedAnalyzedMoves,
    })),
  );
  const dashboard = await loadPersonalizedDashboard({
    repository,
    playerId: ana.id,
  });

  assert.equal(dashboard.report.gamesAnalyzed, 2);
  assert.equal(dashboard.report.overall.sampleSize, 2);
  assert.equal(dashboard.sources.length, 2);
  assert.deepEqual(
    savedPreview.diagnostics.map((item) => item.savedAnalyzedMoves),
    [1, 1],
  );
  assert.deepEqual(
    dashboard.sources.map((source) => source.runId).sort(),
    ["run-game-1", "run-game-2"],
  );
});
