import { adaptLegacyGameRecords } from "./legacyGameAdapter.js";
import {
  createLocalStorageDomainRepository,
  createMemoryDomainRepository,
  DOMAIN_STORAGE_KEY,
  importLegacyAdapterResult,
} from "./repository.js";
import { createLocalStorageMigrationBackupStore } from "./indexedDbStorage.js";
import { sha256Hex } from "./stableHash.js";
import {
  DATA_AUTHORITY_STORAGE_KEY,
  readDataAuthority,
  writeDomainAuthority,
} from "./dataAuthority.js";

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

async function createSourceState(options, repository) {
  const legacyStorageKey =
    options.legacyStorageKey || LEGACY_GAMES_STORAGE_KEY;
  const domainStorageKey = options.domainStorageKey || DOMAIN_STORAGE_KEY;

  const domainStorageValue = options.storage.getItem(domainStorageKey);
  const domainSnapshot = await repository.readSnapshot();

  return {
    legacyStorageKey,
    domainStorageKey,
    legacyStorageValue: options.storage.getItem(legacyStorageKey),
    authorityStorageValue: options.storage.getItem(
      DATA_AUTHORITY_STORAGE_KEY,
    ),
    dataAuthority: readDataAuthority(options.storage),
    domainStorageValue,
    domainSnapshot,
    legacyRecords: structuredClone(options.legacyRecords),
  };
}

async function createPreviewToken(sourceState) {
  const comparableState = {
    legacyStorageKey: sourceState.legacyStorageKey,
    domainStorageKey: sourceState.domainStorageKey,
    legacyStorageValue: sourceState.legacyStorageValue,
    authorityStorageValue: sourceState.authorityStorageValue,
    legacyRecords: sourceState.legacyRecords,
    domainSnapshot: sourceState.domainSnapshot,
  };
  return `sha256:${await sha256Hex(JSON.stringify(comparableState))}`;
}

function resolveRepository(options) {
  if (options.repository) return options.repository;
  return createLocalStorageDomainRepository(options.storage, {
    key: options.domainStorageKey || DOMAIN_STORAGE_KEY,
  });
}

function resolveBackupStore(options) {
  return (
    options.backupStore || createLocalStorageMigrationBackupStore(options.storage)
  );
}

function compactTimestamp(value) {
  return value.replace(/[^0-9A-Za-z]/g, "");
}

export async function createLegacyMigrationPreview(options) {
  requireMigrationOptions(options);

  const repository = resolveRepository(options);
  const sourceState = await createSourceState(options, repository);
  const currentSnapshot = sourceState.domainSnapshot;
  const adapted = await adaptLegacyGameRecords(options.legacyRecords, {
    now: options.now,
  });
  const simulation = createMemoryDomainRepository(currentSnapshot);
  const report = await importLegacyAdapterResult(simulation, adapted);
  const nextSnapshot = await simulation.readSnapshot();
  const dataChanges = report.playersAdded > 0 || report.gamesAdded > 0;
  const requiresAuthorityActivation =
    sourceState.dataAuthority.authority !== "domain";

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
    dataChanges,
    hasChanges: requiresAuthorityActivation,
    requiresAuthorityActivation,
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

  if (!preview.hasChanges && !preview.requiresAuthorityActivation) {
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
    authorityStorageKey: DATA_AUTHORITY_STORAGE_KEY,
    authorityStorageValue: preview.sourceState.authorityStorageValue,
    domainStorageValue: preview.sourceState.domainStorageValue,
    domainSnapshot: preview.sourceState.domainSnapshot,
    legacyRecords: preview.sourceState.legacyRecords,
  };

  try {
    await resolveBackupStore(options).save(backupKey, backup);
  } catch (error) {
    throw new LegacyMigrationError(
      "backup-failed",
      "Sigurnosna kopija nije spremljena; migracija nije pokrenuta.",
      { cause: error },
    );
  }

  const repository = resolveRepository(options);

  try {
    await repository.replaceSnapshot(preview.nextSnapshot);
  } catch (error) {
    throw new LegacyMigrationError(
      "migration-write-failed",
      "Backup je spremljen, ali novi domenski snapshot nije zapisan.",
      { cause: error },
    );
  }

  let authority;
  try {
    authority = writeDomainAuthority(options.storage, {
      migratedAt: executedAt,
      backupKey,
      previewToken: preview.token,
    });
  } catch (error) {
    try {
      await repository.replaceSnapshot(preview.currentSnapshot);
    } catch (rollbackError) {
      throw new LegacyMigrationError(
        "authority-write-and-rollback-failed",
        "Domenski zapis je spremljen, ali aktivacija autoriteta i povrat prethodnog snapshota nisu uspjeli.",
        { cause: new AggregateError([error, rollbackError]) },
      );
    }

    throw new LegacyMigrationError(
      "authority-write-failed",
      "Aktivacija domenskog izvora nije uspjela; domenski snapshot vracen je na prethodno stanje.",
      { cause: error },
    );
  }

  return {
    status: "migrated",
    backupKey,
    authority,
    report: preview.report,
  };
}
