import test from "node:test";
import assert from "node:assert/strict";
import {
  branchLine,
  createLineFromPgn,
  createPositionTimeline,
  getFenAtPly,
  getInitialFenFromHeaders,
  replayMoves,
  STANDARD_INITIAL_FEN,
} from "./index.js";

const STANDARD_MOVES = ["e4", "e5", "Nf3", "Nc6"];
const CUSTOM_FEN =
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

test("standardna linija vraca FEN za pocetak i svaki trazeni ply", () => {
  assert.equal(getFenAtPly(STANDARD_MOVES, 0), STANDARD_INITIAL_FEN);
  assert.equal(
    getFenAtPly(STANDARD_MOVES, 1),
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
  );
  assert.equal(
    getFenAtPly(STANDARD_MOVES, 4),
    replayMoves(STANDARD_MOVES).fen(),
  );
});

test("servis prihvaca SAN stringove i verbose chess.js poteze", () => {
  const verboseMoves = replayMoves(STANDARD_MOVES).history({
    verbose: true,
  });

  assert.equal(
    replayMoves(verboseMoves).fen(),
    replayMoves(STANDARD_MOVES).fen(),
  );
});

test("timeline sadrzi pocetnu poziciju i jedan zapis po potezu", () => {
  const timeline = createPositionTimeline(STANDARD_MOVES);

  assert.equal(timeline.length, STANDARD_MOVES.length + 1);
  assert.deepEqual(
    timeline.map((position) => position.ply),
    [0, 1, 2, 3, 4],
  );
  assert.equal(timeline[0].san, null);
  assert.equal(timeline[4].san, "Nc6");
  assert.equal(timeline[4].fen, replayMoves(STANDARD_MOVES).fen());
});

test("granice plyja i ilegalni potezi daju strukturirane greske", () => {
  assert.throws(
    () => getFenAtPly(STANDARD_MOVES, -1),
    (error) => error.code === "invalid-ply" && error.ply === -1,
  );
  assert.throws(
    () => getFenAtPly(STANDARD_MOVES, 5),
    (error) => error.code === "ply-out-of-range" && error.ply === 5,
  );
  assert.throws(
    () => replayMoves(["e4", "e4"]),
    (error) => error.code === "illegal-move" && error.ply === 2,
  );
  assert.throws(
    () => replayMoves([{ from: "e2", to: "e4" }]),
    (error) => error.code === "invalid-move" && error.ply === 1,
  );
});

test("SetUp/FEN partija koristi stvarnu pocetnu poziciju", () => {
  const pgn = [
    '[SetUp "1"]',
    `[FEN "${CUSTOM_FEN}"]`,
    '[Result "*"]',
    "",
    "1... c5 2. Nf3 *",
  ].join("\n");
  const line = createLineFromPgn(pgn);
  const canonicalInitialFen = replayMoves([], {
    initialFen: CUSTOM_FEN,
  }).fen();

  assert.equal(line.initialFen, CUSTOM_FEN);
  assert.equal(getFenAtPly(line.moves, 0, line), canonicalInitialFen);
  assert.equal(
    getFenAtPly(line.moves, line.moves.length, line),
    replayMoves(line.moves, line).fen(),
  );
});

test("permisivni lowercase fen header prati chess.js ponasanje", () => {
  assert.equal(getInitialFenFromHeaders({ fen: CUSTOM_FEN }), CUSTOM_FEN);
  assert.equal(getInitialFenFromHeaders({ Event: "Test" }), STANDARD_INITIAL_FEN);
});

test("neispravan pocetni FEN i PGN ne ruse servis bez jasne greske", () => {
  assert.throws(
    () => replayMoves([], { initialFen: "nije fen" }),
    (error) => error.code === "invalid-initial-fen",
  );
  assert.throws(
    () => createLineFromPgn("1. e4 e5 2. OvoNijePotez"),
    (error) => error.code === "invalid-pgn",
  );
});

test("grananje skracuje buducnost bez mutacije izvorne linije", () => {
  const originalMoves = [...STANDARD_MOVES];
  const branch = branchLine(originalMoves, 2, "Bc4");

  assert.deepEqual(originalMoves, STANDARD_MOVES);
  assert.deepEqual(
    branch.moves.map((move) => move.san),
    ["e4", "e5", "Bc4"],
  );
  assert.equal(
    branch.fen,
    replayMoves(["e4", "e5", "Bc4"]).fen(),
  );
});

test("grananje podrzava drag-and-drop oblik poteza i custom FEN", () => {
  const branch = branchLine(
    [],
    0,
    { from: "c7", to: "c5", promotion: "q" },
    { initialFen: CUSTOM_FEN },
  );

  assert.deepEqual(
    branch.moves.map((move) => move.san),
    ["c5"],
  );
  assert.equal(branch.initialFen, CUSTOM_FEN);
});
