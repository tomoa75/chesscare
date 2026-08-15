import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmTrainingMaterialization,
  createAnalysisRun,
  createGame,
  createMemoryDomainRepository,
  createMoveAnalysis,
  createPlayer,
  createTrainingMaterializationPreview,
  loadTrainingMaterializationDashboard,
} from "./index.js";

const NOW = "2026-07-26T12:00:00.000Z";
const FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function fixture(options = {}) {
  const player = createPlayer(
    { id: "player-ana", displayName: "Ana", aliases: [] },
    { now: NOW },
  );
  const game = createGame(
    {
      id: "game-1",
      title: "Ana - Iva",
      rawPgn: "1. e4 e5",
      headers: { White: "Ana", Black: "Iva", Opening: "Open Game" },
      players: { whitePlayerId: player.id, blackPlayerId: null },
      result: "*",
      source: { kind: "migration" },
    },
    { now: NOW },
  );
  const move = createMoveAnalysis({
    id: "move-1",
    analysisRunId: "run-1",
    gameId: options.missingGame ? "missing-game" : game.id,
    playerId: player.id,
    ply: 1,
    color: "white",
    phase: "opening",
    beforeFen: FEN,
    afterFen: "after",
    playedMove: { san: "e4", uci: "e2e4" },
    bestMove: { san: "d4", uci: "d2d4" },
    beforeEvaluation: { type: "cp", value: 20 },
    afterEvaluation: { type: "cp", value: -100 },
    centipawnLoss: 120,
    classification: "mistake",
  });
  const repository = createMemoryDomainRepository({
    schemaVersion: 1,
    players: [player],
    games: options.missingGame ? [] : [game],
    analysisRuns: [],
    moveAnalyses: [move],
    positionEvaluations: [],
    trainingTasks: [],
    trainingAttempts: [],
  });

  return { repository, player, move };
}

test("preview generira trening zadatak bez zapisivanja", async () => {
  const { repository, player, move } = fixture();
  const before = await repository.readSnapshot();
  const preview = await createTrainingMaterializationPreview({
    repository,
    playerId: player.id,
    minimumLoss: 50,
    referenceTime: NOW,
  });

  assert.equal(preview.canMaterialize, true);
  assert.equal(preview.summary.toAdd, 1);
  assert.equal(preview.toAdd[0].source.moveAnalysisId, move.id);
  assert.equal(preview.toAdd[0].schedule.dueAt, NOW);
  assert.deepEqual(await repository.readSnapshot(), before);
});

test("preview uklanja ponovljene analize istog poteza i koristi najnoviju", async () => {
  const { repository, player } = fixture();
  const snapshot = await repository.readSnapshot();
  const olderRun = createAnalysisRun(
    {
      id: "run-older",
      gameIds: ["game-1"],
      engine: { name: "Stockfish", version: "18" },
      settings: { depth: 12, multiPv: 1, uciOptions: {} },
      status: "completed",
      progress: { completed: 1, total: 1 },
      completedAt: "2026-07-25T12:00:00.000Z",
    },
    { now: "2026-07-25T12:00:00.000Z" },
  );
  const newerRun = createAnalysisRun(
    {
      id: "run-newer",
      gameIds: ["game-1"],
      engine: { name: "Stockfish", version: "18" },
      settings: { depth: 14, multiPv: 1, uciOptions: {} },
      status: "completed",
      progress: { completed: 1, total: 1 },
      completedAt: "2026-07-26T12:00:00.000Z",
    },
    { now: "2026-07-26T12:00:00.000Z" },
  );
  const baseMove = snapshot.moveAnalyses[0];
  snapshot.analysisRuns = [olderRun, newerRun];
  snapshot.moveAnalyses = [
    createMoveAnalysis({
      ...baseMove,
      id: "move-older",
      analysisRunId: olderRun.id,
      centipawnLoss: 180,
      classification: "mistake",
    }),
    createMoveAnalysis({
      ...baseMove,
      id: "move-newer",
      analysisRunId: newerRun.id,
      centipawnLoss: 120,
      classification: "mistake",
    }),
  ];
  await repository.replaceSnapshot(snapshot);

  const preview = await createTrainingMaterializationPreview({
    repository,
    playerId: player.id,
    minimumLoss: 50,
    referenceTime: NOW,
  });

  assert.equal(preview.summary.analyzedMoves, 1);
  assert.equal(preview.summary.eligibleMoves, 1);
  assert.equal(preview.summary.toAdd, 1);
  assert.equal(preview.toAdd[0].source.moveAnalysisId, "move-newer");
});

