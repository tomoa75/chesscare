import { Chess } from "chess.js";
import { sha256Hex, stableStringify } from "./stableHash.js";
import {
  adjustTrainingPrioritiesAfterAttempt,
  applyTrainingAttempt,
  getDueTrainingTasks,
} from "./trainingService.js";

const CORRECT_OUTCOMES = Object.freeze(["hard", "good", "easy"]);
const INCORRECT_OUTCOMES = Object.freeze(["again"]);

export class TrainingSessionError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "TrainingSessionError";
    this.code = code;
  }
}

function requireRepository(options, requireWrite = false) {
  if (!options?.repository?.readSnapshot) {
    throw new TypeError("Repozitorij mora podrzavati readSnapshot.");
  }
  if (requireWrite && !options.repository.replaceSnapshot) {
    throw new TypeError("Repozitorij mora podrzavati replaceSnapshot.");
  }
}

function isoTime(value, fieldName) {
  const date = new Date(value);
  if (typeof value !== "string" || Number.isNaN(date.getTime())) {
    throw new TypeError(`${fieldName} mora biti valjani ISO datum.`);
  }
  return date.toISOString();
}

function taskView(task) {
  return {
    ...task,
    id: task.id,
    playerId: task.playerId,
    fen: task.fen,
    color: task.color,
    phase: task.phase,
    classification: task.classification,
    centipawnLoss: task.centipawnLoss,
    priority: task.priority,
    tags: [...task.tags],
    playedMove: { ...task.playedMove },
    bestMove: { ...task.bestMove },
    alternatives: task.alternatives.map((move) => ({ ...move })),
    source: { ...task.source },
    schedule: { ...task.schedule },
  };
}

export async function loadTrainingSession(options) {
  requireRepository(options);
  const now = isoTime(
    options.now || new Date().toISOString(),
    "Vrijeme treninga",
  );
  const snapshot = await options.repository.readSnapshot();
  const playerId = options.playerId || "";
  const player = playerId
    ? snapshot.players.find((item) => item.id === playerId)
    : null;

  if (playerId && !player) {
    throw new TrainingSessionError(
      "player-not-found",
      `Profil igraca '${playerId}' ne postoji.`,
    );
  }

  const players = snapshot.players
    .map((item) => {
      const tasks = snapshot.trainingTasks.filter(
        (task) => task.playerId === item.id,
      );
      return {
        id: item.id,
        displayName: item.displayName,
        totalTasks: tasks.length,
        dueTasks: getDueTrainingTasks(tasks, now).length,
      };
    })
    .sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    );
  const playerTasks = player
    ? snapshot.trainingTasks.filter((task) => task.playerId === player.id)
    : [];
  const dueTasks = getDueTrainingTasks(playerTasks, now);

  return {
    now,
    players,
    selectedPlayer: player
      ? { id: player.id, displayName: player.displayName }
      : null,
    dueTasks: dueTasks.map(taskView),
    currentTask: dueTasks.length > 0 ? taskView(dueTasks[0]) : null,
    summary: {
      totalTasks: playerTasks.length,
      dueTasks: dueTasks.length,
      completedAttempts: player
        ? snapshot.trainingAttempts.filter(
            (attempt) => attempt.playerId === player.id,
          ).length
        : 0,
    },
  };
}

function normalizeAttempt(task, attemptedMove) {
  if (
    !attemptedMove ||
    typeof attemptedMove.from !== "string" ||
    typeof attemptedMove.to !== "string"
  ) {
    throw new TypeError("Pokusani potez mora sadrzavati polja from i to.");
  }

  let chess;
  try {
    chess = new Chess(task.fen);
  } catch (error) {
    throw new TrainingSessionError(
      "invalid-task-position",
      "Trening zadatak nema valjanu pocetnu poziciju.",
      { cause: error },
    );
  }

  let move;
  try {
    move = chess.move({
      from: attemptedMove.from,
      to: attemptedMove.to,
      promotion: attemptedMove.promotion || "q",
    });
  } catch {
    move = null;
  }

  if (!move) {
    throw new TrainingSessionError(
      "illegal-move",
      "Potez nije legalan u zadanoj poziciji.",
    );
  }

  return {
    move: {
      san: move.san,
      uci: `${move.from}${move.to}${move.promotion || ""}`,
    },
    resultingFen: chess.fen(),
  };
}

function moveMatches(candidate, expected) {
  if (!expected) return false;
  if (expected.uci && candidate.uci === expected.uci) return true;
  return candidate.san === expected.san;
}

function attemptId(taskId, attemptedAt) {
  return `training-attempt-${taskId}-${Date.parse(attemptedAt)}`;
}

async function previewToken(snapshot, request) {
  return `sha256:${await sha256Hex(
    stableStringify({ snapshot, request }),
  )}`;
}

