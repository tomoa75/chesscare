import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPersonalizedMoveAnalyses,
  buildPersonalizedPlayerReport,
  classifyCentipawnLoss,
  createGame,
  createMoveAnalysis,
  createPlayer,
  createPositionCacheKey,
  createPositionEvaluation,
  extractPlayerMoveContexts,
  resolvePlayerColorInGame,
} from "./index.js";

const NOW = "2026-07-25T18:00:00.000Z";
const ENGINE = { name: "Stockfish", version: "18" };
const SETTINGS = {
  depth: 10,
  multiPv: 1,
  uciOptions: { Hash: 16 },
};

function profile() {
  return createPlayer(
    {
      id: "player-ana",
      displayName: "Ana Šarić",
      aliases: ["Šarić, Ana"],
    },
    { now: NOW },
  );
}

function domainGame({
  id,
  white,
  black,
  moves,
  result = "1-0",
  opening = "Test Opening",
  whitePlayerId = null,
  blackPlayerId = null,
  extraHeaders = {},
}) {
  const headers = {
    Event: "Test",
    White: white,
    Black: black,
    Result: result,
    Opening: opening,
    ...extraHeaders,
  };
  const pgnHeaders = Object.entries(headers)
    .map(([name, value]) => `[${name} "${value}"]`)
    .join("\n");

  return createGame(
    {
      id,
      title: `${white} - ${black}`,
      rawPgn: `${pgnHeaders}\n\n${moves}`,
      headers,
      players: { whitePlayerId, blackPlayerId },
      result,
      source: { kind: "migration" },
    },
    { now: NOW },
  );
}

test("identitet koristi playerId ili tocni potvrdeni alias bez fuzzy spajanja", () => {
  const ana = profile();
  const linked = domainGame({
    id: "linked",
    white: "Potpuno drugo ime",
    black: "Protivnik",
    moves: "1. e4 e5 1-0",
    whitePlayerId: ana.id,
  });
  const alias = domainGame({
    id: "alias",
    white: "Protivnik",
    black: "Šarić, Ana",
    moves: "1. e4 e5 1-0",
  });
  const similar = domainGame({
    id: "similar",
    white: "Ana Saric",
    black: "Protivnik",
    moves: "1. e4 e5 1-0",
  });
  const linkedToOther = domainGame({
    id: "other-link",
    white: "Ana Šarić",
    black: "Protivnik",
    moves: "1. e4 e5 1-0",
    whitePlayerId: "player-netko-drugi",
  });

  assert.deepEqual(resolvePlayerColorInGame(linked, ana), {
    status: "matched",
    color: "white",
    method: "player-id",
  });
  assert.deepEqual(resolvePlayerColorInGame(alias, ana), {
    status: "matched",
    color: "black",
    method: "confirmed-alias",
  });
  assert.equal(resolvePlayerColorInGame(similar, ana).status, "unmatched");
  assert.equal(resolvePlayerColorInGame(linkedToOther, ana).status, "unmatched");
});

test("isti potvrdeni alias na obje boje oznacava partiju kao nejasnu", () => {
  const ana = profile();
  const ambiguous = domainGame({
    id: "ambiguous",
    white: "Ana Šarić",
    black: "Šarić, Ana",
    moves: "1. e4 e5 1-0",
  });
  const extracted = extractPlayerMoveContexts([ambiguous], ana);

  assert.equal(resolvePlayerColorInGame(ambiguous, ana).status, "ambiguous");
  assert.deepEqual(extracted.contexts, []);
  assert.equal(extracted.warnings[0].code, "ambiguous-player-color");
});

test("izdvajaju se samo potezi ciljnog igraca kroz obje boje", () => {
  const ana = profile();
  const whiteGame = domainGame({
    id: "white-game",
    white: "Ana Šarić",
    black: "Marko",
    moves: "1. e4 e5 2. Nf3 Nc6 1-0",
    whitePlayerId: ana.id,
  });
  const blackGame = domainGame({
    id: "black-game",
    white: "Iva",
    black: "Šarić, Ana",
    moves: "1. d4 d5 2. c4 e6 1-0",
  });
  const extracted = extractPlayerMoveContexts([whiteGame, blackGame], ana);

  assert.deepEqual(
    extracted.contexts.map((context) => [
      context.gameId,
      context.color,
      context.ply,
      context.playedMove.san,
    ]),
    [
      ["white-game", "white", 1, "e4"],
      ["white-game", "white", 3, "Nf3"],
      ["black-game", "black", 2, "d5"],
      ["black-game", "black", 4, "e6"],
    ],
  );
  assert.equal(extracted.contexts.every((context) => context.phase === "opening"), true);
  assert.equal(extracted.warnings.length, 0);
});

