import test from "node:test";
import assert from "node:assert/strict";
import {
  createLegacyMigrationPreview,
  DATA_AUTHORITY_STORAGE_KEY,
  DOMAIN_BACKUP_KEY_PREFIX,
  DOMAIN_STORAGE_KEY,
  executeLegacyMigration,
  LEGACY_GAMES_STORAGE_KEY,
} from "./index.js";

const NOW = "2026-07-25T23:00:00.000Z";
const PGN = [
  '[Event "Migracija"]',
  '[White "Ana Saric"]',
  '[Black "Marko Horvat"]',
  '[Result "1-0"]',
  "",
  "1. e4 e5 1-0",
].join("\n");

function fakeStorage(initial = {}, failForKey = null) {
  const values = new Map(Object.entries(initial));
  const writes = [];

  return {
    writes,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (
        typeof failForKey === "function"
          ? failForKey(key)
          : key === failForKey
      ) {
        throw new Error(`Namjerni kvar za ${key}`);
      }

      values.set(key, value);
      writes.push({ key, value });
    },
  };
}

function records() {
  return [{ id: "legacy-1", title: "Migracija", pgn: PGN }];
}

test("preview simulira migraciju bez ijednog zapisa u storage", async () => {
  const legacyRecords = records();
  const legacyRaw = JSON.stringify(legacyRecords);
  const storage = fakeStorage({
    [LEGACY_GAMES_STORAGE_KEY]: legacyRaw,
  });

  const preview = await createLegacyMigrationPreview({
    legacyRecords,
    storage,
    now: NOW,
  });

  assert.equal(preview.hasChanges, true);
  assert.equal(preview.report.playersAdded, 2);
  assert.equal(preview.report.gamesAdded, 1);
  assert.equal(preview.currentSnapshot.games.length, 0);
  assert.equal(preview.nextSnapshot.games.length, 1);
  assert.match(preview.token, /^sha256:[0-9a-f]{64}$/);
  assert.equal(storage.writes.length, 0);
  assert.equal(storage.getItem(LEGACY_GAMES_STORAGE_KEY), legacyRaw);
});

test("potvrdena migracija prvo sprema backup pa domenski snapshot", async () => {
  const legacyRecords = records();
  const legacyRaw = JSON.stringify(legacyRecords);
  const storage = fakeStorage({
    [LEGACY_GAMES_STORAGE_KEY]: legacyRaw,
  });
  const preview = await createLegacyMigrationPreview({
    legacyRecords,
    storage,
    now: NOW,
  });
  const result = await executeLegacyMigration({
    legacyRecords,
    storage,
    now: NOW,
    previewToken: preview.token,
  });

  assert.equal(result.status, "migrated");
  assert.match(
    result.backupKey,
    new RegExp(`^${DOMAIN_BACKUP_KEY_PREFIX.replaceAll(".", "\\.")}`),
  );
  assert.equal(storage.writes.length, 3);
  assert.equal(storage.writes[0].key, result.backupKey);
  assert.equal(storage.writes[1].key, DOMAIN_STORAGE_KEY);
  assert.equal(storage.writes[2].key, DATA_AUTHORITY_STORAGE_KEY);
  assert.equal(storage.getItem(LEGACY_GAMES_STORAGE_KEY), legacyRaw);

  const backup = JSON.parse(storage.getItem(result.backupKey));
  assert.equal(backup.domainStorageValue, null);
  assert.equal(backup.legacyStorageValue, legacyRaw);
  assert.equal(backup.authorityStorageValue, null);

  const authority = JSON.parse(
    storage.getItem(DATA_AUTHORITY_STORAGE_KEY),
  );
  assert.equal(authority.authority, "domain");
  assert.equal(authority.backupKey, result.backupKey);

  const snapshot = JSON.parse(storage.getItem(DOMAIN_STORAGE_KEY));
  assert.equal(snapshot.players.length, 2);
  assert.equal(snapshot.games.length, 1);
});

test("migracija odbija zastarjeli preview bez backupa i promjene domene", async () => {
  const legacyRecords = records();
  const storage = fakeStorage({
    [LEGACY_GAMES_STORAGE_KEY]: JSON.stringify(legacyRecords),
  });
  const preview = await createLegacyMigrationPreview({
    legacyRecords,
    storage,
    now: NOW,
  });
  const changedRecords = [
    ...legacyRecords,
    { id: "legacy-2", title: "Nova", pgn: PGN },
  ];

  await assert.rejects(
    executeLegacyMigration({
      legacyRecords: changedRecords,
      storage,
      now: NOW,
      previewToken: preview.token,
    }),
    (error) => error.code === "stale-preview",
  );
  assert.equal(storage.writes.length, 0);
  assert.equal(storage.getItem(DOMAIN_STORAGE_KEY), null);
});

