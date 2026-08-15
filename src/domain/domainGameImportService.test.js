import test from "node:test";
import assert from "node:assert/strict";
import {
  createDomainGameImportPreview,
  createMemoryDomainRepository,
  executeDomainGameImport,
  loadDomainImportCollection,
  updateDomainGameRecord,
  writeDomainAuthority,
} from "./index.js";

const NOW = "2026-08-13T09:00:00.000Z";
const PGN = [
  '[Event "Novi import"]',
  '[White "Ana"]',
  '[Black "Marko"]',
  '[Result "1-0"]',
  "",
  "1. e4 e5 2. Nf3 Nc6 1-0",
].join("\n");

function storage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, value),
  };
}

function fixture() {
  const targetStorage = storage();
  writeDomainAuthority(targetStorage, {
    migratedAt: NOW,
    backupKey: "backup-1",
    previewToken: "sha256:migration",
  });
  return {
    storage: targetStorage,
    repository: createMemoryDomainRepository(),
  };
}

function request(context, overrides = {}) {
  return {
    ...context,
    records: [{ id: "game-1", title: "Novi import", pgn: PGN }],
    sourceKind: "file",
    sourceFileName: "turnir.pgn",
    now: NOW,
    ...overrides,
  };
}

test("preview je read-only, a potvrda sprema domensku partiju i profile", async () => {
  const context = fixture();
  const preview = await createDomainGameImportPreview(request(context));

  assert.equal(preview.hasChanges, true);
  assert.equal(preview.report.gamesAdded, 1);
  assert.equal((await context.repository.listGames()).length, 0);

  const result = await executeDomainGameImport(
    request(context, { previewToken: preview.token }),
  );
  const [game] = await context.repository.listGames();

  assert.equal(result.status, "imported");
  assert.equal(game.source.kind, "file");
  assert.equal(game.source.fileName, "turnir.pgn");
  assert.equal((await context.repository.listPlayers()).length, 2);
});

test("ponovljeni import koristi fingerprint i ne stvara duplikat", async () => {
  const context = fixture();
  const first = await createDomainGameImportPreview(request(context));
  await executeDomainGameImport(
    request(context, { previewToken: first.token }),
  );
  const duplicateRequest = request(context, {
    records: [{ id: "game-2", title: "Duplikat", pgn: PGN }],
  });
  const duplicate = await createDomainGameImportPreview(duplicateRequest);
  const result = await executeDomainGameImport({
    ...duplicateRequest,
    previewToken: duplicate.token,
  });

  assert.equal(duplicate.hasChanges, false);
  assert.equal(duplicate.report.gamesSkipped, 1);
  assert.equal(result.status, "no-changes");
  assert.equal((await context.repository.listGames()).length, 1);
});

test("promjena repositoryja nakon previewa blokira potvrdu", async () => {
  const context = fixture();
  const importRequest = request(context);
  const preview = await createDomainGameImportPreview(importRequest);
  await context.repository.savePlayer({
    id: "player-extra",
    displayName: "Iva",
    aliases: [],
    metadata: {},
  });

  await assert.rejects(
    executeDomainGameImport({
      ...importRequest,
      previewToken: preview.token,
    }),
    (error) => error.code === "stale-preview",
  );
  assert.equal((await context.repository.listGames()).length, 0);
});

test("kolekcija se ucitava iz domene, a sigurno uredivanje cuva ID", async () => {
  const context = fixture();
  const preview = await createDomainGameImportPreview(request(context));
  await executeDomainGameImport(
    request(context, { previewToken: preview.token }),
  );
  const updatedPgn = PGN.replace("Novi import", "Promijenjen turnir");

  await updateDomainGameRecord({
    ...context,
    record: { id: "game-1", title: "Promijenjen", pgn: updatedPgn },
  });
  const collection = await loadDomainImportCollection(context);

  assert.equal(collection.length, 1);
  assert.equal(collection[0].id, "game-1");
  assert.match(collection[0].pgn, /Promijenjen turnir/);
});

test("uredivanje partije s analitickim poslom je blokirano", async () => {
  const context = fixture();
  const preview = await createDomainGameImportPreview(request(context));
  await executeDomainGameImport(
    request(context, { previewToken: preview.token }),
  );
  await context.repository.saveAnalysisRun({
    id: "run-1",
    gameIds: ["game-1"],
    engine: { name: "Stockfish", version: "18" },
    settings: { depth: 8, multiPv: 1, uciOptions: {} },
    status: "queued",
    progress: { completed: 0, total: 1 },
    createdAt: NOW,
  });

  await assert.rejects(
    updateDomainGameRecord({
      ...context,
      record: { id: "game-1", title: "Nova", pgn: PGN },
    }),
    (error) => error.code === "game-has-dependents",
  );
});
