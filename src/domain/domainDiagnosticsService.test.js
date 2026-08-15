import test from "node:test";
import assert from "node:assert/strict";
import {
  createStorageUsageReport,
  DEFAULT_STORAGE_WARNING_THRESHOLD_BYTES,
  DOMAIN_STORAGE_KEY,
  LEGACY_GAMES_STORAGE_KEY,
  loadDomainDiagnostics,
} from "./index.js";

const NOW = "2026-07-25T22:00:00.000Z";

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];

  return {
    writes,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
      writes.push({ key, value });
    },
  };
}

test("dijagnostika cita legacy i domenske podatke bez pisanja", async () => {
  const storage = fakeStorage({
    [DOMAIN_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 1,
      players: [],
      games: [],
      analysisRuns: [],
      moveAnalyses: [],
      positionEvaluations: [],
      trainingTasks: [],
      trainingAttempts: [],
    }),
  });
  const pgn = [
    '[Event "Test"]',
    '[White "Ana"]',
    '[Black "Marko"]',
    '[Result "1-0"]',
    "",
    "1. e4 e5 1-0",
  ].join("\n");
  const diagnostics = await loadDomainDiagnostics({
    legacyRecords: [
      { id: "legacy-1", title: "Prva", pgn },
      { id: "legacy-2", title: "Duplikat", pgn },
      { id: "legacy-bad", title: "Los PGN", pgn: "nije PGN" },
    ],
    storage,
    now: NOW,
  });

  assert.equal(diagnostics.generatedAt, NOW);
  assert.equal(diagnostics.dataAuthority.authority, "legacy");
  assert.equal(diagnostics.legacy.recordsReceived, 3);
  assert.equal(diagnostics.legacy.gamesConverted, 2);
  assert.equal(diagnostics.legacy.gamesRejected, 1);
  assert.equal(diagnostics.legacy.playersProposed, 2);
  assert.equal(diagnostics.legacy.duplicatesFound, 1);
  assert.equal(diagnostics.legacy.warnings, 1);
  assert.deepEqual(diagnostics.domain, {
    players: 0,
    games: 0,
    analysisRuns: 0,
    moveAnalyses: 0,
    positionEvaluations: 0,
    trainingTasks: 0,
    trainingAttempts: 0,
  });
  assert.equal(diagnostics.storageUsage.domainBytes > 0, true);
  assert.equal(diagnostics.storageUsage.legacyBytes, 0);
  assert.equal(
    diagnostics.storageUsage.warningThresholdBytes,
    DEFAULT_STORAGE_WARNING_THRESHOLD_BYTES,
  );
  assert.equal(diagnostics.storageUsage.status, "within-threshold");
  assert.equal(storage.writes.length, 0);
});

test("prazan storage daje prazan snapshot bez njegova stvaranja", async () => {
  const storage = fakeStorage();
  const diagnostics = await loadDomainDiagnostics({
    legacyRecords: [],
    storage,
    now: NOW,
  });

  assert.equal(diagnostics.legacy.recordsReceived, 0);
  assert.equal(diagnostics.domain.games, 0);
  assert.equal(diagnostics.domain.trainingTasks, 0);
  assert.equal(diagnostics.storageUsage.totalBytes, 0);
  assert.equal(storage.writes.length, 0);
});

test("procjena volumena cita oba storage kljuca bez pisanja", () => {
  const storage = fakeStorage({
    [DOMAIN_STORAGE_KEY]: "domena",
    [LEGACY_GAMES_STORAGE_KEY]: "staro",
  });

  const report = createStorageUsageReport(storage, {
    warningThresholdBytes: 24,
  });

  assert.deepEqual(report, {
    domainBytes: 12,
    legacyBytes: 10,
    totalBytes: 22,
    warningThresholdBytes: 24,
    usageRatio: 22 / 24,
    status: "within-threshold",
    measurement: "estimated-utf16-bytes",
  });
  assert.equal(storage.writes.length, 0);
});

test("dijagnostika preporucuje IndexedDB nakon konzervativnog praga", () => {
  const storage = fakeStorage({
    [DOMAIN_STORAGE_KEY]: "123456",
    [LEGACY_GAMES_STORAGE_KEY]: "1234",
  });

  const report = createStorageUsageReport(storage, {
    warningThresholdBytes: 20,
  });

  assert.equal(report.totalBytes, 20);
  assert.equal(report.usageRatio, 1);
  assert.equal(report.status, "indexeddb-recommended");
});

test("procjena volumena odbija neispravan prag", () => {
  const storage = fakeStorage();

  assert.throws(
    () =>
      createStorageUsageReport(storage, {
        warningThresholdBytes: 0,
      }),
    /pozitivan broj bajtova/,
  );
});
