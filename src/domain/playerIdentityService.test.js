import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmPlayerAlias,
  confirmPlayerMerge,
  createAliasConfirmationPreview,
  createGame,
  createMemoryDomainRepository,
  createMoveAnalysis,
  createPlayer,
  createPlayerMergePreview,
  createTrainingAttempt,
  createTrainingTask,
  loadPlayerIdentityDashboard,
} from "./index.js";

const NOW = "2026-07-26T18:00:00.000Z";
const FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function player(id, displayName, aliases = []) {
  return createPlayer(
    { id, displayName, aliases },
    { now: NOW },
  );
}

function game({
  id = "game-1",
  white = "Ana Saric",
  black = "Iva",
  whitePlayerId = null,
  blackPlayerId = null,
}) {
  return createGame(
    {
      id,
      title: `${white} - ${black}`,
      rawPgn: `1. e4 e5`,
      headers: { White: white, Black: black },
      players: { whitePlayerId, blackPlayerId },
      result: "*",
      source: { kind: "migration" },
    },
    { now: NOW },
  );
}

function emptySnapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    players: [],
    games: [],
    analysisRuns: [],
    moveAnalyses: [],
    positionEvaluations: [],
    trainingTasks: [],
    trainingAttempts: [],
    ...overrides,
  };
}

test("dashboard prikazuje nerazrijesena imena i slicnosti samo za rucnu provjeru", async () => {
  const ana = player("ana", "Ana Šarić");
  const variant = player("variant", "Saric, Ana");
  const repository = createMemoryDomainRepository(
    emptySnapshot({
      players: [ana, variant],
      games: [game({ white: "A. Saric" })],
    }),
  );
  const before = await repository.readSnapshot();
  const dashboard = await loadPlayerIdentityDashboard({ repository });

  assert.equal(dashboard.unresolvedNames[0].displayName, "A. Saric");
  assert.equal(dashboard.possibleMatches.length, 1);
  assert.equal(dashboard.possibleMatches[0].action, "manual-review");
  assert.deepEqual(await repository.readSnapshot(), before);
});

test("alias preview ne zapisuje, a potvrda je eksplicitna i idempotentna", async () => {
  const ana = player("ana", "Ana Šarić");
  const repository = createMemoryDomainRepository(
    emptySnapshot({
      players: [ana],
      games: [game({ white: "A. Saric" })],
    }),
  );
  const before = await repository.readSnapshot();
  const preview = await createAliasConfirmationPreview({
    repository,
    playerId: ana.id,
    alias: "A. Saric",
    referenceTime: NOW,
  });

  assert.equal(preview.canConfirm, true);
  assert.equal(preview.summary.occurrences, 1);
  assert.deepEqual(await repository.readSnapshot(), before);

  const first = await confirmPlayerAlias({
    repository,
    playerId: ana.id,
    alias: preview.alias,
    referenceTime: preview.referenceTime,
    previewToken: preview.token,
  });
  const second = await confirmPlayerAlias({
    repository,
    playerId: ana.id,
    alias: preview.alias,
    referenceTime: preview.referenceTime,
    previewToken: preview.token,
  });

  assert.equal(first.status, "confirmed");
  assert.equal(second.status, "already-confirmed");
  assert.deepEqual((await repository.getPlayer(ana.id)).aliases, [
    "Ana Šarić",
    "A. Saric",
  ]);
});

test("alias koji pripada ili je povezan s drugim profilom blokira potvrdu", async () => {
  const ana = player("ana", "Ana");
  const iva = player("iva", "Iva", ["I. Ivic"]);
  const repository = createMemoryDomainRepository(
    emptySnapshot({
      players: [ana, iva],
      games: [
        game({
          white: "I. Ivic",
          whitePlayerId: iva.id,
        }),
      ],
    }),
  );
  const preview = await createAliasConfirmationPreview({
    repository,
    playerId: ana.id,
    alias: "I. Ivic",
    referenceTime: NOW,
  });

  assert.equal(preview.canConfirm, false);
  assert.equal(preview.conflicts.length, 2);
  await assert.rejects(
    confirmPlayerAlias({
      repository,
      playerId: ana.id,
      alias: preview.alias,
      referenceTime: preview.referenceTime,
      previewToken: preview.token,
    }),
    (error) => error.code === "alias-confirmation-blocked",
  );
});

