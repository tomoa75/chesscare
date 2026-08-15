import {
  adaptLegacyGameRecords,
  createReadOnlyAdapterReport,
} from "./legacyGameAdapter.js";
import {
  createLocalStorageDomainRepository,
  DOMAIN_STORAGE_KEY,
} from "./repository.js";
import { LEGACY_GAMES_STORAGE_KEY } from "./legacyMigrationService.js";
import { readDataAuthority } from "./dataAuthority.js";

export const DEFAULT_STORAGE_WARNING_THRESHOLD_BYTES = 4 * 1024 * 1024;

export function estimateStorageStringBytes(value) {
  return typeof value === "string" ? value.length * 2 : 0;
}

export function createStorageUsageReport(storage, options = {}) {
  if (!storage || typeof storage.getItem !== "function") {
    throw new TypeError("Storage mora podrzavati getItem.");
  }

  const domainStorageKey = options.domainStorageKey || DOMAIN_STORAGE_KEY;
  const legacyStorageKey =
    options.legacyStorageKey || LEGACY_GAMES_STORAGE_KEY;
  const warningThresholdBytes =
    options.warningThresholdBytes ??
    DEFAULT_STORAGE_WARNING_THRESHOLD_BYTES;

  if (
    !Number.isFinite(warningThresholdBytes) ||
    warningThresholdBytes <= 0
  ) {
    throw new TypeError("Prag upozorenja mora biti pozitivan broj bajtova.");
  }

  const domainValue = Object.hasOwn(options, "domainStorageValue")
    ? options.domainStorageValue
    : storage.getItem(domainStorageKey);
  const domainBytes = estimateStorageStringBytes(domainValue);
  const legacyBytes = estimateStorageStringBytes(
    storage.getItem(legacyStorageKey),
  );
  const totalBytes = domainBytes + legacyBytes;
  const usageRatio = totalBytes / warningThresholdBytes;

  return Object.freeze({
    domainBytes,
    legacyBytes,
    totalBytes,
    warningThresholdBytes,
    usageRatio,
    status: usageRatio >= 1 ? "indexeddb-recommended" : "within-threshold",
    measurement: "estimated-utf16-bytes",
  });
}

export async function loadDomainDiagnostics(options) {
  if (!Array.isArray(options?.legacyRecords)) {
    throw new TypeError("Legacy zapisi moraju biti polje.");
  }

  const adapted = await adaptLegacyGameRecords(options.legacyRecords, {
    now: options.now,
  });
  const repository =
    options.repository || createLocalStorageDomainRepository(options.storage);
  const snapshot = await repository.readSnapshot();

  return {
    generatedAt: options.now || new Date().toISOString(),
    storageKey: DOMAIN_STORAGE_KEY,
    storageKind: options.repository ? "IndexedDB" : "localStorage",
    dataAuthority: readDataAuthority(options.storage),
    legacy: createReadOnlyAdapterReport(adapted),
    domain: {
      players: snapshot.players.length,
      games: snapshot.games.length,
      analysisRuns: snapshot.analysisRuns.length,
      moveAnalyses: snapshot.moveAnalyses.length,
      positionEvaluations: snapshot.positionEvaluations.length,
      trainingTasks: snapshot.trainingTasks.length,
      trainingAttempts: snapshot.trainingAttempts.length,
    },
    storageUsage: createStorageUsageReport(options.storage, {
      warningThresholdBytes: options.storageWarningThresholdBytes,
      domainStorageValue: options.repository
        ? JSON.stringify(snapshot)
        : options.storage.getItem(DOMAIN_STORAGE_KEY),
    }),
    duplicateGroups: adapted.duplicateGroups,
    possiblePlayerMatches: adapted.possiblePlayerMatches,
  };
}