async function cachedEvaluation(fen, value, bestMove = null) {
  const cacheKey = await createPositionCacheKey({
    fen,
    engine: ENGINE,
    settings: SETTINGS,
  });

  return createPositionEvaluation(
    {
      id: `evaluation-${cacheKey.slice(-12)}`,
      cacheKey,
      fen,
      engine: ENGINE,
      settings: SETTINGS,
      lines: [
        {
          multiPv: 1,
          depth: SETTINGS.depth,
          score: { type: "cp", value, perspective: "white" },
          bestMove,
          pv: bestMove ? [bestMove] : [],
        },
      ],
    },
    { now: NOW },
  );
}

test("cache prije i poslije poteza postaje personalizirani MoveAnalysis", async () => {
  const ana = profile();
  const game = domainGame({
    id: "analysis-game",
    white: "Ana Šarić",
    black: "Marko",
    moves: "1. e4 1-0",
    whitePlayerId: ana.id,
  });
  const extracted = extractPlayerMoveContexts([game], ana);
  const context = extracted.contexts[0];
  const evaluations = [
    await cachedEvaluation(context.beforeFen, 30, "d2d4"),
    await cachedEvaluation(context.afterFen, -90),
  ];
  const built = await buildPersonalizedMoveAnalyses({
    games: [game],
    player: ana,
    positionEvaluations: evaluations,
    engine: ENGINE,
    settings: SETTINGS,
    analysisRunId: "analysis-run-1",
  });

  assert.equal(built.moveAnalyses.length, 1);
  assert.equal(built.warnings.length, 0);
  assert.equal(built.moveAnalyses[0].playerId, ana.id);
  assert.equal(built.moveAnalyses[0].centipawnLoss, 120);
  assert.equal(built.moveAnalyses[0].classification, "mistake");
  assert.deepEqual(built.moveAnalyses[0].bestMove, {
    san: "d4",
    uci: "d2d4",
  });
});

test("centipawn gubitak za crnog ispravno okrece bijelu perspektivu", async () => {
  const ana = profile();
  const game = domainGame({
    id: "black-analysis",
    white: "Marko",
    black: "Ana Šarić",
    moves: "1. e4 e5 1-0",
    blackPlayerId: ana.id,
  });
  const context = extractPlayerMoveContexts([game], ana).contexts[0];
  const evaluations = [
    await cachedEvaluation(context.beforeFen, -40, "e7e5"),
    await cachedEvaluation(context.afterFen, 110),
  ];
  const built = await buildPersonalizedMoveAnalyses({
    games: [game],
    player: ana,
    positionEvaluations: evaluations,
    engine: ENGINE,
    settings: SETTINGS,
    analysisRunId: "analysis-run-black",
  });

  assert.equal(built.moveAnalyses[0].color, "black");
  assert.equal(built.moveAnalyses[0].centipawnLoss, 150);
  assert.equal(built.moveAnalyses[0].classification, "mistake");
  assert.deepEqual(built.moveAnalyses[0].bestMove, {
    san: "e5",
    uci: "e7e5",
  });
});

test("nedostajuci cache daje upozorenje umjesto nepotpunog rezultata", async () => {
  const ana = profile();
  const game = domainGame({
    id: "missing-cache",
    white: "Ana Šarić",
    black: "Marko",
    moves: "1. e4 1-0",
    whitePlayerId: ana.id,
  });
  const context = extractPlayerMoveContexts([game], ana).contexts[0];
  const built = await buildPersonalizedMoveAnalyses({
    games: [game],
    player: ana,
    positionEvaluations: [
      await cachedEvaluation(context.beforeFen, 20, "e2e4"),
    ],
    engine: ENGINE,
    settings: SETTINGS,
    analysisRunId: "analysis-run-missing",
  });

  assert.deepEqual(built.moveAnalyses, []);
  assert.equal(built.warnings[0].code, "missing-position-evaluation");
  assert.deepEqual(built.warnings[0].missing, ["after"]);
});

function analyzedMove({
  id,
  gameId,
  playerId = "player-ana",
  color,
  phase,
  loss,
}) {
  return createMoveAnalysis({
    id,
    analysisRunId: "report-run",
    gameId,
    playerId,
    ply: 1,
    color,
    phase,
    beforeFen: "before",
    afterFen: "after",
    playedMove: { san: "e4", uci: "e2e4" },
    bestMove: null,
    beforeEvaluation: { type: "cp", value: 0 },
    afterEvaluation: { type: "cp", value: 0 },
    centipawnLoss: loss,
    classification: classifyCentipawnLoss(loss),
  });
}

