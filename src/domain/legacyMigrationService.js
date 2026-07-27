import { adaptLegacyGameRecords } from "./legacyGameAdapter.js";
import {
  createLocalStorageDomainRepository,
  createMemoryDomainRepository,
  DOMAIN_STORAGE_KEY,
  importLegacyAdapterResult,
} from "./repository.js";
import { sha256Hex } from "./stableHash.js";

export const LEGACY_GAMES_STORAGE_KEY = "chesscare.savedGames";
export const DOMAIN_BACKUP_KEY_PREFIX = "chesscare.domain.backup.v1";

export class LegacyMigrationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "LegacyMigrationError";
    this.code = code;
  }
}

function requireMigrationOptions(options) {
  if (!Array.isArray(options?.legacyRecords)) {
    throw new TypeError("Legacy zapisi moraju biti polje.");
  }

  if (
    !options.storage ||
    typeof options.storage.getItem !== "function" ||
    typeof options.storage.setItem !== "function"
  ) {
    throw new TypeError("Storage mora podrzavati getItem i setItem.");
  }
}

function createSourceState(options) {
  const legacyStorageKey =
    options.legacyStorageKey || LEGACY_GAMES_STORAGE_KEY;
  const domainStorageKey = options.domainStorageKey || DOMAIN_STORAGE_KEY;

  return {
    legacyStorageKey,
    domainStorageKey,
    legacyStorageValue: options.storage.getItem(legacyStorageKey),
    domainStorageValue: options.storage.getItem(domainStorageKey),
    legacyRecords: structuredClone(options.legacyRecords),
  };
}

async function createPreviewToken(sourceState) {
  return `sha256:${await sha256Hex(JSON.stringify(sourceState))}`;
}

function compactTimestamp(value) {
  return value.replace(/[^0-9A-Za-z]/g, "");
}

export async function createLegacyMigrationPreview(options) {
  requireMigrationOptions(options);

  const sourceState = createSourceState(options);
  const repository = createLocalStorageDomainRepository(options.storage, {
    key: sourceState.domainStorageKey,
  });
  const currentSnapshot = await repository.readSnapshot();
  const adapted = await adaptLegacyGameRecords(options.legacyRecords, {
    now: options.now,
  });
  const simulation = createMemoryDomainRepository(currentSnapshot);
  const report = await importLegacyAdapterResult(simulation, adapted);
  const nextSnapshot = await simulation.readSnapshot();

  return {
    token: await createPreviewToken(sourceState),
    createdAt: options.now || new Date().toISOString(),
    sourceState,
    currentSnapshot,
    nextSnapshot,
    report,
    adapterSummary: structuredClone(adapted.summary),
    warnings: structuredClone(adapted.warnings),
    duplicateGroups: structuredClone(adapted.duplicateGroups),
    possiblePlayerMatches: structuredClone(
      adapted.possiblePlayerMatches,
    ),
    hasChanges: report.playersAdded > 0 || report.gamesAdded > 0,
  };
}

export async function executeLegacyMigration(options) {
  requireMigrationOptions(options);

  if (
    typeof options.previewToken !== "string" ||
    options.previewToken.trim() === ""
  ) {
    throw new LegacyMigrationError(
      "confirmation-required",
      "Migracija zahtijeva token prethodno potvrdenog previewa.",
    );
  }

  const preview = await createLegacyMigrationPreview(options);

  if (preview.token !== options.previewToken) {
    throw new LegacyMigrationError(
      "stale-preview",
      "Legacy ili domenski podaci promijenili su se nakon previewa.",
    );
  }

  if (!preview.hasChanges) {
    return {
      status: "no-changes",
      backupKey: null,
      report: preview.report,
    };
  }

  const executedAt = options.now || new Date().toISOString();
  const backupKey = [
    options.backupKeyPrefix || DOMAIN_BACKUP_KEY_PREFIX,
    compactTimestamp(executedAt),
    preview.token.slice("sha256:".length, "sha256:".length + 12),
  ].join(".");
  const backup = {
    backupVersion: 1,
    createdAt: executedAt,
    previewToken: preview.token,
    legacyStorageKey: preview.sourceState.legacyStorageKey,
    domainStorageKey: preview.sourceState.domainStorageKey,
    legacyStorageValue: preview.sourceState.legacyStorageValue,
    domainStorageValue: preview.sourceState.domainStorageValue,
    legacyRecords: preview.sourceState.legacyRecords,
  };

  try {
    options.storage.setItem(backupKey, JSON.stringify(backup));
  } catch (error) {
    throw new LegacyMigrationError(
      "backup-failed",
      "Sigurnosna kopija nije spremljena; migracija nije pokrenuta.",
      { cause: error },
    );
  }

  const repository = createLocalStorageDomainRepository(options.storage, {
    key: preview.sourceState.domainStorageKey,
  });

  try {
    await repository.replaceSnapshot(preview.nextSnapshot);
  } catch (error) {
    throw new LegacyMigrationError(
      "migration-write-failed",
      "Backup je spremljen, ali novi domenski snapshot nije zapisan.",
      { cause: error },
    );
  }

  return {
    status: "migrated",
    backupKey,
    report: preview.report,
  };
}
