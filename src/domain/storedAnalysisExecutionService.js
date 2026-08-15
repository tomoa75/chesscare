import {
  deriveAnalysisTargets,
  loadAnalysisJobsDashboard,
} from "./analysisDashboardService.js";
import { runPositionAnalysisJob } from "./analysisJobService.js";

const activeRunIds = new Set();

export class StoredAnalysisExecutionError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "StoredAnalysisExecutionError";
    this.code = code;
  }
}

function requireOptions(options) {
  if (
    !options?.repository?.readSnapshot ||
    !options.repository.getAnalysisRun
  ) {
    throw new TypeError("Repozitorij ne podrzava spremljene analize.");
  }

  if (
    typeof options.runId !== "string" ||
    options.runId.trim() === ""
  ) {
    throw new TypeError("ID analitickog posla mora biti neprazan string.");
  }
}

export async function executeStoredAnalysisJob(options) {
  requireOptions(options);
  const runId = options.runId.trim();

  if (activeRunIds.has(runId)) {
    throw new StoredAnalysisExecutionError(
      "run-already-active",
      "Ovaj analiticki posao vec je aktivan u trenutnoj kartici.",
    );
  }

  const dashboard = await loadAnalysisJobsDashboard({
    repository: options.repository,
  });
  const job = dashboard.jobs.find((candidate) => candidate.id === runId);

  if (!job) {
    throw new StoredAnalysisExecutionError(
      "run-not-found",
      `Analiticki posao '${runId}' ne postoji.`,
    );
  }

  if (!job.resume.allowed) {
    throw new StoredAnalysisExecutionError(
      job.resume.code,
      job.resume.label,
    );
  }

  const snapshot = await options.repository.readSnapshot();
  const run = snapshot.analysisRuns.find((candidate) => candidate.id === runId);
  const derived = await deriveAnalysisTargets({
    snapshot,
    gameIds: run.gameIds,
    engine: run.engine,
    settings: run.settings,
    forceRefresh: run.forceRefresh,
  });

  activeRunIds.add(runId);

  try {
    return await runPositionAnalysisJob({
      repository: options.repository,
      stockfishClient: options.stockfishClient,
      run,
      positions: derived.targets.map((target) => target.fen),
      signal: options.signal,
      onProgress: options.onProgress,
      now: options.now,
    });
  } finally {
    activeRunIds.delete(runId);
  }
}
