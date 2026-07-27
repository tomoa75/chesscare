import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptLegacyGameRecord,
  adaptLegacyGameRecords,
  createReadOnlyAdapterReport,
  formatReadOnlyAdapterReport,
} from "./index.js";

const NOW = "2026-07-25T12:00:00.000Z";

function gamePgn({
  event = "Zagreb Open",
  white = "Ana Saric",
  black = "Marko Horvat",
  result = "1-0",
  moves = "1. e4 e5 2. Nf3 Nc6 1-0",
} = {}) {
  return [
    `[Event "${event}"]`,
    `[White "${white}"]`,
    `[Black "${black}"]`,
    `[Result "${result}"]`,
    "",
    moves,
  ].join("\n");
}

test("ispravan legacy PGN postaje Game i predlaze oba igraca", async () => {
  const pgn = gamePgn();
  const converted = await adaptLegacyGameRecord(
    { id: "legacy-1", title: "Stari naslov", pgn },
    { now: NOW, sourceFileName: "partije.pgn" },
  );

  assert.equal(converted.warnings.length, 0);
  assert.equal(converted.game.id, "legacy-1");
  assert.equal(converted.game.title, "Stari naslov");
  assert.equal(converted.game.rawPgn, pgn);
  assert.equal(converted.game.headers.White, "Ana Saric");
  assert.equal(converted.game.source.kind, "migration");
  assert.equal(converted.game.source.fileName, "partije.pgn");
  assert.match(converted.game.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    converted.playerOccurrences.map((player) => player.sourceName),
    ["Ana Saric", "Marko Horvat"],
  );
});

test("nepotpuni headeri daju fallback podatke i upozorenja", async () => {
  const converted = await adaptLegacyGameRecord(
    { id: "legacy-incomplete", pgn: "1. d4 d5 2. c4" },
    { now: NOW },
  );

  assert.ok(converted.game);
  assert.equal(converted.game.title, "Partija: Bijeli - Crni");
  assert.equal(converted.game.result, "*");
  assert.equal(converted.game.players.whitePlayerId, null);
  assert.equal(converted.game.players.blackPlayerId, null);
  assert.deepEqual(converted.playerOccurrences, []);

  const codes = new Set(converted.warnings.map((item) => item.code));
  assert.equal(codes.has("missing-title"), true);
  assert.equal(codes.has("missing-event"), true);
  assert.equal(codes.has("missing-white-player"), true);
  assert.equal(codes.has("missing-black-player"), true);
  assert.equal(codes.has("missing-result"), true);
});

test("neispravan PGN ne rusi batch import", async () => {
  const adapted = await adaptLegacyGameRecords(
    [
      {
        id: "valid",
        title: "Valjana",
        pgn: gamePgn(),
      },
      {
        id: "invalid",
        title: "Nevaljana",
        pgn: "1. e4 e5 2. OvoNijePotez",
      },
    ],
    { now: NOW },
  );

  assert.equal(adapted.summary.recordsReceived, 2);
  assert.equal(adapted.summary.gamesConverted, 1);
  assert.equal(adapted.summary.gamesRejected, 1);
  assert.equal(adapted.games[0].id, "valid");
  assert.equal(
    adapted.warnings.some(
      (item) => item.recordId === "invalid" && item.code === "invalid-pgn",
    ),
    true,
  );
});

test("Unicode normalizacija spaja samo jednaka dijakriticka imena", async () => {
  const composedName = "Željko Šarić";
  const decomposedName = composedName.normalize("NFD");
  const adapted = await adaptLegacyGameRecords(
    [
      {
        id: "unicode-1",
        title: "Unicode 1",
        pgn: gamePgn({
          white: composedName,
          black: "Protivnik Jedan",
          moves: "1. e4 e5 1-0",
        }),
      },
      {
        id: "unicode-2",
        title: "Unicode 2",
        pgn: gamePgn({
          white: decomposedName,
          black: "Protivnik Dva",
          moves: "1. d4 d5 1-0",
        }),
      },
    ],
    { now: NOW },
  );

  const player = adapted.playerSuggestions.find(
    (suggestion) => suggestion.profile.displayName === composedName,
  );

  assert.ok(player);
  assert.equal(player.occurrences.length, 2);
  assert.deepEqual(player.sourceNames, [composedName, decomposedName]);
  assert.equal(
    player.occurrences[1].sourceName,
    decomposedName,
    "izvorni Unicode zapis mora ostati sacuvan",
  );
});

