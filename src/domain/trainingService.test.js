import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTrainingAttempt,
  adjustTrainingPrioritiesAfterAttempt,
  createGame,
  createMemoryDomainRepository,
  createMoveAnalysis,
  createPlayer,
  createTrainingTask,
  generateTrainingTasks,
  getDueTrainingTasks,
} from "./index.js";

const NOW = "2026-07-25T20:00:00.000Z";
const TOMORROW = "2026-07-26T20:00:00.000Z";
const STANDARD_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function player() {
  return createPlayer(
    {
      id: "player-ana",
      displayName: "Ana Šarić",
    },
    { now: NOW },
  );
}

function game(id = "game-1") {
  return createGame(
    {
      id,
      title: "Turnir: Ana - Marko",
      rawPgn: "1. e4 e5",
      headers: {
        White: "Ana",
        Black: "Marko",
        Opening: "Italian Game",
      },
      players: { whitePlayerId: "player-ana" },
      result: "*",
      source: { kind: "migration" },
    },
    { now: NOW },
  );
}

function analyzedMove({
  id,
  gameId = "game-1",
  playerId = "player-ana",
  phase = "opening",
  classification = "mistake",
  loss = 120,
  bestMove = { san: "d4", uci: "d2d4" },
}) {
  return createMoveAnalysis({
    id,
    analysisRunId: "analysis-1",
    gameId,
    playerId,
    ply: 1,
    color: "white",
    phase,
    beforeFen: STANDARD_FEN,
    afterFen: "after-fen",
    playedMove: { san: "e4", uci: "e2e4" },
    bestMove,
    beforeEvaluation: { type: "cp", value: 30 },
    afterEvaluation: { type: "cp", value: 30 - loss },
    centipawnLoss: loss,
    classification,
  });
}

test("generator stvara zadatke samo iz pogresaka ciljnog igraca", () => {
  const ana = player();
  const generated = generateTrainingTasks({
    player: ana,
    games: [game()],
    moveAnalyses: [
      analyzedMove({ id: "mistake" }),
      analyzedMove({
        id: "good",
        classification: "good",
        loss: 10,
      }),
      analyzedMove({
        id: "opponent",
        playerId: "player-marko",
      }),
      analyzedMove({
        id: "without-best",
        bestMove: null,
      }),
    ],
    now: NOW,
  });

  assert.equal(generated.created.length, 1);
  const task = generated.created[0];
  assert.equal(task.id, "training-task-mistake");
  assert.equal(task.playerId, ana.id);
  assert.equal(task.fen, STANDARD_FEN);
  assert.equal(task.source.gameId, "game-1");
  assert.equal(task.source.gameTitle, "Turnir: Ana - Marko");
  assert.equal(task.source.moveAnalysisId, "mistake");
  assert.equal(task.source.moveNumber, 1);
  assert.deepEqual(task.bestMove, { san: "d4", uci: "d2d4" });
  assert.deepEqual(task.tags, [
    "opening",
    "mistake",
    "white",
    "Italian Game",
  ]);
  assert.deepEqual(task.schedule, {
    status: "new",
    dueAt: NOW,
    intervalDays: 0,
    easeFactor: 2.5,
    repetitions: 0,
    lapses: 0,
  });
});

test("prioritet raste s tezinom, gubitkom i ponavljanjem slabosti", () => {
  const generated = generateTrainingTasks({
    player: player(),
    games: [game()],
    moveAnalyses: [
      analyzedMove({
        id: "inaccuracy-1",
        classification: "inaccuracy",
        loss: 60,
      }),
      analyzedMove({
        id: "inaccuracy-2",
        classification: "inaccuracy",
        loss: 80,
      }),
      analyzedMove({
        id: "blunder",
        classification: "blunder",
        phase: "endgame",
        loss: 350,
      }),
    ],
    now: NOW,
  });
  const byId = new Map(generated.created.map((task) => [task.id, task]));

  assert.ok(
    byId.get("training-task-blunder").priority >
      byId.get("training-task-inaccuracy-1").priority,
  );
  assert.ok(
    byId.get("training-task-inaccuracy-1").priority >
      35 + Math.floor(60 / 50),
    "ponovljena ista slabost mora dobiti recurrence bonus",
  );
  assert.equal(generated.created[0].id, "training-task-blunder");
});

test("generator je idempotentan i prijavljuje partiju koja nedostaje", () => {
  const first = generateTrainingTasks({
    player: player(),
    games: [game()],
    moveAnalyses: [analyzedMove({ id: "same-source" })],
    now: NOW,
  });
  const second = generateTrainingTasks({
    player: player(),
    games: [game()],
    moveAnalyses: [
      analyzedMove({ id: "same-source" }),
      analyzedMove({ id: "missing-game", gameId: "unknown-game" }),
    ],
    existingTasks: first.created,
    now: NOW,
  });

  assert.deepEqual(second.created, []);
  assert.deepEqual(second.skipped, [
    {
      moveAnalysisId: "same-source",
      reason: "already-exists",
    },
    {
      moveAnalysisId: "missing-game",
      reason: "missing-game",
    },
  ]);
  assert.equal(second.all.length, 1);
});

function generatedTask() {
  return generateTrainingTasks({
    player: player(),
    games: [game()],
    moveAnalyses: [analyzedMove({ id: "schedule-source" })],
    now: NOW,
  }).created[0];
}

