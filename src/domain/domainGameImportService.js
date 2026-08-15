import { adaptLegacyGameRecords } from "./legacyGameAdapter.js";
import { readDataAuthority } from "./dataAuthority.js";
import {
  createMemoryDomainRepository,
  importLegacyAdapterResult,
} from "./repository.js";
import { sha256Hex } from "./stableHash.js";

export class DomainGameImportError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "DomainGameImportError";
    this.code = code;
  }
}

function requireOptions(options) {
  if (!Array.isArray(options?.records)) {
    throw new TypeError("Zapisi za import moraju biti polje.");
  }
  if (!options?.repository?.readSnapshot) {
    throw new TypeError("Repozitorij mora podrzavati readSnapshot.");
  }
  if (!options?.repository?.replaceSnapshot) {
    throw new TypeError("Repozitorij mora podrzavati replaceSnapshot.");
  }
  if (!options?.storage) {
    throw new TypeError("Storage je obavezan za provjeru autoriteta.");
  }

  if (readDataAuthority(options.storage).authority !== "domain") {
    throw new DomainGameImportError(
      "domain-not-authoritative",
      "Domenski repository jos nije autoritativni izvor.",
    );
  }
}

function sourceKind(options) {
  return options.sourceKind === "manual" ? "manual" : "file";
}

async function previewToken(snapshot, records, options) {
  return `sha256:${await sha256Hex(JSON.stringify({
    snapshot,
    records,
    sourceKind: sourceKind(options),
    sourceFileName: options.sourceFileName || null,
  }))}`;
}

export async function createDomainGameImportPreview(options) {
  requireOptions(options);
  const currentSnapshot = await options.repository.readSnapshot();
  const adapted = await adaptLegacyGameRecords(options.records, {
    now: options.now,
    sourceKind: sourceKind(options),
    sourceFileName: options.sourceFileName,
  });
  const simulation = createMemoryDomainRepository(currentSnapshot);
  const report = await importLegacyAdapterResult(simulation, adapted);

  return {
    token: await previewToken(currentSnapshot, options.records, options),
    currentSnapshot,
    nextSnapshot: await simulation.readSnapshot(),
    report,
    warnings: structuredClone(adapted.warnings),
    hasChanges: report.playersAdded > 0 || report.gamesAdded > 0,
  };
}

export async function executeDomainGameImport(options) {
  requireOptions(options);
  if (!options.previewToken) {
    throw new DomainGameImportError(
      "confirmation-required",
      "Import zahtijeva token prethodnog previewa.",
    );
  }

  const preview = await createDomainGameImportPreview(options);
  if (preview.token !== options.previewToken) {
    throw new DomainGameImportError(
      "stale-preview",
      "Domenski podaci promijenili su se nakon previewa importa.",
    );
  }

  if (preview.hasChanges) {
    await options.repository.replaceSnapshot(preview.nextSnapshot);
  }

  return {
    status: preview.hasChanges ? "imported" : "no-changes",
    report: preview.report,
    warnings: preview.warnings,
  };
}

export async function loadDomainImportCollection({ repository }) {
  const snapshot = await repository.readSnapshot();
  return snapshot.games
    .map((game) => ({
      id: game.id,
      title: game.title,
      pgn: game.rawPgn,
      sourceFileName: game.source.fileName,
      importedAt: game.importedAt,
    }))
    .sort((left, right) => right.importedAt.localeCompare(left.importedAt));
}

function hasGameDependents(snapshot, gameId) {
  return (
    snapshot.analysisRuns.some((run) => run.gameIds.includes(gameId)) ||
    snapshot.moveAnalyses.some((analysis) => analysis.gameId === gameId) ||
    snapshot.trainingTasks.some((task) => task.source.gameId === gameId)
  );
}

export async function updateDomainGameRecord(options) {
  requireOptions({ ...options, records: [options.record] });
  const snapshot = await options.repository.readSnapshot();
  const gameIndex = snapshot.games.findIndex(
    (game) => game.id === options.record?.id,
  );

  if (gameIndex === -1) {
    throw new DomainGameImportError(
      "game-not-found",
      "Odabrana domenska partija vise ne postoji.",
    );
  }
  if (hasGameDependents(snapshot, options.record.id)) {
    throw new DomainGameImportError(
      "game-has-dependents",
      "Partija ima povezanu analizu ili trening i ne moze se mijenjati u Importu.",
    );
  }

  const adapted = await adaptLegacyGameRecords([options.record], {
    now: snapshot.games[gameIndex].importedAt,
    sourceKind: snapshot.games[gameIndex].source.kind,
    sourceFileName: snapshot.games[gameIndex].source.fileName,
  });
  const candidate = adapted.games[0];
  if (!candidate) {
    throw new DomainGameImportError(
      "invalid-game",
      adapted.warnings[0]?.message || "Partija nije valjana.",
    );
  }
  if (
    candidate.fingerprint &&
    snapshot.games.some(
      (game) =>
        game.id !== candidate.id && game.fingerprint === candidate.fingerprint,
    )
  ) {
    throw new DomainGameImportError(
      "duplicate-game",
      "Jednaka partija vec postoji u domenskoj biblioteci.",
    );
  }

  const playersById = new Map(snapshot.players.map((player) => [player.id, player]));
  for (const suggestion of adapted.playerSuggestions) {
    if (!playersById.has(suggestion.profile.id)) {
      snapshot.players.push(suggestion.profile);
      playersById.set(suggestion.profile.id, suggestion.profile);
    }
  }
  snapshot.games[gameIndex] = candidate;
  await options.repository.replaceSnapshot(snapshot);
  return candidate;
}
