import { sha256Hex, stableStringify } from "./stableHash.js";
import { generateTrainingTasks } from "./trainingService.js";
import { getDueTrainingTasks } from "./trainingService.js";

export class TrainingMaterializationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "TrainingMaterializationError";
    this.code = code;
  }
}

function requireOptions(options, requireWrite = false) {
  if (!options?.repository?.readSnapshot) {
    throw new TypeError("Repozitorij mora podrzavati readSnapshot.");
  }
  if (requireWrite && !options.repository.replaceSnapshot) {
    throw new TypeError("Repozitorij mora podrzavati replaceSnapshot.");
  }
  if (typeof options.playerId !== "string" || !options.playerId.trim()) {
    throw new TypeError("ID profila igraca mora biti neprazan string.");
  }
  if (
    options.minimumLoss !== undefined &&
    (!Number.isFinite(options.minimumLoss) || options.minimumLoss < 0)
  ) {
    throw new TypeError("Minimalni gubitak mora biti nenegativan broj.");
  }
}

function requireReferenceTime(value) {
  const date = new Date(value);
  if (typeof value !== "string" || Number.isNaN(date.getTime())) {
    throw new TypeError("Vrijeme previewa mora biti valjani ISO datum.");
  }
  return date.toISOString();
}

async function createToken(snapshot, request) {
  return `sha256:${await sha256Hex(
    stableStringify({ snapshot, request }),
  )}`;
}

function exclusionSummary(playerMoves, minimumLoss) {
  return {
    good: playerMoves.filter((move) => move.classification === "good")
      .length,
    belowThreshold: playerMoves.filter(
      (move) =>
        move.classification !== "good" &&
        move.centipawnLoss < minimumLoss,
    ).length,
    missingBestMove: playerMoves.filter(
      (move) =>
        move.classification !== "good" &&
        move.centipawnLoss >= minimumLoss &&
        !move.bestMove,
    ).length,
  };
}

export async function loadTrainingMaterializationDashboard(options) {
  if (!options?.repository?.readSnapshot) {
    throw new TypeError("Repozitorij mora podrzavati readSnapshot.");
  }
  const referenceTime = requireReferenceTime(
    options.referenceTime || new Date().toISOString(),
  );
  const snapshot = await options.repository.readSnapshot();

  return {
    players: snapshot.players
      .map((player) => {
        const analyzedMoves = snapshot.moveAnalyses.filter(
          (move) => move.playerId === player.id,
        ).length;
        const tasks = snapshot.trainingTasks.filter(
          (task) => task.playerId === player.id,
        );

        return {
          id: player.id,
          displayName: player.displayName,
          analyzedMoves,
          trainingTasks: tasks.length,
          dueTasks: getDueTrainingTasks(tasks, referenceTime).length,
        };
      })
      .sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      ),
    summary: {
      totalTasks: snapshot.trainingTasks.length,
      dueTasks: getDueTrainingTasks(
        snapshot.trainingTasks,
        referenceTime,
      ).length,
      totalAttempts: snapshot.trainingAttempts.length,
    },
    referenceTime,
  };
}

export async function createTrainingMaterializationPreview(options) {
  requireOptions(options);
  const playerId = options.playerId.trim();
  const minimumLoss = options.minimumLoss ?? 50;
  const referenceTime = requireReferenceTime(
    options.referenceTime || new Date().toISOString(),
  );
  const snapshot = await options.repository.readSnapshot();
  const player = snapshot.players.find((item) => item.id === playerId);

  if (!player) {
    throw new TrainingMaterializationError(
      "player-not-found",
      `Profil igraca '${playerId}' ne postoji.`,
    );
  }

  const playerMoves = snapshot.moveAnalyses.filter(
    (move) => move.playerId === player.id,
  );
  const eligibleMoves = playerMoves.filter(
    (move) =>
      move.classification !== "good" &&
      move.centipawnLoss >= minimumLoss &&
      move.bestMove,
  );
  const generated = generateTrainingTasks({
    player,
    moveAnalyses: snapshot.moveAnalyses,
    games: snapshot.games,
    existingTasks: snapshot.trainingTasks,
    minimumLoss,
    now: referenceTime,
  });
  const existingById = new Map(
    snapshot.trainingTasks.map((task) => [task.id, task]),
  );
  const toAdd = [];
  const conflicts = [];

  for (const candidate of generated.created) {
    const existing = existingById.get(candidate.id);
    if (!existing) {
      toAdd.push(candidate);
    } else {
      conflicts.push({
        code: "training-task-id-conflict",
        taskId: candidate.id,
        moveAnalysisId: candidate.source.moveAnalysisId,
        message: `Trening zadatak '${candidate.id}' vec postoji za drugi izvor.`,
      });
    }
  }

  const missingGames = generated.skipped
    .filter((item) => item.reason === "missing-game")
    .map((item) => ({
      code: "missing-game",
      moveAnalysisId: item.moveAnalysisId,
      message: `Izvorna partija za analizu poteza '${item.moveAnalysisId}' ne postoji.`,
    }));
  const unchanged = generated.skipped.filter(
    (item) => item.reason === "already-exists",
  );
  const request = { playerId, minimumLoss, referenceTime };

  return {
    token: await createToken(snapshot, request),
    referenceTime,
    minimumLoss,
    player: {
      id: player.id,
      displayName: player.displayName,
    },
    tasks: generated.created,
    toAdd,
    unchanged,
    warnings: missingGames,
    conflicts,
    exclusions: exclusionSummary(playerMoves, minimumLoss),
    summary: {
      analyzedMoves: playerMoves.length,
      eligibleMoves: eligibleMoves.length,
      generated: generated.created.length,
      toAdd: toAdd.length,
      unchanged: unchanged.length,
      warnings: missingGames.length,
      conflicts: conflicts.length,
    },
    canMaterialize:
      toAdd.length > 0 &&
      missingGames.length === 0 &&
      conflicts.length === 0,
  };
}

export async function confirmTrainingMaterialization(options) {
  requireOptions(options, true);
  if (
    typeof options.previewToken !== "string" ||
    !options.previewToken.trim()
  ) {
    throw new TrainingMaterializationError(
      "confirmation-required",
      "Spremanje treninga zahtijeva token potvrdenog previewa.",
    );
  }

  const preview = await createTrainingMaterializationPreview({
    ...options,
    referenceTime: requireReferenceTime(options.referenceTime),
  });

  if (preview.token !== options.previewToken) {
    if (
      preview.summary.eligibleMoves > 0 &&
      preview.summary.toAdd === 0 &&
      preview.conflicts.length === 0 &&
      preview.warnings.length === 0
    ) {
      return {
        status: "already-materialized",
        added: 0,
        unchanged: preview.summary.unchanged,
      };
    }

    throw new TrainingMaterializationError(
      "stale-preview",
      "Domenski podaci promijenili su se nakon previewa.",
    );
  }

  if (!preview.canMaterialize) {
    throw new TrainingMaterializationError(
      "materialization-blocked",
      "Trening zadaci imaju blokirajuce upozorenje, konflikt ili nema novih zadataka.",
    );
  }

  const snapshot = await options.repository.readSnapshot();
  snapshot.trainingTasks.push(...preview.toAdd);
  await options.repository.replaceSnapshot(snapshot);

  return {
    status: "materialized",
    added: preview.toAdd.length,
    unchanged: preview.summary.unchanged,
  };
}