test("razliciti aliasi se oznacavaju za rucnu provjeru, ali se ne spajaju", async () => {
  const adapted = await adaptLegacyGameRecords(
    [
      {
        id: "alias-1",
        title: "Alias 1",
        pgn: gamePgn({
          white: "Magnus Carlsen",
          black: "Ian Nepomniachtchi",
          moves: "1. e4 e5 1-0",
        }),
      },
      {
        id: "alias-2",
        title: "Alias 2",
        pgn: gamePgn({
          white: "Carlsen, Magnus",
          black: "Nepomniachtchi, Ian",
          moves: "1. d4 Nf6 1-0",
        }),
      },
      {
        id: "similar-only",
        title: "Slicno ime",
        pgn: gamePgn({
          white: "Magnus Carlssen",
          black: "Drugi Protivnik",
          moves: "1. c4 e5 1-0",
        }),
      },
    ],
    { now: NOW },
  );

  const magnusProfiles = adapted.playerSuggestions.filter((suggestion) =>
    suggestion.sourceNames.some((name) => name.includes("Magnus")),
  );

  assert.equal(magnusProfiles.length, 3);
  assert.equal(
    adapted.possiblePlayerMatches.some(
      (match) =>
        match.leftSourceNames.includes("Magnus Carlsen") &&
        match.rightSourceNames.includes("Carlsen, Magnus") &&
        match.action === "manual-review",
    ),
    true,
  );
  assert.equal(
    adapted.possiblePlayerMatches.some((match) =>
      [...match.leftSourceNames, ...match.rightSourceNames].includes(
        "Magnus Carlssen",
      ),
    ),
    false,
  );
});

test("stabilni fingerprint prepoznaje semanticki jednake duplikate", async () => {
  const originalPgn = gamePgn();
  const sameGameWithWindowsLines = originalPgn.replace(/\n/g, "\r\n");
  const adapted = await adaptLegacyGameRecords(
    [
      { id: "duplicate-1", title: "Prvi zapis", pgn: originalPgn },
      {
        id: "duplicate-2",
        title: "Drugi naslov",
        pgn: sameGameWithWindowsLines,
      },
    ],
    { now: NOW },
  );

  assert.equal(
    adapted.games[0].fingerprint,
    adapted.games[1].fingerprint,
  );
  assert.equal(adapted.duplicateGroups.length, 1);
  assert.equal(adapted.duplicateGroups[0].primaryGameId, "duplicate-1");
  assert.deepEqual(adapted.duplicateGroups[0].duplicateGameIds, [
    "duplicate-2",
  ]);
  assert.equal(adapted.summary.duplicatesFound, 1);
});

test("read-only razvojni izvjestaj prikazuje trazene brojeve i upozorenja", async (t) => {
  const adapted = await adaptLegacyGameRecords(
    [
      { id: "report-valid", title: "Valjana", pgn: gamePgn() },
      { id: "report-duplicate", title: "Duplikat", pgn: gamePgn() },
      { id: "report-invalid", title: "Los PGN", pgn: "nije PGN" },
    ],
    { now: NOW },
  );
  const report = createReadOnlyAdapterReport(adapted);
  const formatted = formatReadOnlyAdapterReport(adapted);

  assert.equal(report.recordsReceived, 3);
  assert.equal(report.gamesConverted, 2);
  assert.equal(report.gamesRejected, 1);
  assert.equal(report.playersProposed, 2);
  assert.equal(report.duplicatesFound, 1);
  assert.ok(report.warnings >= 1);
  assert.match(formatted, /Partija pretvoreno: 2/);
  assert.match(formatted, /Duplikata pronadjeno: 1/);
  assert.match(formatted, /invalid-pgn/);

  t.diagnostic(`\n${formatted}`);
});