export async function createTrainingAttemptPreview(options) {
  requireRepository(options);
  if (typeof options.taskId !== "string" || !options.taskId.trim()) {
    throw new TypeError("ID trening zadatka mora biti neprazan string.");
  }
  const attemptedAt = isoTime(
    options.attemptedAt || new Date().toISOString(),
    "Vrijeme pokusaja",
  );
  const snapshot = await options.repository.readSnapshot();
  const task = snapshot.trainingTasks.find(
    (item) => item.id === options.taskId.trim(),
  );

  if (!task) {
    throw new TrainingSessionError(
      "task-not-found",
      `Trening zadatak '${options.taskId}' ne postoji.`,
    );
  }
  if (new Date(task.schedule.dueAt).getTime() > Date.parse(attemptedAt)) {
    throw new TrainingSessionError(
      "task-not-due",
      "Trening zadatak jos nije dospio za ponavljanje.",
    );
  }

  const normalized = normalizeAttempt(task, options.attemptedMove);
  const correct = [task.bestMove, ...task.alternatives].some((move) =>
    moveMatches(normalized.move, move),
  );
  const request = {
    taskId: task.id,
    attemptedMove: normalized.move,
    attemptedAt,
  };

  return {
    token: await previewToken(snapshot, request),
    attemptId: attemptId(task.id, attemptedAt),
    attemptedAt,
    task: taskView(task),
    attemptedMove: normalized.move,
    resultingFen: normalized.resultingFen,
    correct,
    expectedMove: { ...task.bestMove },
    allowedOutcomes: correct
      ? [...CORRECT_OUTCOMES]
      : [...INCORRECT_OUTCOMES],
  };
}

export async function confirmTrainingAttempt(options) {
  requireRepository(options, true);
  if (
    typeof options.previewToken !== "string" ||
    !options.previewToken.trim()
  ) {
    throw new TrainingSessionError(
      "confirmation-required",
      "Biljezenje pokusaja zahtijeva token previewa.",
    );
  }

  const attemptedAt = isoTime(options.attemptedAt, "Vrijeme pokusaja");
  const id = attemptId(options.taskId, attemptedAt);
  const initialSnapshot = await options.repository.readSnapshot();
  const existing = initialSnapshot.trainingAttempts.find(
    (attempt) => attempt.id === id,
  );

  if (existing) {
    const existingTask = initialSnapshot.trainingTasks.find(
      (task) => task.id === existing.taskId,
    );
    const normalizedMove = existingTask
      ? normalizeAttempt(existingTask, options.attemptedMove).move
      : null;
    const sameRequest =
      existing.outcome === options.outcome &&
      stableStringify(existing.attemptedMove) ===
        stableStringify(normalizedMove);
    if (sameRequest) {
      return {
        status: "already-recorded",
        attempt: existing,
        task: existingTask || null,
      };
    }
    throw new TrainingSessionError(
      "attempt-id-conflict",
      "Pokusaj s istim identitetom vec postoji s drugim podacima.",
    );
  }

  const preview = await createTrainingAttemptPreview(options);
  if (preview.token !== options.previewToken) {
    throw new TrainingSessionError(
      "stale-preview",
      "Domenski podaci promijenili su se nakon poteza.",
    );
  }
  if (!preview.allowedOutcomes.includes(options.outcome)) {
    throw new TrainingSessionError(
      "invalid-outcome",
      preview.correct
        ? "Tocan potez mora koristiti hard, good ili easy."
        : "Netocan potez mora koristiti again.",
    );
  }

  const applied = applyTrainingAttempt(
    preview.task,
    {
      id,
      outcome: options.outcome,
      attemptedMove: preview.attemptedMove,
      attemptedAt,
    },
    { now: attemptedAt },
  );
  const snapshot = await options.repository.readSnapshot();
  const finalToken = await previewToken(snapshot, {
    taskId: preview.task.id,
    attemptedMove: preview.attemptedMove,
    attemptedAt,
  });
  if (finalToken !== preview.token) {
    throw new TrainingSessionError(
      "stale-preview",
      "Domenski podaci promijenili su se prije spremanja pokusaja.",
    );
  }
  if (
    snapshot.trainingAttempts.some(
      (attempt) => attempt.id === applied.attempt.id,
    )
  ) {
    throw new TrainingSessionError(
      "attempt-id-conflict",
      "Pokusaj s istim identitetom vec postoji.",
    );
  }
  const taskIndex = snapshot.trainingTasks.findIndex(
    (task) => task.id === preview.task.id,
  );
  if (taskIndex === -1) {
    throw new TrainingSessionError(
      "task-not-found",
      "Trening zadatak je uklonjen prije spremanja pokusaja.",
    );
  }

  snapshot.trainingTasks[taskIndex] = applied.task;
  const priorityAdjustment = adjustTrainingPrioritiesAfterAttempt(
    snapshot.trainingTasks,
    {
      taskId: applied.task.id,
      outcome: options.outcome,
      attemptedAt,
    },
  );
  snapshot.trainingTasks = priorityAdjustment.tasks;
  snapshot.trainingAttempts.push(applied.attempt);
  await options.repository.replaceSnapshot(snapshot);
  const storedTask = snapshot.trainingTasks.find(
    (task) => task.id === applied.task.id,
  );

  return {
    status: "recorded",
    task: storedTask,
    attempt: applied.attempt,
    priorityAdjustment: {
      increment: priorityAdjustment.increment,
      adjustedTaskIds: priorityAdjustment.adjustedTaskIds,
    },
  };
}
