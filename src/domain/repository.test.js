import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptLegacyGameRecords,
  createAnalysisRun,
  createGame,
  createLocalStorageDomainRepository,
  createMemoryDomainRepository,
  createMoveAnalysis,
  createPlayer,
  DOMAIN_STORAGE_KEY,
  importLegacyAdapterResult,
} from "./index.js";

const NOW = "2026-07-25T14:00:00.000Z";

function createFakeStorage(initial = {}) {
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

function player(id = "player-1") {
  return createPlayer(
    {
      id,
      displayName: "Test Igrac",
      aliases: ["Igrac, Test"],
    },
    { now: NOW },
  );
}

function game(id = "game-1", fingerprint = "sha256:test") {
  return createGame(
    {
      id,
      title: "Test partija",
      rawPgn: "1. e4 e5",
      headers: {},
      players: { whitePlayerId: "player-1" },
      result: "*",
      source: { kind: "migration" },
      fingerprint,
    },
    { now: NOW },
  );
}

function analysisRun() {
  return createAnalysisRun(
    {
      id: "analysis-1",
      gameIds: ["game-1"],
      engine: { name: "Stockfish", version: "18" },
      settings: { depth: 8, multiPv: 1 },
      status: "running",
      progress: { completed: 0, total: 1 },
    },
    { now: NOW },
  );
}

function moveAnalysis() {
  return createMoveAnalysis({
    id: "move-analysis-1",
    analysisRunId: "analysis-1",
    gameId: "game-1",
    playerId: "player-1",
    ply: 1,
    color: "white",
    phase: "opening",
    beforeFen: "before",
    afterFen: "after",
    playedMove: { san: "e4", uci: "e2e4" },
    bestMove: { san: "d4", uci: "d2d4" },
    beforeEvaluation: { type: "cp", value: 20 },
    afterEvaluation: { type: "cp", value: 10 },
    centipawnLoss: 10,
    classification: "good",
  });
}

test("memorijski repozitorij podrzava CRUD za sve domenske kolekcije", async () => {
  const repository = createMemoryDomainRepository();

  await repository.savePlayer(player());
  await repository.saveGame(game());
  await repository.saveAnalysisRun(analysisRun());
  await repository.saveMoveAnalysis(moveAnalysis());

  assert.equal((await repository.listPlayers()).length, 1);
  assert.equal((await repository.getGame("game-1")).title, "Test partija");
  assert.equal(
    (await repository.getAnalysisRun("analysis-1")).engine.version,
    "18",
  );
  assert.equal(
    (await repository.getMoveAnalysis("move-analysis-1")).playedMove.san,
    "e4",
  );

  const updatedPlayer = {
    ...(await repository.getPlayer("player-1")),
    displayName: "Novo ime",
    aliases: ["Novo ime"],
    updatedAt: "2026-07-25T15:00:00.000Z",
  };
  await repository.savePlayer(updatedPlayer);

  assert.equal((await repository.getPlayer("player-1")).displayName, "Novo ime");
  assert.equal(await repository.removeMoveAnalysis("move-analysis-1"), true);
  assert.equal(await repository.removeAnalysisRun("analysis-1"), true);
  assert.equal(await repository.removeGame("game-1"), true);
  assert.equal(await repository.removePlayer("player-1"), true);
  assert.equal(await repository.removePlayer("player-1"), false);
});

test("repozitorij vraca kopije i ne dopusta mutaciju interne memorije", async () => {
  const repository = createMemoryDomainRepository();
  await repository.savePlayer(player());

  const firstRead = await repository.getPlayer("player-1");
  firstRead.displayName = "Mutirano izvana";
  firstRead.aliases.push("Novi alias");

  const secondRead = await repository.getPlayer("player-1");
  assert.equal(secondRead.displayName, "Test Igrac");
  assert.deepEqual(secondRead.aliases, ["Test Igrac", "Igrac, Test"]);
});

test("localStorage repozitorij koristi samo zasebni verzionirani kljuc", async () => {
  const legacyValue = JSON.stringify([{ id: "old", pgn: "1. e4" }]);
  const storage = createFakeStorage({
    "chesscare.savedGames": legacyValue,
  });
  const repository = createLocalStorageDomainRepository(storage);

  await repository.savePlayer(player());

  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0].key, DOMAIN_STORAGE_KEY);
  assert.equal(storage.getItem("chesscare.savedGames"), legacyValue);

  const savedSnapshot = JSON.parse(storage.getItem(DOMAIN_STORAGE_KEY));
  assert.equal(savedSnapshot.schemaVersion, 1);
  assert.equal(savedSnapshot.players[0].id, "player-1");
});