test("potvrda sprema cijeli preview i ponavljanje je idempotentno", async () => {
  const { repository, player } = fixture();
  const preview = await createTrainingMaterializationPreview({
    repository,
    playerId: player.id,
    referenceTime: NOW,
  });
  const first = await confirmTrainingMaterialization({
    repository,
    playerId: player.id,
    referenceTime: preview.referenceTime,
    minimumLoss: preview.minimumLoss,
    previewToken: preview.token,
  });
  const second = await confirmTrainingMaterialization({
    repository,
    playerId: player.id,
    referenceTime: preview.referenceTime,
    minimumLoss: preview.minimumLoss,
    previewToken: preview.token,
  });

  assert.equal(first.status, "materialized");
  assert.equal(first.added, 1);
  assert.equal(second.status, "already-materialized");
  assert.equal((await repository.listTrainingTasks()).length, 1);
});

test("nedostajuca izvorna partija blokira spremanje", async () => {
  const { repository, player } = fixture({ missingGame: true });
  const preview = await createTrainingMaterializationPreview({
    repository,
    playerId: player.id,
    referenceTime: NOW,
  });

  assert.equal(preview.canMaterialize, false);
  assert.equal(preview.warnings[0].code, "missing-game");
  await assert.rejects(
    confirmTrainingMaterialization({
      repository,
      playerId: player.id,
      referenceTime: preview.referenceTime,
      previewToken: preview.token,
    }),
    (error) => error.code === "materialization-blocked",
  );
});

test("promjena snapshota nakon previewa blokira spremanje", async () => {
  const { repository, player } = fixture();
  const preview = await createTrainingMaterializationPreview({
    repository,
    playerId: player.id,
    referenceTime: NOW,
  });
  await repository.savePlayer(
    createPlayer(
      { id: "player-iva", displayName: "Iva", aliases: [] },
      { now: NOW },
    ),
  );

  await assert.rejects(
    confirmTrainingMaterialization({
      repository,
      playerId: player.id,
      referenceTime: preview.referenceTime,
      previewToken: preview.token,
    }),
    (error) => error.code === "stale-preview",
  );
  assert.equal((await repository.listTrainingTasks()).length, 0);
});

test("prag gubitka ostaje dio potvrdenog zahtjeva", async () => {
  const { repository, player } = fixture();
  const preview = await createTrainingMaterializationPreview({
    repository,
    playerId: player.id,
    minimumLoss: 150,
    referenceTime: NOW,
  });

  assert.equal(preview.summary.eligibleMoves, 0);
  assert.equal(preview.summary.toAdd, 0);
  assert.equal(preview.exclusions.belowThreshold, 1);
  assert.equal(preview.canMaterialize, false);
});

test("read-only dashboard prikazuje broj spremljenih i dospjelih zadataka", async () => {
  const { repository, player } = fixture();
  const preview = await createTrainingMaterializationPreview({
    repository,
    playerId: player.id,
    referenceTime: NOW,
  });
  await confirmTrainingMaterialization({
    repository,
    playerId: player.id,
    referenceTime: preview.referenceTime,
    previewToken: preview.token,
  });
  const before = await repository.readSnapshot();
  const dashboard = await loadTrainingMaterializationDashboard({
    repository,
    referenceTime: NOW,
  });

  assert.equal(dashboard.summary.totalTasks, 1);
  assert.equal(dashboard.summary.dueTasks, 1);
  assert.equal(dashboard.players[0].trainingTasks, 1);
  assert.equal(dashboard.players[0].analyzedMoves, 1);
  assert.deepEqual(await repository.readSnapshot(), before);
});
