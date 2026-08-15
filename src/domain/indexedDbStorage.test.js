import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import {
  createEmptyDomainSnapshot,
  createIndexedDbDomainRepository,
  createIndexedDbMigrationBackupStore,
  createLegacyMigrationPreview,
  DATA_AUTHORITY_STORAGE_KEY,
  DOMAIN_BACKUP_KEY_PREFIX,
  DOMAIN_STORAGE_KEY,
  executeLegacyMigration,
  LEGACY_GAMES_STORAGE_KEY,
} from "./index.js";

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));

  return {
    get length() {
      return values.size;
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
  };
}

test("IndexedDB repozitorij jednokratno preuzima stari localStorage snapshot", async () => {
  const indexedDB = new IDBFactory();
  const snapshot = createEmptyDomainSnapshot();
  const storage = fakeStorage({
    [DOMAIN_STORAGE_KEY]: JSON.stringify(snapshot),
  });
  const repository = createIndexedDbDomainRepository(indexedDB, {
    databaseName: "repository-promotion-test",
    fallbackStorage: storage,
  });

  assert.deepEqual(await repository.readSnapshot(), snapshot);
  assert.equal(storage.getItem(DOMAIN_STORAGE_KEY), null);
  const changed = createEmptyDomainSnapshot();
  changed.players.push({
    id: "player-1",
    displayName: "Ana",
    normalizedName: "ana",
    aliases: [],
    metadata: {},
    createdAt: "2026-08-08T10:00:00.000Z",
    updatedAt: "2026-08-08T10:00:00.000Z",
  });
  const saved = await repository.replaceSnapshot(changed);

  assert.deepEqual(await repository.readSnapshot(), saved);
  assert.equal(storage.getItem(DOMAIN_STORAGE_KEY), null);
});

test("migracija sprema backup i domenski snapshot u IndexedDB", async () => {
  const indexedDB = new IDBFactory();
  const databaseName = "migration-indexeddb-test";
  const legacyRecords = [
    {
      id: "legacy-indexeddb-1",
      title: "IndexedDB migracija",
      pgn: [
        '[Event "IndexedDB"]',
        '[White "Ana"]',
        '[Black "Marko"]',
        '[Result "1-0"]',
        "",
        "1. e4 e5 1-0",
      ].join("\n"),
    },
  ];
  const legacyValue = JSON.stringify(legacyRecords);
  const storage = fakeStorage({
    [LEGACY_GAMES_STORAGE_KEY]: legacyValue,
  });
  const repository = createIndexedDbDomainRepository(indexedDB, {
    databaseName,
    fallbackStorage: storage,
  });
  const backupStore = createIndexedDbMigrationBackupStore(indexedDB, {
    databaseName,
  });
  const options = {
    legacyRecords,
    storage,
    repository,
    backupStore,
    now: "2026-08-08T10:00:00.000Z",
  };
  const preview = await createLegacyMigrationPreview(options);
  const result = await executeLegacyMigration({
    ...options,
    previewToken: preview.token,
  });

  assert.equal(result.status, "migrated");
  assert.match(result.backupKey, new RegExp(`^${DOMAIN_BACKUP_KEY_PREFIX}`));
  assert.equal(storage.getItem(DOMAIN_STORAGE_KEY), null);
  assert.equal(
    JSON.parse(storage.getItem(DATA_AUTHORITY_STORAGE_KEY)).authority,
    "domain",
  );
  assert.equal(
    [...Array.from({ length: storage.length }, (_, index) => storage.key(index))]
      .some((key) => key?.startsWith(DOMAIN_BACKUP_KEY_PREFIX)),
    false,
  );

  const backup = await backupStore.get(result.backupKey);
  assert.equal(backup.legacyStorageValue, legacyValue);
  assert.equal(backup.domainSnapshot.games.length, 0);
  const migrated = await repository.readSnapshot();
  assert.equal(migrated.players.length, 2);
  assert.equal(migrated.games.length, 1);
});
