import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLegacyGameTitle,
  createLegacyGameRecords,
  createPgnDownloadDescriptor,
  isAcceptedLegacyPgnFile,
  normalizePgnFileName,
  parsePgnCollection,
  serializeLegacyGameRecords,
  splitPgnGames,
} from "./index.js";

const FIRST_GAME = [
  '[Event "Prva"]',
  '[White "Ana"]',
  '[Black "Marko"]',
  '[Result "1-0"]',
  "",
  "1. e4 e5 2. Nf3 Nc6 1-0",
].join("\n");

const SECOND_GAME = [
  '[Event "Druga"]',
  '[White "Iva"]',
  '[Black "Ivan"]',
  '[Result "1/2-1/2"]',
  "",
  "1. d4 d5 1/2-1/2",
].join("\n");

test("splitPgnGames reproducira postojeci visepartijski split i CRLF podrsku", () => {
  const collection = `${FIRST_GAME}\r\n\r\n${SECOND_GAME.replace(/\n/g, "\r\n")}`;
  const parts = splitPgnGames(collection);

  assert.equal(parts.length, 2);
  assert.match(parts[0], /\[Event "Prva"\]/);
  assert.match(parts[1], /\[Event "Druga"\]/);
  assert.equal(parts.some((part) => part.includes("\r")), false);
});

test("parsePgnCollection ucitava jednu i vise chess.js partija", () => {
  const single = parsePgnCollection(FIRST_GAME);
  const multiple = parsePgnCollection(`${FIRST_GAME}\n\n${SECOND_GAME}`);

  assert.equal(single.length, 1);
  assert.deepEqual(single[0].history(), ["e4", "e5", "Nf3", "Nc6"]);
  assert.equal(multiple.length, 2);
  assert.equal(multiple[1].header().Event, "Druga");
});

test("prazan i neispravan PGN daju strukturiranu gresku", () => {
  assert.throws(
    () => parsePgnCollection(" \r\n "),
    (error) => error.code === "empty-pgn",
  );
  assert.throws(
    () => parsePgnCollection("1. e4 e5 2. OvoNijePotez"),
    (error) => error.code === "invalid-pgn" && error.gameIndex === 0,
  );
});

test("jedna neispravna partija odbija cijelu kolekciju kao postojeci loader", () => {
  const invalidSecond = [
    '[Event "Neispravna"]',
    "",
    "1. d4 d5 2. OvoNijePotez",
  ].join("\n");

  assert.throws(
    () => parsePgnCollection(`${FIRST_GAME}\n\n${invalidSecond}`),
    (error) => error.code === "invalid-pgn" && error.gameIndex === 1,
  );
});

test("legacy naslov i zapis zadrzavaju postojece fallback ponasanje", () => {
  const [game] = parsePgnCollection(FIRST_GAME);
  const records = createLegacyGameRecords([game], {
    now: () => 12345,
    random: () => 0.5,
  });

  assert.equal(buildLegacyGameTitle({}), "Partija: Bijeli - Crni");
  assert.equal(
    buildLegacyGameTitle({ Event: "?", White: "?", Black: "?" }),
    "?: ? - ?",
    "chess.js placeholderi ostaju dokumentirano legacy ponasanje",
  );
  assert.equal(records[0].id, "12345-0-i");
  assert.equal(records[0].title, "Prva: Ana - Marko");
  assert.match(records[0].pgn, /1\. e4 e5 2\. Nf3 Nc6 1-0/);
});

test("izvoz zbirke spaja PGN zapise s tocno dva nova retka", () => {
  assert.equal(
    serializeLegacyGameRecords([
      { id: "1", pgn: "1. e4 e5" },
      { id: "2", pgn: "1. d4 d5" },
    ]),
    "1. e4 e5\n\n1. d4 d5",
  );
  assert.equal(serializeLegacyGameRecords([]), "");
});

test("download descriptor izdvaja postojece ime i MIME ponasanje", () => {
  assert.equal(normalizePgnFileName("partija"), "partija.pgn");
  assert.equal(normalizePgnFileName("PARTIJA.PGN"), "PARTIJA.PGN");
  assert.deepEqual(createPgnDownloadDescriptor("1. e4", "moja-partija"), {
    pgnText: "1. e4",
    fileName: "moja-partija.pgn",
    mimeType: "application/x-chess-pgn;charset=utf-8",
  });
  assert.throws(
    () => createPgnDownloadDescriptor("  ", "prazna"),
    (error) => error.code === "empty-pgn",
  );
});

test("legacy provjera datoteke ostaje case-sensitive", () => {
  assert.equal(
    isAcceptedLegacyPgnFile({ name: "partija.pgn", type: "" }),
    true,
  );
  assert.equal(
    isAcceptedLegacyPgnFile({ name: "PARTIJA.PGN", type: "" }),
    false,
  );
  assert.equal(
    isAcceptedLegacyPgnFile({ name: "partija.txt", type: "text/plain" }),
    true,
  );
});

test("komentari ostaju dostupni nakon parsiranja i ponovnog PGN izvoza", () => {
  const [game] = parsePgnCollection(
    "1. e4 e5 {Komentar pozicije} 2. Nf3 *",
  );

  assert.equal(game.getComments().length, 1);
  assert.match(game.pgn(), /\{Komentar pozicije\}/);
});

test("NAG oznake se prihvacaju, ali chess.js ih ne vraca u history", () => {
  const [game] = parsePgnCollection("1. e4 $1 e5 *");

  assert.deepEqual(game.history(), ["e4", "e5"]);
  assert.doesNotMatch(game.pgn(), /\$1/);
});

test("SetUp i FEN pocetna pozicija ostaju sacuvani", () => {
  const setupPgn = [
    '[SetUp "1"]',
    '[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"]',
    '[Result "*"]',
    "",
    "1... c5 *",
  ].join("\n");
  const [game] = parsePgnCollection(setupPgn);

  assert.deepEqual(game.history(), ["c5"]);
  assert.equal(game.header().SetUp, "1");
  assert.match(game.pgn(), /\[FEN "/);
});

test("glavna linija ostaje citljiva kada PGN sadrzi varijantu", () => {
  const [game] = parsePgnCollection("1. e4 (1. d4 d5) e5 *");

  assert.deepEqual(game.history(), ["e4", "e5"]);
  assert.doesNotMatch(game.pgn(), /\(1\. d4/);
});