test("again resetira ponavljanja, smanjuje ease i biljezi pokusaj", () => {
  const original = generatedTask();
  const originalSnapshot = structuredClone(original);
  const result = applyTrainingAttempt(original, {
    id: "attempt-again",
    outcome: "again",
    attemptedMove: { san: "e4", uci: "e2e4" },
    attemptedAt: NOW,
  });

  assert.deepEqual(original, originalSnapshot);
  assert.deepEqual(result.task.schedule, {
    status: "learning",
    dueAt: TOMORROW,
    intervalDays: 1,
    easeFactor: 2.3,
    repetitions: 0,
    lapses: 1,
  });
  assert.equal(result.attempt.correct, false);
  assert.equal(result.attempt.previousDueAt, NOW);
  assert.equal(result.attempt.nextDueAt, TOMORROW);
});

test("good i easy postupno produzavaju interval", () => {
  const firstGood = applyTrainingAttempt(generatedTask(), {
    id: "attempt-good-1",
    outcome: "good",
    attemptedAt: NOW,
  });
  const secondGood = applyTrainingAttempt(firstGood.task, {
    id: "attempt-good-2",
    outcome: "good",
    attemptedAt: TOMORROW,
  });
  const easy = applyTrainingAttempt(generatedTask(), {
    id: "attempt-easy",
    outcome: "easy",
    attemptedAt: NOW,
  });

  assert.equal(firstGood.task.schedule.intervalDays, 1);
  assert.equal(firstGood.task.schedule.status, "learning");
  assert.equal(secondGood.task.schedule.intervalDays, 3);
  assert.equal(secondGood.task.schedule.status, "review");
  assert.equal(easy.task.schedule.intervalDays, 4);
  assert.equal(easy.task.schedule.easeFactor, 2.65);
  assert.equal(easy.attempt.correct, true);
});

test("nepoznat ishod ne proizvodi raspored ni pokusaj", () => {
  assert.throws(
    () =>
      applyTrainingAttempt(generatedTask(), {
        outcome: "savrseno",
        attemptedAt: NOW,
      }),
    /Ishod trening pokusaja/,
  );
});

test("due selektor iskljucuje buduce i suspendirane zadatke", () => {
  const dueHigh = generatedTask();
  const dueLow = createTrainingTask({
    ...generatedTask(),
    id: "due-low",
    priority: 10,
  });
  const future = createTrainingTask({
    ...generatedTask(),
    id: "future",
    schedule: {
      ...generatedTask().schedule,
      dueAt: "2026-07-30T20:00:00.000Z",
    },
  });
  const suspended = createTrainingTask({
    ...generatedTask(),
    id: "suspended",
    schedule: {
      ...generatedTask().schedule,
      status: "suspended",
    },
  });

  assert.deepEqual(
    getDueTrainingTasks(
      [dueLow, future, suspended, dueHigh],
      "2026-07-26T00:00:00.000Z",
    ).map((task) => task.id),
    [dueHigh.id, "due-low"],
  );
});

test("repozitorij sprema zadatak i pokusaj kao odvojene zapise", async () => {
  const repository = createMemoryDomainRepository();
  const result = applyTrainingAttempt(generatedTask(), {
    id: "stored-attempt",
    outcome: "hard",
    attemptedAt: NOW,
  });

  await repository.saveTrainingTask(result.task);
  await repository.saveTrainingAttempt(result.attempt);

  assert.equal((await repository.listTrainingTasks()).length, 1);
  assert.equal((await repository.listTrainingAttempts()).length, 1);
  assert.equal(
    (await repository.getTrainingAttempt("stored-attempt")).taskId,
    result.task.id,
  );
});

test("again povecava prioritet svih zadataka iste slabosti bez mutacije", () => {
  const source = createTrainingTask({
    ...generatedTask(),
    id: "weakness-source",
    priority: 70,
  });
  const sameWeakness = createTrainingTask({
    ...generatedTask(),
    id: "same-weakness",
    priority: 98,
  });
  const otherWeakness = createTrainingTask({
    ...generatedTask(),
    id: "other-weakness",
    weaknessKey: "endgame:blunder",
    priority: 80,
  });
  const original = [source, sameWeakness, otherWeakness];
  const before = structuredClone(original);
  const adjusted = adjustTrainingPrioritiesAfterAttempt(original, {
    taskId: source.id,
    outcome: "again",
    attemptedAt: NOW,
  });
  const byId = new Map(adjusted.tasks.map((task) => [task.id, task]));

  assert.deepEqual(original, before);
  assert.equal(byId.get(source.id).priority, 75);
  assert.equal(byId.get(sameWeakness.id).priority, 100);
  assert.equal(byId.get(otherWeakness.id).priority, 80);
  assert.deepEqual(adjusted.adjustedTaskIds, [
    source.id,
    sameWeakness.id,
  ]);
});

test("tocan ishod ne mijenja prioritete slabosti", () => {
  const source = generatedTask();
  const adjusted = adjustTrainingPrioritiesAfterAttempt([source], {
    taskId: source.id,
    outcome: "good",
    attemptedAt: NOW,
  });

  assert.equal(adjusted.tasks[0].priority, source.priority);
  assert.deepEqual(adjusted.adjustedTaskIds, []);
});