test("kvar backupa zaustavlja migraciju prije domenskog zapisa", async () => {
  const legacyRecords = records();
  const storage = fakeStorage(
    { [LEGACY_GAMES_STORAGE_KEY]: JSON.stringify(legacyRecords) },
    (key) => key.startsWith(DOMAIN_BACKUP_KEY_PREFIX),
  );
  const preview = await createLegacyMigrationPreview({
    legacyRecords,
    storage,
    now: NOW,
  });

  await assert.rejects(
    executeLegacyMigration({
      legacyRecords,
      storage,
      now: NOW,
      previewToken: preview.token,
    }),
    (error) => error.code === "backup-failed",
  );
  assert.equal(storage.writes.length, 0);
  assert.equal(storage.getItem(DOMAIN_STORAGE_KEY), null);
});

test("ponovljena migracija je no-op i ne stvara novi backup", async () => {
  const legacyRecords = records();
  const storage = fakeStorage({
    [LEGACY_GAMES_STORAGE_KEY]: JSON.stringify(legacyRecords),
  });
  const firstPreview = await createLegacyMigrationPreview({
    legacyRecords,
    storage,
    now: NOW,
  });
  await executeLegacyMigration({
    legacyRecords,
    storage,
    now: NOW,
    previewToken: firstPreview.token,
  });
  const writesAfterFirstMigration = storage.writes.length;
  const secondPreview = await createLegacyMigrationPreview({
    legacyRecords,
    storage,
    now: NOW,
  });
  const secondResult = await executeLegacyMigration({
    legacyRecords,
    storage,
    now: NOW,
    previewToken: secondPreview.token,
  });

  assert.equal(secondPreview.hasChanges, false);
  assert.equal(secondResult.status, "no-changes");
  assert.equal(secondResult.backupKey, null);
  assert.equal(storage.writes.length, writesAfterFirstMigration);
});

test("naknadna promjena legacy zapisa ne ulazi u domenu nakon cutovera", async () => {
  const legacyRecords = records();
  const storage = fakeStorage({
    [LEGACY_GAMES_STORAGE_KEY]: JSON.stringify(legacyRecords),
  });
  const firstPreview = await createLegacyMigrationPreview({
    legacyRecords,
    storage,
    now: NOW,
  });
  await executeLegacyMigration({
    legacyRecords,
    storage,
    now: NOW,
    previewToken: firstPreview.token,
  });
  const changedRecords = [
    ...legacyRecords,
    {
      id: "legacy-after-cutover",
      title: "Kasna",
      pgn: PGN.replace("Migracija", "Kasna").replace(
        "1. e4 e5 1-0",
        "1. d4 d5 1-0",
      ),
    },
  ];
  storage.setItem(
    LEGACY_GAMES_STORAGE_KEY,
    JSON.stringify(changedRecords),
  );
  const preview = await createLegacyMigrationPreview({
    legacyRecords: changedRecords,
    storage,
    now: NOW,
  });
  const writesBeforeConfirmation = storage.writes.length;
  const result = await executeLegacyMigration({
    legacyRecords: changedRecords,
    storage,
    now: NOW,
    previewToken: preview.token,
  });

  assert.equal(preview.dataChanges, true);
  assert.equal(preview.hasChanges, false);
  assert.equal(result.status, "no-changes");
  assert.equal(storage.writes.length, writesBeforeConfirmation);
  assert.equal(JSON.parse(storage.getItem(DOMAIN_STORAGE_KEY)).games.length, 1);
});

test("kvar domenskog zapisa ostavlja spremljeni backup", async () => {
  const legacyRecords = records();
  const storage = fakeStorage(
    { [LEGACY_GAMES_STORAGE_KEY]: JSON.stringify(legacyRecords) },
    DOMAIN_STORAGE_KEY,
  );
  const preview = await createLegacyMigrationPreview({
    legacyRecords,
    storage,
    now: NOW,
  });

  await assert.rejects(
    executeLegacyMigration({
      legacyRecords,
      storage,
      now: NOW,
      previewToken: preview.token,
    }),
    (error) => error.code === "migration-write-failed",
  );
  assert.equal(storage.writes.length, 1);
  assert.match(storage.writes[0].key, /^chesscare\.domain\.backup\.v1\./);
  assert.equal(storage.getItem(DOMAIN_STORAGE_KEY), null);
});

test("kvar markera autoriteta vraca prethodni domenski snapshot", async () => {
  const legacyRecords = records();
  const legacyRaw = JSON.stringify(legacyRecords);
  const storage = fakeStorage(
    { [LEGACY_GAMES_STORAGE_KEY]: legacyRaw },
    DATA_AUTHORITY_STORAGE_KEY,
  );
  const preview = await createLegacyMigrationPreview({
    legacyRecords,
    storage,
    now: NOW,
  });

  await assert.rejects(
    executeLegacyMigration({
      legacyRecords,
      storage,
      now: NOW,
      previewToken: preview.token,
    }),
    (error) => error.code === "authority-write-failed",
  );

  const restoredSnapshot = JSON.parse(storage.getItem(DOMAIN_STORAGE_KEY));
  assert.equal(restoredSnapshot.games.length, 0);
  assert.equal(restoredSnapshot.players.length, 0);
  assert.equal(storage.getItem(DATA_AUTHORITY_STORAGE_KEY), null);
  assert.equal(storage.getItem(LEGACY_GAMES_STORAGE_KEY), legacyRaw);
});