test("izvjestaj iskljucuje protivnika i grupira uz velicinu uzorka", () => {
  const ana = profile();
  const games = [
    domainGame({
      id: "report-1",
      white: "Ana Šarić",
      black: "Marko",
      moves: "1. e4 e5 1-0",
      opening: "Italian Game",
      whitePlayerId: ana.id,
    }),
    domainGame({
      id: "report-2",
      white: "Iva",
      black: "Ana Šarić",
      moves: "1. d4 d5 0-1",
      result: "0-1",
      opening: "Queen's Gambit",
      blackPlayerId: ana.id,
    }),
  ];
  const moves = [
    analyzedMove({
      id: "m1",
      gameId: "report-1",
      color: "white",
      phase: "opening",
      loss: 20,
    }),
    analyzedMove({
      id: "m2",
      gameId: "report-1",
      color: "white",
      phase: "middlegame",
      loss: 120,
    }),
    analyzedMove({
      id: "m3",
      gameId: "report-2",
      color: "black",
      phase: "endgame",
      loss: 250,
    }),
    analyzedMove({
      id: "opponent",
      gameId: "report-1",
      playerId: "player-marko",
      color: "black",
      phase: "opening",
      loss: 500,
    }),
  ];
  const report = buildPersonalizedPlayerReport({
    player: ana,
    moveAnalyses: moves,
    games,
  });

  assert.equal(report.overall.sampleSize, 3);
  assert.equal(report.overall.gameCount, 2);
  assert.equal(report.overall.averageLoss, 130);
  assert.equal(report.overall.classifications.good, 1);
  assert.equal(report.overall.classifications.mistake, 1);
  assert.equal(report.overall.classifications.blunder, 1);
  assert.equal(report.overall.confidence, "low");
  assert.deepEqual(
    report.byColor.map((group) => [group.key, group.sampleSize]),
    [
      ["white", 2],
      ["black", 1],
    ],
  );
  assert.deepEqual(report.weakestPhase, {
    phase: "endgame",
    averageLoss: 250,
    sampleSize: 1,
  });
  assert.deepEqual(
    report.byOpening.map((group) => [group.key, group.sampleSize]),
    [
      ["Italian Game", 2],
      ["Queen's Gambit", 1],
    ],
  );
});

test("izvjestaj grupira po godini i vremenski filter ne nagada nepotpune datume", () => {
  const ana = profile();
  const games = [
    domainGame({
      id: "dated-2024",
      white: "Ana Šarić",
      black: "Iva",
      moves: "1. e4 e5 1-0",
      whitePlayerId: ana.id,
      extraHeaders: { Date: "2024.01.15" },
    }),
    domainGame({
      id: "partial-date",
      white: "Ana Šarić",
      black: "Iva",
      moves: "1. d4 d5 1-0",
      whitePlayerId: ana.id,
      extraHeaders: { Date: "2025.??.??" },
    }),
    domainGame({
      id: "dated-2026",
      white: "Ana Šarić",
      black: "Iva",
      moves: "1. c4 c5 1-0",
      whitePlayerId: ana.id,
      extraHeaders: { Date: "2026.02.03" },
    }),
  ];
  const moves = [
    analyzedMove({
      id: "year-2024",
      gameId: "dated-2024",
      color: "white",
      phase: "opening",
      loss: 20,
    }),
    analyzedMove({
      id: "year-unknown",
      gameId: "partial-date",
      color: "white",
      phase: "opening",
      loss: 80,
    }),
    analyzedMove({
      id: "year-2026",
      gameId: "dated-2026",
      color: "white",
      phase: "opening",
      loss: 140,
    }),
  ];
  const all = buildPersonalizedPlayerReport({
    player: ana,
    moveAnalyses: moves,
    games,
  });
  const filtered = buildPersonalizedPlayerReport({
    player: ana,
    moveAnalyses: moves,
    games,
    period: { from: "2025-01-01", to: "2026-12-31" },
  });

  assert.deepEqual(
    all.byPeriod.map((group) => [group.key, group.sampleSize]),
    [
      ["2024", 1],
      ["2026", 1],
      ["unknown", 1],
    ],
  );
  assert.equal(filtered.overall.sampleSize, 1);
  assert.equal(filtered.byPeriod[0].key, "2026");
  assert.equal(filtered.period.excludedUndatedMoves, 1);
  assert.equal(filtered.period.excludedOutsideRangeMoves, 1);
  assert.equal(filtered.period.earliestAvailable, "2024-01-15");
  assert.equal(filtered.period.latestAvailable, "2026-02-03");
});

test("vremenski filter odbija neispravan ili obrnut raspon", () => {
  const ana = profile();

  assert.throws(
    () =>
      buildPersonalizedPlayerReport({
        player: ana,
        moveAnalyses: [],
        games: [],
        period: { from: "2026-??-01" },
      }),
    /YYYY-MM-DD/,
  );
  assert.throws(
    () =>
      buildPersonalizedPlayerReport({
        player: ana,
        moveAnalyses: [],
        games: [],
        period: { from: "2026-02-01", to: "2025-01-01" },
      }),
    /nakon kraja/,
  );
});
