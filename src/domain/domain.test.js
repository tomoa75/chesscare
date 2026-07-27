import test from "node:test";
import assert from "node:assert/strict";
import {
  createAnalysisRun,
  createGame,
  createMoveAnalysis,
  createPlayer,
  normalizePlayerAlias,
  playerMatchesAlias,
} from "./index.js";

const NOW = "2026-07-25T10:00:00.000Z";

test("igrac normalizira i uklanja duplicirane aliase", () => {
  const player = createPlayer(
    {
      id: "player-1",
      displayName: "Magnus Carlsen",
      aliases: ["  MAGNUS   CARLSEN ", "Carlsen, Magnus"],
    },
    { now: NOW },
  );

  assert.deepEqual(player.aliases, [
    "Magnus Carlsen",
    "Carlsen, Magnus",
  ]);
  assert.equal(normalizePlayerAlias("  MAGNUS   CARLSEN "), "magnus carlsen");
  assert.equal(playerMatchesAlias(player, "carlsen, magnus"), true);
});

test("partija cuva izvorni PGN i veze prema igracima", () => {
  const game = createGame(
    {
      id: "game-1",
      title: "Test: White - Black",
      rawPgn: '[Event "Test"]\n[Result "1-0"]\n\n1. e4 e5 1-0',
      headers: { Event: "Test", Result: "1-0" },
      players: {
        whitePlayerId: "player-white",
        blackPlayerId: "player-black",
      },
      source: { kind: "file", fileName: "test.pgn" },
    },
    { now: NOW },
  );

  assert.equal(game.result, "1-0");
  assert.equal(game.source.fileName, "test.pgn");
  assert.equal(game.players.whitePlayerId, "player-white");
  assert.match(game.rawPgn, /1\. e4 e5/);
});

test("analiticki posao biljezi engine, postavke i napredak", () => {
  const run = createAnalysisRun(
    {
      id: "analysis-1",
      gameIds: ["game-1", "game-1", "game-2"],
      engine: { name: "Stockfish", version: "18" },
      settings: { depth: 12, multiPv: 1 },
      status: "running",
      progress: { completed: 3, total: 10 },
    },
    { now: NOW },
  );

  assert.deepEqual(run.gameIds, ["game-1", "game-2"]);
  assert.deepEqual(run.progress, { completed: 3, total: 10 });
  assert.equal(run.engine.version, "18");
});

test("rezultat poteza povezuje evaluacije s partijom i igracem", () => {
  const result = createMoveAnalysis({
    id: "move-analysis-1",
    analysisRunId: "analysis-1",
    gameId: "game-1",
    playerId: "player-white",
    ply: 1,
    color: "white",
    phase: "opening",
    beforeFen: "start-fen",
    afterFen: "after-fen",
    playedMove: { san: "e4", uci: "e2e4" },
    bestMove: { san: "d4", uci: "d2d4" },
    beforeEvaluation: { type: "cp", value: 30 },
    afterEvaluation: { type: "cp", value: 5 },
    centipawnLoss: 25,
    classification: "good",
  });

  assert.equal(result.beforeEvaluation.perspective, "white");
  assert.equal(result.playedMove.uci, "e2e4");
  assert.equal(result.centipawnLoss, 25);
});

test("model odbija nedosljedan napredak i zavrsenu analizu bez vremena", () => {
  assert.throws(
    () =>
      createAnalysisRun({
        gameIds: ["game-1"],
        engine: { name: "Stockfish", version: "18" },
        settings: { depth: 8 },
        progress: { completed: 2, total: 1 },
      }),
    /ne moze biti veci/,
  );

  assert.throws(
    () =>
      createAnalysisRun({
        gameIds: ["game-1"],
        engine: { name: "Stockfish", version: "18" },
        settings: { depth: 8 },
        status: "completed",
      }),
    /completedAt/,
  );

  assert.throws(
    () =>
      createAnalysisRun({
        gameIds: ["game-1"],
        engine: { name: "Stockfish", version: "18" },
        settings: { depth: 0 },
      }),
    /Dubina analize/,
  );
});
