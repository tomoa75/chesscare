import { createAnalysisRun } from "./analysis.js";
import { deriveAnalysisTargets } from "./analysisDashboardService.js";
import { sha256Hex, stableStringify } from "./stableHash.js";

export class AnalysisJobCreationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "AnalysisJobCreationError";
    this.code = code;
  }
}

function requireOptions(options) {
  if (
    !options?.repository?.readSnapshot ||
    !options.repository.saveAnalysisRun ||
    !options.repository.getAnalysisRun
  ) {
    throw new TypeError("Repozitorij ne podrzava stvaranje analiza.");
  }

  if (!Array.isArray(options.gameIds) || options.gameIds.length === 0) {
    throw new TypeError("Odaberi barem jednu partiju za analizu.");
  }
}

function uniqueGameIds(gameIds) {
  return [
    ...new Set(
      gameIds.map((gameId) => {
        if (typeof gameId !== "string" || gameId.trim() === "") {
          throw new TypeError("ID partije mora biti neprazan string.");
        }

        return gameId.trim();
      }),
    ),
  ];
}

function analysisIdFromToken(token) {
  return `analysis-sha256-${token.slice("sha256:".length)}`;
}

async function createToken(snapshot, request) {
  return `sha256:${await sha256Hex(
    stableStringify({
      snapshot,
      request,
    }),
  )}`;
}

export async function createAnalysisJobPreview(options) {
  requireOptions(options);

  const gameIds = uniqueGameIds(options.gameIds);
  const snapshot = await options.repository.readSnapshot();
  const validatedDraft = createAnalysisRun(
    {
      id: "analysis-preview",
      gameIds,
      engine: options.engine,
      settings: options.settings,
      forceRefresh: options.forceRefresh,
      status: "queued",
      progress: { completed: 0, total: 0 },
    },
    { now: options.now },
  );
  const derived = await deriveAnalysisTargets({
    snapshot,
    gameIds: validatedDraft.gameIds,
    engine: validatedDraft.engine,
    settings: validatedDraft.settings,
    forceRefresh: validatedDraft.forceRefresh,
  });
  const request = {
    gameIds: validatedDraft.gameIds,
    engine: validatedDraft.engine,
    settings: validatedDraft.settings,
    forceRefresh: validatedDraft.forceRefresh,
  };
  const token = await createToken(snapshot, request);
  const run = createAnalysisRun(
    {
      ...validatedDraft,
      id: analysisIdFromToken(token),
      progress: {
        completed: 0,
        total: derived.targets.length,
      },
    },
    { now: options.now },
  );

  return {
    token,
    run,
    games: derived.games,
    warnings: derived.warnings,
    targets: {
      total: derived.targets.length,
      cached: derived.cacheHits,
      remaining: derived.targets.length - derived.cacheHits,
    },
    canCreate:
      derived.warnings.length === 0 && derived.targets.length > 0,
  };
}

export async function confirmAnalysisJobCreation(options) {
  requireOptions(options);

  if (
    typeof options.previewToken !== "string" ||
    options.previewToken.trim() === ""
  ) {
    throw new AnalysisJobCreationError(
      "confirmation-required",
      "Stvaranje posla zahtijeva token potvrdenog previewa.",
    );
  }

  const expectedId = analysisIdFromToken(options.previewToken);
  const existing = await options.repository.getAnalysisRun(expectedId);

  if (existing) {
    return {
      status: "already-created",
      run: existing,
    };
  }

  const preview = await createAnalysisJobPreview(options);

  if (preview.token !== options.previewToken) {
    throw new AnalysisJobCreationError(
      "stale-preview",
      "Domenski podaci ili odabir promijenili su se nakon previewa.",
    );
  }

  if (!preview.canCreate) {
    throw new AnalysisJobCreationError(
      "invalid-targets",
      "Posao se ne moze stvoriti dok povezane partije imaju upozorenja.",
    );
  }

  await options.repository.saveAnalysisRun(preview.run);

  return {
    status: "created",
    run: preview.run,
  };
}
