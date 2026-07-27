import { buildPersonalizedMoveAnalyses } from "./playerAnalysisService.js";
import { sha256Hex, stableStringify } from "./stableHash.js";

const BLOCKING_WARNING_CODES = new Set([
  "analysis-run-not-completed",
  "missing-game",
  "invalid-game-pgn",
  "ambiguous-player-color",
  "missing-position-evaluation",
  "player-not-in-run-games",
]);

export class PersonalizedMaterializationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "PersonalizedMaterializationError";
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
  if (typeof options.runId !== "string" || !options.runId.trim()) {
    throw new TypeError("ID analitickog posla mora biti neprazan string.");
  }
  if (typeof options.playerId !== "string" || !options.playerId.trim()) {
    throw new TypeError("ID profila igraca mora biti neprazan string.");
  }
}

async function previewToken(snapshot, runId, playerId) {
  return `sha256:${await sha256Hex(
    stableStringify({
      snapshot,
      request: { runId, playerId },
    }),
  )}`;
}

function warning(code, message, context = {}) {
  return {
    code,
    message,
    gameId: context.gameId || null,
  };
}

export async function createPersonalizedMaterializationPreview(options) {
  requireOptions(options);
  const runId = options.runId.trim();
  const playerId = options.playerId.trim();
  const snapshot = await options.repository.readSnapshot();
  const run = snapshot.analysisRuns.find((item) => item.id === runId);
  const player = snapshot.players.find((item) => item.id === playerId);

  if (!run) {
    throw new PersonalizedMaterializationError(
      "run-not-found",
      `Analiticki posao '${runId}' ne postoji.`,
    );
  }
  if (!player) {
    throw new PersonalizedMaterializationError(
      "player-not-found",
      `Profil igraca '${playerId}' ne postoji.`,
    );
  }

  const gamesById = new Map(snapshot.games.map((game) => [game.id, game]));
  const games = [];
  const serviceWarnings = [];

  for (const gameId of run.gameIds) {
    const game = gamesById.get(gameId);

    if (game) {
      games.push(game);
    } else {
      serviceWarnings.push(
        warning(
          "missing-game",
          `Povezana partija '${gameId}' ne postoji.`,
          { gameId },
        ),
      );
    }
  }

  if (run.status !== "completed") {
    serviceWarnings.push(
      warning(
        "analysis-run-not-completed",
        "Personalizirani rezultati mogu se izraditi samo iz dovrsenog posla.",
      ),
    );
  }

  const built = await buildPersonalizedMoveAnalyses({
    games,
    player,
    positionEvaluations: snapshot.positionEvaluations,
    engine: run.engine,
    settings: run.settings,
    analysisRunId: run.id,
  });
  const warnings = [...serviceWarnings, ...built.warnings];

  if (built.gameMatches.length === 0) {
    warnings.push(
      warning(
        "player-not-in-run-games",
        "Odabrani profil nije prepoznat ni u jednoj partiji ovog posla.",
      ),
    );
  }

  const existingById = new Map(
    snapshot.moveAnalyses.map((analysis) => [analysis.id, analysis]),
  );
  const toAdd = [];
  const unchanged = [];
  const conflicts = [];

  for (const candidate of built.moveAnalyses) {
    const existing = existingById.get(candidate.id);

    if (!existing) {
      toAdd.push(candidate);
    } else if (stableStringify(existing) === stableStringify(candidate)) {
      unchanged.push(candidate.id);
    } else {
      conflicts.push({
        code: "move-analysis-conflict",
        moveAnalysisId: candidate.id,
        gameId: candidate.gameId,
        ply: candidate.ply,
      });
    }
  }

  const blockingWarnings = warnings.filter((item) =>
    BLOCKING_WARNING_CODES.has(item.code),
  );

  return {
    token: await previewToken(snapshot, runId, playerId),
    run: {
      id: run.id,
      engine: { ...run.engine },
      settings: {
        ...run.settings,
        uciOptions: { ...run.settings.uciOptions },
      },
      gameIds: [...run.gameIds],
    },
    player: {
      id: player.id,
      displayName: player.displayName,
      aliases: [...player.aliases],
    },
    gameMatches: built.gameMatches,
    warnings,
    blockingWarnings,
    conflicts,
    moveAnalyses: built.moveAnalyses,
    toAdd,
    summary: {
      gamesInRun: run.gameIds.length,
      gamesMatched: built.gameMatches.length,
      playerMoveContexts: built.contexts.length,
      generated: built.moveAnalyses.length,
      toAdd: toAdd.length,
      unchanged: unchanged.length,
      conflicts: conflicts.length,
      warnings: warnings.length,
    },
    canMaterialize:
      built.moveAnalyses.length > 0 &&
      blockingWarnings.length === 0 &&
      conflicts.length === 0,
  };
}

export async function confirmPersonalizedMaterialization(options) {
  requireOptions(options, true);

  if (
    typeof options.previewToken !== "string" ||
    !options.previewToken.trim()
  ) {
    throw new PersonalizedMaterializationError(
      "confirmation-required",
      "Materijalizacija zahtijeva token potvrdenog previewa.",
    );
  }

  const preview = await createPersonalizedMaterializationPreview(options);

  if (preview.token !== options.previewToken) {
    if (
      preview.summary.generated > 0 &&
      preview.summary.toAdd === 0 &&
      preview.conflicts.length === 0
    ) {
      return {
        status: "already-materialized",
        added: 0,
        unchanged: preview.summary.unchanged,
      };
    }

    throw new PersonalizedMaterializationError(
      "stale-preview",
      "Domenski podaci promijenili su se nakon previewa.",
    );
  }

  if (!preview.canMaterialize) {
    throw new PersonalizedMaterializationError(
      "materialization-blocked",
      "Personalizirani rezultati imaju blokirajuce upozorenje ili konflikt.",
    );
  }

  if (preview.toAdd.length === 0) {
    return {
      status: "no-changes",
      added: 0,
      unchanged: preview.summary.unchanged,
    };
  }

  const snapshot = await options.repository.readSnapshot();
  snapshot.moveAnalyses.push(...preview.toAdd);
  await options.repository.replaceSnapshot(snapshot);

  return {
    status: "materialized",
    added: preview.toAdd.length,
    unchanged: preview.summary.unchanged,
  };
}

