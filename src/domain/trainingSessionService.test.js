import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmTrainingAttempt,
  createMemoryDomainRepository,
  createPlayer,
  createTrainingAttemptPreview,
  createTrainingTask,
  loadTrainingSession,
} from "./index.js";

const NOW = "2026-07-26T14:00:00.000Z";
const FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function task(overrides = {}) {
  return createTrainingTask(
    {
      id: overrides.id || "task-1",
      playerId: overrides.playerId || "player-ana",
      source: {
        moveAnalysisId: "move-1",
        analysisRunId: "run-1",
        gameId: "game-1",
        gameTitle: "Ana - Iva",
        ply: 1,
        moveNumber: 1,
      },
      fen: FEN,
      color: "white",
      phase: "opening",
      playedMove: { san: "e4", uci: "e2e4" },
      bestMove: { san: "d4", uci: "d2d4" },
      alternatives: [{ san: "Nf3", uci: "g1f3" }],
      centipawnLoss: 120,
      classification: "mistake",
      weaknessKey: "opening:mistake",
      priority: 70,
      tags: ["opening", "mistake"],
      schedule: {
        status: "new",
        dueAt: overrides.dueAt || NOW,
        intervalDays: 0,
        easeFactor: 2.5,
        repetitions: 0,
        lapses: 0,
      },
    },
    { now: NOW },
  );
}

function fixture(tasks = [task()]) {
  const player = createPlayer(
    { id: "player-ana", displayName: "Ana", aliases: [] },
    { now: NOW },
  );
  return {
    player,
    repository: createMemoryDomainRepository({
      schemaVersion: 1,
      players: [player],
      games: [],
      analysisRuns: [],
      moveAnalyses: [],
      positionEvaluations: [],
      trainingTasks: tasks,
      trainingAttempts: [],
    }),
  };
}

test("session prikazuje samo dospjele zadatke odabranog igraca", async () => {
  const future = task({
    id: "future",
    dueAt: "2026-07-30T14:00:00.000Z",
  });
  const { repository, player } = fixture([future, task()]);
  const session = await loadTrainingSession({
    repository,
    playerId: player.id,
    now: NOW,
  });

  assert.equal(session.summary.totalTasks, 2);
  assert.equal(session.summary.dueTasks, 1);
  assert.equal(session.currentTask.id, "task-1");
});

test("preview legalnog najboljeg i alternativnog poteza ne zapisuje podatke", async () => {
  const { repository } = fixture();
  const before = await repository.readSnapshot();
  const best = await createTrainingAttemptPreview({
    repository,
    taskId: "task-1",
    attemptedMove: { from: "d2", to: "d4" },
    attemptedAt: NOW,
  });
  const alternative = await createTrainingAttemptPreview({
    repository,
    taskId: "task-1",
    attemptedMove: { from: "g1", to: "f3" },
    attemptedAt: NOW,
  });

  assert.equal(best.correct, true);
  assert.equal(alternative.correct, true);
  assert.deepEqual(best.allowedOutcomes, ["hard", "good", "easy"]);
  assert.deepEqual(await repository.readSnapshot(), before);
});

test("netocan legalan potez dopusta samo again, a ilegalan se odbija", async () => {
  const { repository } = fixture();
  const wrong = await createTrainingAttemptPreview({
    repository,
    taskId: "task-1",
    attemptedMove: { from: "e2", to: "e4" },
    attemptedAt: NOW,
  });

  assert.equal(wrong.correct, false);
  assert.deepEqual(wrong.allowedOutcomes, ["again"]);
  await assert.rejects(
    createTrainingAttemptPreview({
      repository,
      taskId: "task-1",
      attemptedMove: { from: "e2", to: "e5" },
      attemptedAt: NOW,
    }),
    (error) => error.code === "illegal-move",
  );
});

test("potvrda atomski sprema pokusaj i novi raspored", async () => {
  const { repository } = fixture();
  const preview = await createTrainingAttemptPreview({
    repository,
    taskId: "task-1",
    attemptedMove: { from: "d2", to: "d4" },
    attemptedAt: NOW,
  });
  const result = await confirmTrainingAttempt({
    repository,
    taskId: "task-1",
    attemptedMove: { from: "d2", to: "d4" },
    attemptedAt: NOW,
    outcome: "good",
    previewToken: preview.token,
  });
  const snapshot = await repository.readSnapshot();

  assert.equal(result.status, "recorded");
  assert.equal(snapshot.trainingAttempts.length, 1);
  assert.equal(snapshot.trainingTasks[0].schedule.status, "learning");
  assert.equal(snapshot.trainingTasks[0].schedule.intervalDays, 1);
});

test("netocan ishod i zastarjeli preview ne mijenjaju podatke", async () => {
  const { repository, player } = fixture();
  const wrong = await createTrainingAttemptPreview({
    repository,
    taskId: "task-1",
    attemptedMove: { from: "e2", to: "e4" },
    attemptedAt: NOW,
  });
  await assert.rejects(
    confirmTrainingAttempt({
      repository,
      taskId: "task-1",
      attemptedMove: { from: "e2", to: "e4" },
      attemptedAt: NOW,
      outcome: "good",
      previewToken: wrong.token,
    }),
    (error) => error.code === "invalid-outcome",
  );

  const correct = await createTrainingAttemptPreview({
    repository,
    taskId: "task-1",
    attemptedMove: { from: "d2", to: "d4" },
    attemptedAt: NOW,
  });
  await repository.savePlayer({ ...player, displayName: "Ana Updated" });
  await assert.rejects(
    confirmTrainingAttempt({
      repository,
      taskId: "task-1",
      attemptedMove: { from: "d2", to: "d4" },
      attemptedAt: NOW,
      outcome: "good",
      previewToken: correct.token,
    }),
    (error) => error.code === "stale-preview",
  );
  assert.equal((await repository.listTrainingAttempts()).length, 0);
});

test("ponovljena jednaka potvrda ne stvara duplikat", async () => {
  const { repository } = fixture();
  const input = {
    repository,
    taskId: "task-1",
    attemptedMove: { from: "d2", to: "d4" },
    attemptedAt: NOW,
    outcome: "easy",
  };
  const preview = await createTrainingAttemptPreview(input);
  const first = await confirmTrainingAttempt({
    ...input,
    previewToken: preview.token,
  });
  const second = await confirmTrainingAttempt({
    ...input,
    previewToken: preview.token,
  });

  assert.equal(first.status, "recorded");
  assert.equal(second.status, "already-recorded");
  assert.equal((await repository.listTrainingAttempts()).length, 1);
});

test("netocan pokusaj povecava prioritet svih zadataka iste slabosti", async () => {
  const related = task({ id: "related-task" });
  const { repository } = fixture([task(), related]);
  const preview = await createTrainingAttemptPreview({
    repository,
    taskId: "task-1",
    attemptedMove: { from: "e2", to: "e4" },
    attemptedAt: NOW,
  });
  const result = await confirmTrainingAttempt({
    repository,
    taskId: "task-1",
    attemptedMove: { from: "e2", to: "e4" },
    attemptedAt: NOW,
    outcome: "again",
    previewToken: preview.token,
  });
  const tasks = await repository.listTrainingTasks();

  assert.deepEqual(result.priorityAdjustment.adjustedTaskIds, [
    "task-1",
    "related-task",
  ]);
  assert.equal(tasks.every((item) => item.priority === 75), true);
});
