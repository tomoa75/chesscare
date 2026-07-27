import { TRAINING_TASK_STATUSES } from "./constants.js";
import { getDueTrainingTasks } from "./trainingService.js";

const OUTCOMES = ["again", "hard", "good", "easy"];

function emptyOutcomeCounts() {
  return Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0]));
}

function summarizeGroup(tasks, attempts, dueTaskIds) {
  const taskIds = new Set(tasks.map((task) => task.id));
  const groupAttempts = attempts.filter((attempt) =>
    taskIds.has(attempt.taskId),
  );
  const outcomes = emptyOutcomeCounts();
  for (const attempt of groupAttempts) outcomes[attempt.outcome] += 1;
  const correct = groupAttempts.filter((attempt) => attempt.correct).length;

  return {
    taskCount: tasks.length,
    dueTaskCount: tasks.filter((task) => dueTaskIds.has(task.id)).length,
    attemptCount: groupAttempts.length,
    correctAttempts: correct,
    successRate: groupAttempts.length
      ? (correct / groupAttempts.length) * 100
      : 0,
    averagePriority: tasks.length
      ? tasks.reduce((sum, task) => sum + task.priority, 0) / tasks.length
      : 0,
    outcomes,
    confidence:
      groupAttempts.length >= 20
        ? "high"
        : groupAttempts.length >= 5
          ? "medium"
          : "low",
  };
}

function groupedReport(tasks, attempts, dueTaskIds, selector) {
  const keys = [...new Set(tasks.map(selector))];
  return keys
    .map((key) => ({
      key,
      ...summarizeGroup(
        tasks.filter((task) => selector(task) === key),
        attempts,
        dueTaskIds,
      ),
    }))
    .sort(
      (left, right) =>
        right.attemptCount - left.attemptCount ||
        right.averagePriority - left.averagePriority ||
        left.key.localeCompare(right.key),
    );
}

function requireTime(value) {
  const date = new Date(value);
  if (typeof value !== "string" || Number.isNaN(date.getTime())) {
    throw new TypeError("Vrijeme izvjestaja mora biti valjani ISO datum.");
  }
  return date.toISOString();
}

export async function loadTrainingProgress(options) {
  if (!options?.repository?.readSnapshot) {
    throw new TypeError("Repozitorij mora podrzavati readSnapshot.");
  }
  const now = requireTime(options.now || new Date().toISOString());
  const snapshot = await options.repository.readSnapshot();
  const playerId = options.playerId || "";
  const player = playerId
    ? snapshot.players.find((item) => item.id === playerId)
    : null;

  if (playerId && !player) {
    throw new TypeError(`Profil igraca '${playerId}' ne postoji.`);
  }

  const players = snapshot.players
    .map((item) => ({
      id: item.id,
      displayName: item.displayName,
      taskCount: snapshot.trainingTasks.filter(
        (task) => task.playerId === item.id,
      ).length,
      attemptCount: snapshot.trainingAttempts.filter(
        (attempt) => attempt.playerId === item.id,
      ).length,
    }))
    .sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    );

  if (!player) {
    return {
      now,
      players,
      selectedPlayer: null,
      report: null,
      warnings: [],
    };
  }

  const tasks = snapshot.trainingTasks.filter(
    (task) => task.playerId === player.id,
  );
  const attempts = snapshot.trainingAttempts.filter(
    (attempt) => attempt.playerId === player.id,
  );
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const dueTaskIds = new Set(
    getDueTrainingTasks(tasks, now).map((task) => task.id),
  );
  const warnings = [
    ...new Set(
      attempts
        .filter((attempt) => !tasksById.has(attempt.taskId))
        .map((attempt) => attempt.taskId),
    ),
  ].map((taskId) => ({
    code: "missing-training-task",
    taskId,
    message: `Pokusaj se poziva na trening zadatak '${taskId}' koji ne postoji.`,
  }));
  const overall = summarizeGroup(tasks, attempts, dueTaskIds);
  const schedule = Object.fromEntries(
    TRAINING_TASK_STATUSES.map((status) => [
      status,
      tasks.filter((task) => task.schedule.status === status).length,
    ]),
  );
  const recentAttempts = [...attempts]
    .sort((left, right) =>
      right.attemptedAt.localeCompare(left.attemptedAt),
    )
    .slice(0, 10)
    .map((attempt) => {
      const task = tasksById.get(attempt.taskId);
      return {
        id: attempt.id,
        taskId: attempt.taskId,
        taskFound: Boolean(task),
        gameTitle: task?.source.gameTitle || null,
        weaknessKey: task?.weaknessKey || null,
        outcome: attempt.outcome,
        correct: attempt.correct,
        attemptedMove: attempt.attemptedMove
          ? { ...attempt.attemptedMove }
          : null,
        attemptedAt: attempt.attemptedAt,
      };
    });

  return {
    now,
    players,
    selectedPlayer: {
      id: player.id,
      displayName: player.displayName,
    },
    warnings,
    report: {
      overall,
      schedule,
      byWeakness: groupedReport(
        tasks,
        attempts,
        dueTaskIds,
        (task) => task.weaknessKey,
      ),
      byPhase: groupedReport(
        tasks,
        attempts,
        dueTaskIds,
        (task) => task.phase,
      ),
      recentAttempts,
    },
  };
}
