import { createPositionCacheKey } from "./analysisJobService.js";
import {
  createLineFromPgn,
  createPositionTimeline,
} from "./positionService.js";

const STATUS_LABELS = Object.freeze({
  queued: "Na cekanju",
  running: "U tijeku",
  cancelled: "Otkazano",
  completed: "Zavrseno",
  failed: "Neuspjelo",
});

function warning(code, message, context = {}) {
  return {
    code,
    message,
    gameId: context.gameId || null,
  };
}

function uniquePositions(positions) {
  const seen = new Set();

  return positions.filter((fen) => {
    if (seen.has(fen)) return false;
    seen.add(fen);
    return true;
  });
}

function progressPercent(progress, status) {
  if (progress.total === 0) return status === "completed" ? 100 : 0;
  return Math.round((progress.completed / progress.total) * 100);
}

function resumeState(run, targetCount, warnings) {
  if (run.status === "completed") {
    return {
      allowed: false,
      code: "already-completed",
      label: "Analiza je vec zavrsena",
    };
  }

  if (run.status === "running") {
    return {
      allowed: false,
      code: "active-run",
      label: "Aktivni posao se ne pokrece paralelno",
    };
  }

  if (warnings.length > 0 || targetCount === 0) {
    return {
      allowed: false,
      code: "invalid-targets",
      label: "Povezane partije treba prvo provjeriti",
    };
  }

  if (run.progress.total !== 0 && run.progress.total !== targetCount) {
    return {
      allowed: false,
      code: "target-count-mismatch",
      label: "Broj izvedenih pozicija ne odgovara izvornom poslu",
    };
  }

  return {
    allowed: true,
    code: run.status === "queued" ? "ready-to-start" : "ready-to-resume",
    label:
      run.status === "queued"
        ? "Spremno za pokretanje"
        : "Spremno za nastavak iz cachea",
  };
}

export async function deriveAnalysisTargets(options) {
  const { snapshot, gameIds, engine, settings } = options;
  const gamesById = new Map(snapshot.games.map((game) => [game.id, game]));
  const cachedKeys = new Set(
    snapshot.positionEvaluations.map((evaluation) => evaluation.cacheKey),
  );
  const warnings = [];
  const positions = [];
  const games = [];

  for (const gameId of gameIds) {
    const game = gamesById.get(gameId);

    if (!game) {
      warnings.push(
        warning(
          "missing-game",
          `Povezana partija '${gameId}' ne postoji u repositoryju.`,
          { gameId },
        ),
      );
      games.push({ id: gameId, title: gameId, found: false });
      continue;
    }

    games.push({ id: game.id, title: game.title, found: true });

    try {
      const line = createLineFromPgn(game.rawPgn);
      const timeline = createPositionTimeline(line.moves, {
        initialFen: line.initialFen,
      });
      positions.push(...timeline.map((position) => position.fen));
    } catch (error) {
      warnings.push(
        warning(
          "invalid-game-pgn",
          `Partija '${game.title}' nema valjan niz pozicija: ${error.message}`,
          { gameId },
        ),
      );
    }
  }

  const uniqueFens = uniquePositions(positions);
  const targets = await Promise.all(
    uniqueFens.map(async (fen) => ({
      fen,
      cacheKey: await createPositionCacheKey({
        fen,
        engine,
        settings,
      }),
    })),
  );
  const cacheHits = targets.filter((target) =>
    cachedKeys.has(target.cacheKey),
  ).length;
  return {
    games,
    warnings,
    targets,
    cacheHits,
  };
}

async function buildRunView(run, snapshot) {
  const derived = await deriveAnalysisTargets({
    snapshot,
    gameIds: run.gameIds,
    engine: run.engine,
    settings: run.settings,
  });
  const resume = resumeState(
    run,
    derived.targets.length,
    derived.warnings,
  );

  return {
    id: run.id,
    status: run.status,
    statusLabel: STATUS_LABELS[run.status],
    engine: { ...run.engine },
    settings: {
      ...run.settings,
      uciOptions: { ...run.settings.uciOptions },
    },
    progress: {
      ...run.progress,
      percent: progressPercent(run.progress, run.status),
    },
    games: derived.games,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    error: run.error,
    targets: {
      total: derived.targets.length,
      cached: derived.cacheHits,
      remaining: derived.targets.length - derived.cacheHits,
      positions: derived.targets.map((target) => target.fen),
    },
    warnings: derived.warnings,
    resume,
  };
}

export async function loadAnalysisJobsDashboard(options) {
  if (!options?.repository?.readSnapshot) {
    throw new TypeError("Repozitorij mora podrzavati readSnapshot.");
  }

  const snapshot = await options.repository.readSnapshot();
  const jobs = await Promise.all(
    snapshot.analysisRuns.map((run) => buildRunView(run, snapshot)),
  );
  jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return {
    jobs,
    availablePlayers: snapshot.players
      .map((player) => ({
        id: player.id,
        displayName: player.displayName,
        aliases: [...player.aliases],
      }))
      .sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      ),
    availableGames: snapshot.games
      .map((game) => ({
        id: game.id,
        title: game.title,
        white: game.headers.White || "Bijeli",
        black: game.headers.Black || "Crni",
      }))
      .sort((left, right) => left.title.localeCompare(right.title)),
    summary: {
      total: jobs.length,
      queued: jobs.filter((job) => job.status === "queued").length,
      running: jobs.filter((job) => job.status === "running").length,
      completed: jobs.filter((job) => job.status === "completed").length,
      failedOrCancelled: jobs.filter(
        (job) => job.status === "failed" || job.status === "cancelled",
      ).length,
      resumable: jobs.filter((job) => job.resume.allowed).length,
      cachedPositions: jobs.reduce(
        (total, job) => total + job.targets.cached,
        0,
      ),
    },
  };
}