test("snapshot bez nove cache kolekcije ostaje citljiv", async () => {
  const oldVersionOneSnapshot = {
    schemaVersion: 1,
    players: [],
    games: [],
    analysisRuns: [],
    moveAnalyses: [],
  };
  const repository = createMemoryDomainRepository(oldVersionOneSnapshot);

  assert.deepEqual(await repository.listPositionEvaluations(), []);
  assert.deepEqual(await repository.listTrainingTasks(), []);
  assert.deepEqual(await repository.listTrainingAttempts(), []);
  assert.deepEqual(
    (await repository.readSnapshot()).positionEvaluations,
    [],
  );
});

test("osteceni JSON se prijavljuje i nikad se automatski ne prepisuje", async () => {
  const storage = createFakeStorage({
    [DOMAIN_STORAGE_KEY]: "{nije json",
  });
  const repository = createLocalStorageDomainRepository(storage);

  await assert.rejects(
    repository.readSnapshot(),
    (error) => error.code === "invalid-json",
  );
  await assert.rejects(
    repository.savePlayer(player()),
    (error) => error.code === "invalid-json",
  );
  assert.equal(storage.writes.length, 0);
  assert.equal(storage.getItem(DOMAIN_STORAGE_KEY), "{nije json");
});

test("neispravan domenski zapis u valjanom JSON-u ostaje netaknut", async () => {
  const invalidSnapshot = JSON.stringify({
    schemaVersion: 1,
    players: [{ id: "player-without-name" }],
    games: [],
    analysisRuns: [],
    moveAnalyses: [],
  });
  const storage = createFakeStorage({
    [DOMAIN_STORAGE_KEY]: invalidSnapshot,
  });
  const repository = createLocalStorageDomainRepository(storage);

  await assert.rejects(
    repository.readSnapshot(),
    (error) => error.code === "invalid-entity",
  );
  await assert.rejects(
    repository.savePlayer(player()),
    (error) => error.code === "invalid-entity",
  );
  assert.equal(storage.writes.length, 0);
  assert.equal(storage.getItem(DOMAIN_STORAGE_KEY), invalidSnapshot);
});

test("legacy rezultat se sprema idempotentno bez dupliranja", async () => {
  const pgn = [
    '[Event "Test"]',
    '[White "Ana Saric"]',
    '[Black "Marko Horvat"]',
    '[Result "1-0"]',
    "",
    "1. e4 e5 1-0",
  ].join("\n");
  const adapted = await adaptLegacyGameRecords(
    [{ id: "legacy-1", title: "Test", pgn }],
    { now: NOW },
  );
  const repository = createMemoryDomainRepository();

  const firstImport = await importLegacyAdapterResult(repository, adapted);
  const secondImport = await importLegacyAdapterResult(repository, adapted);

  assert.deepEqual(firstImport, {
    playersAdded: 2,
    playersSkipped: 0,
    gamesAdded: 1,
    gamesSkipped: 0,
    conflicts: [],
  });
  assert.deepEqual(secondImport, {
    playersAdded: 0,
    playersSkipped: 2,
    gamesAdded: 0,
    gamesSkipped: 1,
    conflicts: [],
  });
  assert.equal((await repository.listPlayers()).length, 2);
  assert.equal((await repository.listGames()).length, 1);
});

test("kolizija ID-a partije ne prepisuje postojecu partiju", async () => {
  const repository = createMemoryDomainRepository();
  await repository.saveGame(game("shared-id", "sha256:first"));

  const report = await importLegacyAdapterResult(repository, {
    playerSuggestions: [],
    games: [game("shared-id", "sha256:second")],
  });

  assert.equal(report.gamesAdded, 0);
  assert.equal(report.gamesSkipped, 1);
  assert.deepEqual(report.conflicts, [
    {
      code: "game-id-conflict",
      gameId: "shared-id",
      fingerprint: "sha256:second",
    },
  ]);
  assert.equal(
    (await repository.getGame("shared-id")).fingerprint,
    "sha256:first",
  );
});
