import test from "node:test";
import assert from "node:assert/strict";
import {
  DATA_AUTHORITY_STORAGE_KEY,
  isLegacyStorageWritable,
  readDataAuthority,
  writeDomainAuthority,
} from "./index.js";

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, value),
  };
}

test("bez markera legacy ostaje autoritativan i zapisiv", () => {
  const target = storage();

  assert.equal(readDataAuthority(target).authority, "legacy");
  assert.equal(isLegacyStorageWritable(target), true);
});

test("domenski marker trajno prebacuje autoritet i zakljucava legacy", () => {
  const target = storage();
  const marker = writeDomainAuthority(target, {
    migratedAt: "2026-08-12T12:00:00.000Z",
    backupKey: "backup-1",
    previewToken: "sha256:preview",
  });

  assert.equal(marker.authority, "domain");
  assert.deepEqual(readDataAuthority(target), marker);
  assert.equal(isLegacyStorageWritable(target), false);
});

test("osteceni marker zatvara legacy zapis umjesto nesigurnog fallbacka", () => {
  const target = storage({ [DATA_AUTHORITY_STORAGE_KEY]: "nije-json" });

  assert.throws(
    () => readDataAuthority(target),
    (error) => error.code === "invalid-authority-marker",
  );
  assert.equal(isLegacyStorageWritable(target), false);
});
