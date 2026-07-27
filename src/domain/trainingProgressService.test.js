import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTrainingAttempt,
  createMemoryDomainRepository,
  createPlayer,
  createTrainingTask,
  loadTrainingProgress,
} from "./index.js";

const NOW = "2026-07-26T16:00:00.000Z";
const FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function task(id, weaknessKey, phase, priority) {
  return createTrainingTask(
    {
      id,
      playerId: "player-ana",
      source: {
        moveAnalysisId: `move-${id}`,
        analysisRunId: "run-1",
        gameId: `game-${id}`,
        gameTitle: `Partija ${id}`,
        ply: 1,
        moveNumber: 1,
      },
      fen: FEN,
      color: "white",
      phase,
      playedMove: { san: "e4", uci: "e2e4" },
      bestMove: { san: "d4", uci: "d2d4" },
      alternatives: [],
      centipawnLoss: 120,
      classification: "mistake",
      weaknessKey,
      priority,
      tags: [phase],
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
}

function fixture() {
  const player = createPlayer(
    { id: "player-ana", displayName: "Ana", aliases: [] },
    { now: NOW },
  );
  const openingA = task("opening-a", "opening:mistake", "opening", 70);
  const openingB = task("opening-b", "opening:mistake", "opening", 80);
  const endgame = task("endgame", "endgame:mistake", "endgame", 90);
  const failed = applyTrainingAttempt(openingA, {
    id: "attempt-again",
    outcome: "again",
    attemptedMove: { san: "e4", uci: "e2e4" },
    attemptedAt: NOW,
  }).attempt;
  const correct = applyTrainingAttempt(openingB, {
    id: "attempt-good",
    outcome: "good",
    attemptedMove: { san: "d4", uci: "d2d4" },
    attemptedAt: "2026-07-26T15:00:00.000Z",
  }).attempt;

  return {
    player,
    repository: createMemoryDomainRepository({
      schemaVersion: 1,
      players: [player],
      games: [],
      analysisRuns: [],
      moveAnalyses: [],
      positionEvaluations: [],
      trainingTasks: [openingA, openingB, endgame],
      trainingAttempts: [failed, correct],
    }),
  };
}

test("izvjestaj bez odabira samo navodi dostupne profile", async () => {
  const { repository } = fixture();
  const before = await repository.readSnapshot();
  const progress = await loadTrainingProgress({ repository, now: NOW });

  assert.equal(progress.selectedPlayer, null);
  assert.equal(progress.report, null);
  assert.equal(progress.players[0].taskCount, 3);
  assert.deepEqual(await repository.readSnapshot(), before);
});

test("napredak agregira uspjesnost, raspored, faze i slabosti", async () => {
  const { repository, player } = fixture();
  const progress = await loadTrainingProgress({
    repository,
    playerId: player.id,
    now: NOW,
  });
  const opening = progress.report.byWeakness.find(
    (group) => group.key === "opening:mistake",
  );

  assert.equal(progress.report.overall.taskCount, 3);
  assert.equal(progress.report.overall.attemptCount, 2);
  assert.equal(progress.report.overall.successRate, 50);
  assert.equal(progress.report.schedule.new, 3);
  assert.equal(opening.taskCount, 2);
  assert.equal(opening.attemptCount, 2);
  assert.equal(opening.outcomes.again, 1);
  assert.equal(opening.outcomes.good, 1);
  assert.equal(progress.report.byPhase[0].key, "opening");
  assert.equal(progress.report.recentAttempts[0].id, "attempt-again");
});

test("pokusaj bez postojeceg zadatka daje upozorenje bez rusenja", async () => {
  const { repository, player } = fixture();
  const snapshot = await repository.readSnapshot();
  snapshot.trainingAttempts[0] = {
    ...snapshot.trainingAttempts[0],
    taskId: "missing-task",
  };
  await repository.replaceSnapshot(snapshot);
  const progress = await loadTrainingProgress({
    repository,
    playerId: player.id,
    now: NOW,
  });

  assert.equal(progress.warnings[0].code, "missing-training-task");
  assert.equal(progress.report.overall.attemptCount, 1);
  assert.equal(progress.report.recentAttempts[0].taskFound, false);
});
