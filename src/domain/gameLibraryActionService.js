import { sha256Hex, stableStringify } from "./stableHash.js";

export class GameLibraryActionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GameLibraryActionError";
    this.code = code;
  }
}

function requireRepository(repository) {
  if (!repository?.readSnapshot || !repository?.replaceSnapshot) {
    throw new TypeError(
      "Repozitorij mora podrzavati readSnapshot i replaceSnapshot.",
    );
  }
}

async function snapshotToken(snapshot, gameId) {
  return sha256Hex(stableStringify({ gameId, snapshot }));
}

function deletionImpact(snapshot, gameId) {
  const game = snapshot.games.find((candidate) => candidate.id === gameId);
  if (!game) {
    throw new GameLibraryActionError(
      "game-not-found",
      "Partija vise ne postoji u domenskoj biblioteci.",
    );
  }

  const linkedRuns = snapshot.analysisRuns.filter((run) =>
    run.gameIds.includes(gameId),
  );
  const sharedRuns = linkedRuns.filter((run) => run.gameIds.length > 1);
  const removableRunIds = new Set(
    linkedRuns
      .filter((run) => run.gameIds.length === 1)
      .map((run) => run.id),
  );
  const removableMoveIds = new Set(
    snapshot.moveAnalyses
      .filter(
        (move) =>
          move.gameId === gameId || removableRunIds.has(move.analysisRunId),
      )
      .map((move) => move.id),
  );
  const removableTaskIds = new Set(
    snapshot.trainingTasks
      .filter(
        (task) =>
          task.source.gameId === gameId ||
          removableRunIds.has(task.source.analysisRunId) ||
          removableMoveIds.has(task.source.moveAnalysisId),
      )
      .map((task) => task.id),
  );

  return {
    game: { id: game.id, title: game.title },
    canDelete: sharedRuns.length === 0,
    blockers: sharedRuns.map((run) => ({
      analysisRunId: run.id,
      otherGameIds: run.gameIds.filter((id) => id !== gameId),
    })),
    removals: {
      games: 1,
      analysisRuns: removableRunIds.size,
      moveAnalyses: removableMoveIds.size,
      trainingTasks: removableTaskIds.size,
      trainingAttempts: snapshot.trainingAttempts.filter((attempt) =>
        removableTaskIds.has(attempt.taskId),
      ).length,
    },
    preservedPositionEvaluations: snapshot.positionEvaluations.length,
    removableRunIds,
    removableMoveIds,
    removableTaskIds,
  };
}

export async function previewDomainGameDeletion(options) {
  requireRepository(options?.repository);
  const gameId = String(options?.gameId || "").trim();
  if (!gameId) throw new TypeError("ID partije je obavezan.");

  const snapshot = await options.repository.readSnapshot();
  const impact = deletionImpact(snapshot, gameId);

  return {
    game: impact.game,
    canDelete: impact.canDelete,
    blockers: impact.blockers,
    removals: impact.removals,
    preservedPositionEvaluations: impact.preservedPositionEvaluations,
    confirmationToken: await snapshotToken(snapshot, gameId),
  };
}

export async function deleteDomainGame(options) {
  requireRepository(options?.repository);
  const gameId = String(options?.gameId || "").trim();
  const confirmationToken = String(options?.confirmationToken || "").trim();
  if (!gameId || !confirmationToken) {
    throw new TypeError("ID partije i token potvrde su obavezni.");
  }

  const snapshot = await options.repository.readSnapshot();
  const currentToken = await snapshotToken(snapshot, gameId);
  if (currentToken !== confirmationToken) {
    throw new GameLibraryActionError(
      "stale-preview",
      "Podaci su se promijenili. Pregledaj utjecaj brisanja ponovno.",
    );
  }

  const impact = deletionImpact(snapshot, gameId);
  if (!impact.canDelete) {
    throw new GameLibraryActionError(
      "shared-analysis-run",
      "Partija pripada analizi s vise partija i ne moze se sigurno obrisati.",
    );
  }

  const nextSnapshot = {
    ...snapshot,
    games: snapshot.games.filter((game) => game.id !== gameId),
    analysisRuns: snapshot.analysisRuns.filter(
      (run) => !impact.removableRunIds.has(run.id),
    ),
    moveAnalyses: snapshot.moveAnalyses.filter(
      (move) => !impact.removableMoveIds.has(move.id),
    ),
    trainingTasks: snapshot.trainingTasks.filter(
      (task) => !impact.removableTaskIds.has(task.id),
    ),
    trainingAttempts: snapshot.trainingAttempts.filter(
      (attempt) => !impact.removableTaskIds.has(attempt.taskId),
    ),
  };

  await options.repository.replaceSnapshot(nextSnapshot);
  return {
    game: impact.game,
    removals: impact.removals,
    preservedPositionEvaluations: impact.preservedPositionEvaluations,
  };
}
