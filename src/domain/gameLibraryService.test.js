import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  createLocalStorageDomainRepository,
  createMemoryDomainRepository,
  createPlayer,
  loadDomainGameLibrary,
} from "./index.js";

const NOW = "2026-07-25T20:00:00.000Z";

function player(id, displayName) {
  return createPlayer(
    { id, displayName, aliases: [`${displayName} alias`] },
    { now: NOW },
  );
}

function game(input) {
  return createGame(
    {
      id: input.id,
      title: input.title,
      rawPgn: input.rawPgn || "1. e4 e5",
      headers: input.headers,
      players: input.players,
      result: input.result,
      source: { kind: "migration" },
      fingerprint: `sha256:${input.id}`,
      importedAt: input.importedAt,
    },
    { now: NOW },
  );
}

function snapshot() {
  return {
    schemaVersion: 1,
    players: [
      player("ana", "Ana Saric"),
      player("marko", "Marko Horvat"),
    ],
    games: [
      game({
        id: "game-1",
        title: "Zagrebacki turnir",
        headers: {
          Event: "Zagreb Open",
          White: "A. Saric",
          Black: "M. Horvat",
          Date: "2026.07.20",
          Opening: "Sicilijanska obrana",
        },
        players: {
          whitePlayerId: "ana",
          blackPlayerId: "marko",
        },
        result: "1-0",
        importedAt: "2026-07-25T20:00:00.000Z",
      }),
      game({
        id: "game-2",
        title: "Klupska partija",
        headers: {
          Event: "Klub",
          White: "Nepoznati Igrac",
          Black: "Ana Saric",
        },
        players: {
          whitePlayerId: "missing-player",
          blackPlayerId: "ana",
        },
        result: "1/2-1/2",
        importedAt: "2026-07-24T20:00:00.000Z",
      }),
    ],
    analysisRuns: [],
    moveAnalyses: [],
    positionEvaluations: [],
    trainingTasks: [],
    trainingAttempts: [],
  };
}

test("biblioteka povezuje partije s profilima igraca", async () => {
  const repository = createMemoryDomainRepository(snapshot());
  const library = await loadDomainGameLibrary({ repository });

  assert.equal(library.summary.totalGames, 2);
  assert.equal(library.summary.totalPlayers, 2);
  assert.equal(library.summary.unresolvedPlayerReferences, 1);
  assert.equal(library.games[0].white.name, "Ana Saric");
  assert.equal(library.games[0].white.resolved, true);
  assert.equal(library.games[1].white.name, "Nepoznati Igrac");
  assert.equal(library.games[1].white.resolved, false);
});

test("pretraga obuhvaca naslov, igrace, dogadaj i otvaranje", async () => {
  const repository = createMemoryDomainRepository(snapshot());

  for (const query of [
    "zagrebacki",
    "ana saric",
    "zagreb open",
    "sicilijanska",
  ]) {
    const library = await loadDomainGameLibrary({
      repository,
      filters: { query },
    });
    assert.equal(library.games.some((item) => item.id === "game-1"), true);
  }
});

test("filteri igraca i rezultata rade zajedno", async () => {
  const repository = createMemoryDomainRepository(snapshot());
  const library = await loadDomainGameLibrary({
    repository,
    filters: { playerId: "ana", result: "1/2-1/2" },
  });

  assert.deepEqual(
    library.games.map((item) => item.id),
    ["game-2"],
  );
  assert.equal(library.summary.visibleGames, 1);
});

test("sortiranje podrzava najnovije, najstarije i naslov", async () => {
  const repository = createMemoryDomainRepository(snapshot());

  const newest = await loadDomainGameLibrary({ repository });
  const oldest = await loadDomainGameLibrary({
    repository,
    filters: { sort: "oldest" },
  });
  const byTitle = await loadDomainGameLibrary({
    repository,
    filters: { sort: "title" },
  });

  assert.deepEqual(
    newest.games.map((item) => item.id),
    ["game-1", "game-2"],
  );
  assert.deepEqual(
    oldest.games.map((item) => item.id),
    ["game-2", "game-1"],
  );
  assert.deepEqual(
    byTitle.games.map((item) => item.id),
    ["game-2", "game-1"],
  );
});

test("osteceni domenski storage daje repository gresku bez prepisivanja", async () => {
  const writes = [];
  const storage = {
    getItem: () => "{osteceno",
    setItem: (key, value) => writes.push({ key, value }),
  };
  const repository = createLocalStorageDomainRepository(storage);

  await assert.rejects(
    loadDomainGameLibrary({ repository }),
    (error) => error.code === "invalid-json",
  );
  assert.equal(writes.length, 0);
});

