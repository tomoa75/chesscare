import {
  createTrainingAttempt,
  createTrainingTask,
} from "./training.js";
import { TRAINING_ATTEMPT_OUTCOMES } from "./constants.js";

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const SEVERITY_PRIORITY = {
  inaccuracy: 35,
  mistake: 60,
  blunder: 80,
};
const REPEATED_ERROR_PRIORITY_INCREMENT = 5;

function isoDate(value, fieldName) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${fieldName} nije valjani datum.`);
  }
  return date;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_IN_MILLISECONDS).toISOString();
}

function gameOpening(game) {
  const opening = game?.headers?.Opening || game?.headers?.Variant;
  return typeof opening === "string" && opening.trim() && opening !== "?"
    ? opening.trim()
    : null;
}

function weaknessKey(move) {
  return `${move.phase}:${move.classification}`;
}

function priorityFor(move, recurrence) {
  const severity = SEVERITY_PRIORITY[move.classification] || 0;
  const lossBonus = Math.min(15, Math.floor(move.centipawnLoss / 50));
  const recurrenceBonus = Math.min(15, Math.max(0, recurrence - 1) * 5);

  return Math.min(100, severity + lossBonus + recurrenceBonus);
}

function taskIdFor(move) {
  return `training-task-${move.id}`;
}

export function generateTrainingTasks(options) {
  const {
    player,
    moveAnalyses,
    games,
    existingTasks = [],
  } = options;
  const now = options.now || new Date().toISOString();
  const minimumLoss = options.minimumLoss ?? 50;

  if (
    !player?.id ||
    !Array.isArray(moveAnalyses) ||
    !Array.isArray(games) ||
    !Array.isArray(existingTasks)
  ) {
    throw new TypeError("Podaci za generiranje treninga nisu valjani.");
  }
  if (!Number.isFinite(minimumLoss) || minimumLoss < 0) {
    throw new TypeError("Minimalni gubitak mora biti nenegativan broj.");
  }

  const gamesById = new Map(games.map((game) => [game.id, game]));
  const eligible = moveAnalyses.filter(
    (move) =>
      move.playerId === player.id &&
      move.classification !== "good" &&
      move.centipawnLoss >= minimumLoss &&
      move.bestMove,
  );
  const recurrence = new Map();

  for (const move of eligible) {
    if (!gamesById.has(move.gameId)) continue;
    const key = weaknessKey(move);
    recurrence.set(key, (recurrence.get(key) || 0) + 1);
  }

  const existingSourceIds = new Set(
    existingTasks.map((task) => task.source.moveAnalysisId),
  );
  const created = [];
  const skipped = [];

  for (const move of eligible) {
    if (existingSourceIds.has(move.id)) {
      skipped.push({
        moveAnalysisId: move.id,
        reason: "already-exists",
      });
      continue;
    }

    const game = gamesById.get(move.gameId);
    if (!game) {
      skipped.push({
        moveAnalysisId: move.id,
        reason: "missing-game",
      });
      continue;
    }

    const key = weaknessKey(move);
    const opening = gameOpening(game);
    const moveNumber = Number(move.beforeFen.split(" ")[5]);
    const tags = [
      move.phase,
      move.classification,
      move.color,
      ...(opening ? [opening] : []),
    ];

    created.push(
      createTrainingTask(
        {
          id: taskIdFor(move),
          playerId: player.id,
          source: {
            moveAnalysisId: move.id,
            analysisRunId: move.analysisRunId,
            gameId: move.gameId,
            gameTitle: game.title,
            ply: move.ply,
            moveNumber: Number.isInteger(moveNumber)
              ? moveNumber
              : Math.ceil(move.ply / 2),
          },
          fen: move.beforeFen,
          color: move.color,
          phase: move.phase,
          playedMove: move.playedMove,
          bestMove: move.bestMove,
          alternatives: [],
          centipawnLoss: move.centipawnLoss,
          classification: move.classification,
          weaknessKey: key,
          priority: priorityFor(move, recurrence.get(key)),
          tags,
          schedule: {
            status: "new",
            dueAt: now,
            intervalDays: 0,
            easeFactor: 2.5,
            repetitions: 0,
            lapses: 0,
          },
        },
        { now },
      ),
    );
    existingSourceIds.add(move.id);
  }

  created.sort(
    (left, right) =>
      right.priority - left.priority || left.id.localeCompare(right.id),
  );

  return {
    created,
    skipped,
    all: [...existingTasks, ...created],
  };
}

function nextSchedule(schedule, outcome, attemptedAt) {
  let easeFactor = schedule.easeFactor;
  let repetitions = schedule.repetitions;
  let lapses = schedule.lapses;
  let intervalDays;
  let status;

  if (outcome === "again") {
    easeFactor = Math.max(1.3, easeFactor - 0.2);
    repetitions = 0;
    lapses += 1;
    intervalDays = 1;
    status = "learning";
  } else if (outcome === "hard") {
    easeFactor = Math.max(1.3, easeFactor - 0.15);
    repetitions += 1;
    intervalDays = Math.max(1, Math.round(schedule.intervalDays * 1.2));
    status = repetitions < 2 ? "learning" : "review";
  } else if (outcome === "good") {
    repetitions += 1;
    intervalDays =
      schedule.repetitions === 0
        ? 1
        : schedule.repetitions === 1
          ? 3
          : Math.max(
              1,
              Math.round(schedule.intervalDays * easeFactor),
            );
    status =
      repetitions >= 5 ? "mastered" : repetitions < 2 ? "learning" : "review";
  } else {
    easeFactor += 0.15;
    repetitions += 1;
    intervalDays =
      schedule.repetitions === 0
        ? 4
        : Math.max(
            1,
            Math.round(schedule.intervalDays * easeFactor * 1.3),
          );
    status = repetitions >= 4 ? "mastered" : "review";
  }

  return {
    status,
    dueAt: addDays(attemptedAt, intervalDays),
    intervalDays,
    easeFactor: Number(easeFactor.toFixed(2)),
    repetitions,
    lapses,
  };
}

export function applyTrainingAttempt(task, input, options = {}) {
  const attemptedAt = isoDate(
    input?.attemptedAt || options.now || new Date().toISOString(),
    "Vrijeme pokusaja",
  );
  const outcome = input?.outcome;
  if (!TRAINING_ATTEMPT_OUTCOMES.includes(outcome)) {
    throw new TypeError("Ishod trening pokusaja nije valjan.");
  }
  const schedule = nextSchedule(task.schedule, outcome, attemptedAt);
  const updatedTask = createTrainingTask({
    ...task,
    schedule,
    updatedAt: attemptedAt.toISOString(),
  });
  const attempt = createTrainingAttempt(
    {
      id: input?.id,
      taskId: task.id,
      playerId: task.playerId,
      outcome,
      correct: outcome !== "again",
      attemptedMove: input?.attemptedMove || null,
      attemptedAt: attemptedAt.toISOString(),
      previousDueAt: task.schedule.dueAt,
      nextDueAt: schedule.dueAt,
    },
    { now: attemptedAt.toISOString() },
  );

  return { task: updatedTask, attempt };
}

export function adjustTrainingPrioritiesAfterAttempt(tasks, input) {
  if (!Array.isArray(tasks)) {
    throw new TypeError("Trening zadaci moraju biti polje.");
  }
  if (!TRAINING_ATTEMPT_OUTCOMES.includes(input?.outcome)) {
    throw new TypeError("Ishod trening pokusaja nije valjan.");
  }
  const sourceTask = tasks.find((task) => task.id === input?.taskId);
  if (!sourceTask) {
    throw new TypeError("Izvorni trening zadatak ne postoji.");
  }
  const attemptedAt = isoDate(
    input?.attemptedAt || new Date().toISOString(),
    "Vrijeme pokusaja",
  ).toISOString();
  const adjustedTaskIds = [];
  const adjustedTasks = tasks.map((task) => {
    const sameWeakness =
      input.outcome === "again" &&
      task.playerId === sourceTask.playerId &&
      task.weaknessKey === sourceTask.weaknessKey;

    if (!sameWeakness) return createTrainingTask(task);

    adjustedTaskIds.push(task.id);
    return createTrainingTask({
      ...task,
      priority: Math.min(
        100,
        task.priority + REPEATED_ERROR_PRIORITY_INCREMENT,
      ),
      updatedAt: attemptedAt,
    });
  });

  return {
    tasks: adjustedTasks,
    adjustedTaskIds,
    increment:
      input.outcome === "again"
        ? REPEATED_ERROR_PRIORITY_INCREMENT
        : 0,
  };
}

export function getDueTrainingTasks(tasks, now = new Date().toISOString()) {
  if (!Array.isArray(tasks)) {
    throw new TypeError("Trening zadaci moraju biti polje.");
  }
  const currentTime = isoDate(now, "Vrijeme provjere").getTime();

  return tasks
    .filter(
      (task) =>
        task.schedule.status !== "suspended" &&
        isoDate(task.schedule.dueAt, "Datum treninga").getTime() <= currentTime,
    )
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        new Date(left.schedule.dueAt) - new Date(right.schedule.dueAt),
    );
}