function downstreamRecords(sourcePlayerId) {
  const move = createMoveAnalysis({
    id: "move-1",
    analysisRunId: "run-1",
    gameId: "game-source",
    playerId: sourcePlayerId,
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
  const task = createTrainingTask(
    {
      id: "task-1",
      playerId: sourcePlayerId,
      source: {
        moveAnalysisId: move.id,
        analysisRunId: "run-1",
        gameId: "game-source",
        gameTitle: "Alias - Iva",
        ply: 1,
        moveNumber: 1,
      },
      fen: FEN,
      color: "white",
      phase: "opening",
      playedMove: { san: "e4", uci: "e2e4" },
      bestMove: { san: "d4", uci: "d2d4" },
      alternatives: [],
      centipawnLoss: 120,
      classification: "mistake",
      weaknessKey: "opening:mistake",
      priority: 70,
      tags: ["opening"],
      schedule: {
        status: "new",
        dueAt: NOW,
        intervalDays: 0,
        easeFactor: 2.5,
        repetitions: 0,
        lapses: 0,
      },
    },
    { now: NOW },
  );
  const attempt = createTrainingAttempt(
    {
      id: "attempt-1",
      taskId: task.id,
      playerId: sourcePlayerId,
      outcome: "again",
      correct: false,
      attemptedMove: { san: "e4", uci: "e2e4" },
      attemptedAt: NOW,
      previousDueAt: NOW,
      nextDueAt: "2026-07-27T18:00:00.000Z",
    },
    { now: NOW },
  );
  return { move, task, attempt };
}

test("potvrdeno spajanje preusmjerava sve domenske veze i cuva aliase", async () => {
  const target = player("target", "Ana Šarić");
  const source = player("source", "Saric, Ana");
  const records = downstreamRecords(source.id);
  const repository = createMemoryDomainRepository(
    emptySnapshot({
      players: [target, source],
      games: [
        game({
          id: "game-source",
          white: "Saric, Ana",
          whitePlayerId: source.id,
        }),
      ],
      moveAnalyses: [records.move],
      trainingTasks: [records.task],
      trainingAttempts: [records.attempt],
    }),
  );
  const preview = await createPlayerMergePreview({
    repository,
    sourcePlayerId: source.id,
    targetPlayerId: target.id,
    referenceTime: NOW,
  });

  assert.equal(preview.canMerge, true);
  assert.deepEqual(preview.changes, {
    gameLinks: 1,
    moveAnalyses: 1,
    trainingTasks: 1,
    trainingAttempts: 1,
    aliasesAdded: 1,
  });
  const first = await confirmPlayerMerge({
    repository,
    sourcePlayerId: source.id,
    targetPlayerId: target.id,
    referenceTime: preview.referenceTime,
    previewToken: preview.token,
  });
  const second = await confirmPlayerMerge({
    repository,
    sourcePlayerId: source.id,
    targetPlayerId: target.id,
    referenceTime: preview.referenceTime,
    previewToken: preview.token,
  });
  const snapshot = await repository.readSnapshot();

  assert.equal(first.status, "merged");
  assert.equal(second.status, "already-merged");
  assert.equal(snapshot.players.length, 1);
  assert.deepEqual(snapshot.players[0].aliases, [
    "Ana Šarić",
    "Saric, Ana",
  ]);
  assert.equal(snapshot.games[0].players.whitePlayerId, target.id);
  assert.equal(snapshot.moveAnalyses[0].playerId, target.id);
  assert.equal(snapshot.trainingTasks[0].playerId, target.id);
  assert.equal(snapshot.trainingAttempts[0].playerId, target.id);
});

test("profili koji igraju jedan protiv drugoga ne mogu se spojiti", async () => {
  const target = player("target", "Ana");
  const source = player("source", "Iva");
  const repository = createMemoryDomainRepository(
    emptySnapshot({
      players: [target, source],
      games: [
        game({
          white: "Ana",
          black: "Iva",
          whitePlayerId: target.id,
          blackPlayerId: source.id,
        }),
      ],
    }),
  );
  const preview = await createPlayerMergePreview({
    repository,
    sourcePlayerId: source.id,
    targetPlayerId: target.id,
    referenceTime: NOW,
  });

  assert.equal(preview.canMerge, false);
  assert.equal(preview.conflicts[0].code, "merge-would-link-both-colors");
});

test("promjena snapshota nakon previewa blokira alias i merge", async () => {
  const target = player("target", "Ana");
  const source = player("source", "Ana Alias");
  const repository = createMemoryDomainRepository(
    emptySnapshot({ players: [target, source] }),
  );
  const aliasPreview = await createAliasConfirmationPreview({
    repository,
    playerId: target.id,
    alias: "A. Test",
    referenceTime: NOW,
  });
  await repository.savePlayer(player("third", "Treca"));
  await assert.rejects(
    confirmPlayerAlias({
      repository,
      playerId: target.id,
      alias: aliasPreview.alias,
      referenceTime: aliasPreview.referenceTime,
      previewToken: aliasPreview.token,
    }),
    (error) => error.code === "stale-preview",
  );

  const mergePreview = await createPlayerMergePreview({
    repository,
    sourcePlayerId: source.id,
    targetPlayerId: target.id,
    referenceTime: NOW,
  });
  await repository.savePlayer(player("fourth", "Cetvrta"));
  await assert.rejects(
    confirmPlayerMerge({
      repository,
      sourcePlayerId: source.id,
      targetPlayerId: target.id,
      referenceTime: mergePreview.referenceTime,
      previewToken: mergePreview.token,
    }),
    (error) => error.code === "stale-preview",
  );
});
