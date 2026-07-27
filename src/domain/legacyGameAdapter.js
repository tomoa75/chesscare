import { Chess } from "chess.js";
import { GAME_RESULTS } from "./constants.js";
import { createGame } from "./game.js";
import { createPlayer, normalizePlayerAlias } from "./player.js";
import { sha256Hex } from "./stableHash.js";

const PLAYER_HEADERS = [
  { color: "white", header: "White" },
  { color: "black", header: "Black" },
];

const FINGERPRINT_HEADERS = [
  "Event",
  "Site",
  "Date",
  "Round",
  "White",
  "Black",
  "Result",
  "SetUp",
  "FEN",
];

function warning(code, message, context = {}, severity = "warning") {
  return {
    code,
    severity,
    recordIndex: context.recordIndex ?? null,
    recordId: context.recordId ?? null,
    message,
  };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isMeaningfulHeader(value) {
  return isNonEmptyString(value) && value.trim() !== "?";
}

function declaredHeaderNames(pgn) {
  return new Set(
    Array.from(
      pgn.matchAll(/^\s*\[([A-Za-z0-9_]+)\s+"/gm),
      (match) => match[1],
    ),
  );
}

function declaredHeadersOnly(headers, declaredNames) {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => declaredNames.has(name)),
  );
}

function normalizeIdentityText(value) {
  return String(value)
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function canonicalPlayerTokens(value, foldDiacritics = false) {
  let normalized = normalizeIdentityText(value);

  if (foldDiacritics) {
    normalized = normalized.normalize("NFD").replace(/\p{M}/gu, "");
  }

  return normalized
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join("|");
}

function canonicalGamePayload(chess) {
  const headers = chess.header();
  const identityHeaders = Object.fromEntries(
    FINGERPRINT_HEADERS.filter((name) => isMeaningfulHeader(headers[name])).map(
      (name) => [name, normalizeIdentityText(headers[name])],
    ),
  );

  return JSON.stringify({
    headers: identityHeaders,
    moves: chess.history(),
  });
}

export async function createStableGameFingerprint(chess) {
  return `sha256:${await sha256Hex(canonicalGamePayload(chess))}`;
}

async function createStablePlayerId(normalizedName) {
  return `player-sha256-${await sha256Hex(normalizedName)}`;
}

function safeResult(headers, declaredNames, context, warnings) {
  const result = headers.Result;

  if (!declaredNames.has("Result") || !isMeaningfulHeader(result)) {
    warnings.push(
      warning(
        "missing-result",
        "PGN nema Result header; rezultat je postavljen na '*'.",
        context,
      ),
    );
    return "*";
  }

  if (!GAME_RESULTS.includes(result)) {
    warnings.push(
      warning(
        "unsupported-result",
        `PGN rezultat '${result}' nije podrzan; rezultat je postavljen na '*'.`,
        context,
      ),
    );
    return "*";
  }

  return result;
}

function fallbackTitle(headers) {
  const event = isMeaningfulHeader(headers.Event) ? headers.Event : "Partija";
  const white = isMeaningfulHeader(headers.White) ? headers.White : "Bijeli";
  const black = isMeaningfulHeader(headers.Black) ? headers.Black : "Crni";

  return `${event}: ${white} - ${black}`;
}

function collectPlayerOccurrences(
  headers,
  declaredNames,
  gameId,
  context,
  warnings,
) {
  return PLAYER_HEADERS.flatMap(({ color, header }) => {
    const sourceName = headers[header];

    if (!declaredNames.has(header) || !isMeaningfulHeader(sourceName)) {
      warnings.push(
        warning(
          `missing-${color}-player`,
          `PGN nema ${header} header; profil za tu boju nije predlozen.`,
          context,
        ),
      );
      return [];
    }

    return [
      {
        color,
        gameId,
        sourceName,
        normalizedName: normalizePlayerAlias(sourceName),
      },
    ];
  });
}

export async function adaptLegacyGameRecord(record, options = {}) {
  const recordIndex = options.recordIndex ?? null;
  const recordId = isNonEmptyString(record?.id) ? record.id.trim() : null;
  const context = { recordIndex, recordId };
  const warnings = [];

  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return {
      game: null,
      playerOccurrences: [],
      warnings: [
        warning(
          "invalid-record",
          "Legacy zapis mora biti objekt.",
          context,
          "error",
        ),
      ],
    };
  }

  if (!isNonEmptyString(record.pgn)) {
    return {
      game: null,
      playerOccurrences: [],
      warnings: [
        warning(
          "missing-pgn",
          "Legacy zapis nema PGN sadržaj.",
          context,
          "error",
        ),
      ],
    };
  }

  const chess = new Chess();

  try {
    chess.loadPgn(record.pgn);
  } catch (error) {
    return {
      game: null,
      playerOccurrences: [],
      warnings: [
        warning(
          "invalid-pgn",
          `PGN se ne moze parsirati: ${error.message}`,
          context,
          "error",
        ),
      ],
    };
  }

  const headers = chess.header();
  const declaredNames = declaredHeaderNames(record.pgn);
  const sourceHeaders = declaredHeadersOnly(headers, declaredNames);
  const fingerprint = await createStableGameFingerprint(chess);
  const gameId = recordId || `game-${fingerprint.slice("sha256:".length)}`;

  if (!recordId) {
    warnings.push(
      warning(
        "missing-id",
        "Legacy zapis nema ID; generiran je stabilni ID iz fingerprinta.",
        context,
      ),
    );
  }

  if (!isNonEmptyString(record.title)) {
    warnings.push(
      warning(
        "missing-title",
        "Legacy zapis nema naslov; naslov je izveden iz PGN headera.",
        context,
      ),
    );
  }

  if (!declaredNames.has("Event") || !isMeaningfulHeader(headers.Event)) {
    warnings.push(
      warning("missing-event", "PGN nema Event header.", context),
    );
  }

  if (chess.history().length === 0) {
    warnings.push(
      warning("missing-moves", "PGN ne sadrzi nijedan potez.", context),
    );
  }

  const playerOccurrences = collectPlayerOccurrences(
    headers,
    declaredNames,
    gameId,
    context,
    warnings,
  );
  const playerIdByColor = Object.fromEntries(
    await Promise.all(
      playerOccurrences.map(async (occurrence) => [
        occurrence.color,
        await createStablePlayerId(occurrence.normalizedName),
      ]),
    ),
  );
  const result = safeResult(headers, declaredNames, context, warnings);
  const game = createGame(
    {
      id: gameId,
      title: isNonEmptyString(record.title)
        ? record.title.trim()
        : fallbackTitle(headers),
      rawPgn: record.pgn,
      headers: sourceHeaders,
      players: {
        whitePlayerId: playerIdByColor.white || null,
        blackPlayerId: playerIdByColor.black || null,
      },
      result,
      source: {
        kind: "migration",
        fileName: isNonEmptyString(options.sourceFileName)
          ? options.sourceFileName.trim()
          : null,
      },
      fingerprint,
      importedAt: options.now,
    },
    { now: options.now },
  );

  return { game, playerOccurrences, warnings };
}

async function buildPlayerSuggestions(occurrences, now) {
  const groups = new Map();

  for (const occurrence of occurrences) {
    const current = groups.get(occurrence.normalizedName) || [];
    current.push(occurrence);
    groups.set(occurrence.normalizedName, current);
  }

  return Promise.all(
    Array.from(groups.entries()).map(async ([normalizedName, items]) => {
      const sourceNames = [...new Set(items.map((item) => item.sourceName))];
      const profile = createPlayer(
        {
          id: await createStablePlayerId(normalizedName),
          displayName: sourceNames[0],
          aliases: sourceNames.slice(1),
        },
        { now },
      );

      return {
        profile,
        normalizedName,
        sourceNames,
        occurrences: items,
      };
    }),
  );
}

function findPossiblePlayerMatches(playerSuggestions) {
  const matches = [];

  for (let leftIndex = 0; leftIndex < playerSuggestions.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < playerSuggestions.length;
      rightIndex += 1
    ) {
      const left = playerSuggestions[leftIndex];
      const right = playerSuggestions[rightIndex];
      const exactTokensLeft = canonicalPlayerTokens(left.normalizedName);
      const exactTokensRight = canonicalPlayerTokens(right.normalizedName);
      const foldedTokensLeft = canonicalPlayerTokens(left.normalizedName, true);
      const foldedTokensRight = canonicalPlayerTokens(
        right.normalizedName,
        true,
      );
      let reason = null;

      if (
        exactTokensLeft &&
        exactTokensLeft.includes("|") &&
        exactTokensLeft === exactTokensRight
      ) {
        reason = "same-tokens-different-order-or-punctuation";
      } else if (
        foldedTokensLeft &&
        foldedTokensLeft.includes("|") &&
        foldedTokensLeft === foldedTokensRight
      ) {
        reason = "possible-diacritic-variant";
      }

      if (reason) {
        matches.push({
          leftPlayerId: left.profile.id,
          rightPlayerId: right.profile.id,
          leftSourceNames: left.sourceNames,
          rightSourceNames: right.sourceNames,
          reason,
          action: "manual-review",
        });
      }
    }
  }

  return matches;
}

function findDuplicateGroups(games) {
  const byFingerprint = new Map();

  for (const game of games) {
    const current = byFingerprint.get(game.fingerprint) || [];
    current.push(game.id);
    byFingerprint.set(game.fingerprint, current);
  }

  return Array.from(byFingerprint.entries())
    .filter(([, gameIds]) => gameIds.length > 1)
    .map(([fingerprint, gameIds]) => ({
      fingerprint,
      primaryGameId: gameIds[0],
      duplicateGameIds: gameIds.slice(1),
      gameIds,
    }));
}

export async function adaptLegacyGameRecords(records, options = {}) {
  if (!Array.isArray(records)) {
    throw new TypeError("Legacy zapisi moraju biti polje.");
  }

  const converted = await Promise.all(
    records.map((record, recordIndex) =>
      adaptLegacyGameRecord(record, { ...options, recordIndex }),
    ),
  );
  const games = converted.flatMap((item) => (item.game ? [item.game] : []));
  const warnings = converted.flatMap((item) => item.warnings);
  const occurrences = converted.flatMap((item) => item.playerOccurrences);
  const playerSuggestions = await buildPlayerSuggestions(
    occurrences,
    options.now,
  );
  const duplicateGroups = findDuplicateGroups(games);
  const possiblePlayerMatches = findPossiblePlayerMatches(playerSuggestions);

  return {
    games,
    playerSuggestions,
    possiblePlayerMatches,
    duplicateGroups,
    warnings,
    summary: {
      recordsReceived: records.length,
      gamesConverted: games.length,
      gamesRejected: records.length - games.length,
      playersProposed: playerSuggestions.length,
      duplicatesFound: duplicateGroups.reduce(
        (total, group) => total + group.duplicateGameIds.length,
        0,
      ),
      possiblePlayerMatches: possiblePlayerMatches.length,
      warnings: warnings.length,
    },
  };
}

export function createReadOnlyAdapterReport(adapterResult) {
  return {
    ...adapterResult.summary,
    warningDetails: adapterResult.warnings.map((item) => ({
      code: item.code,
      severity: item.severity,
      recordIndex: item.recordIndex,
      recordId: item.recordId,
      message: item.message,
    })),
  };
}

export function formatReadOnlyAdapterReport(adapterResult) {
  const report = createReadOnlyAdapterReport(adapterResult);

  return [
    "Chesscare read-only legacy adapter report",
    `Zapisa primljeno: ${report.recordsReceived}`,
    `Partija pretvoreno: ${report.gamesConverted}`,
    `Partija odbijeno: ${report.gamesRejected}`,
    `Igraca predlozeno: ${report.playersProposed}`,
    `Duplikata pronadjeno: ${report.duplicatesFound}`,
    `Mogucih alias podudaranja: ${report.possiblePlayerMatches}`,
    `Upozorenja: ${report.warnings}`,
    ...report.warningDetails.map(
      (item) =>
        `- [${item.severity}] zapis ${item.recordIndex}: ${item.code} - ${item.message}`,
    ),
  ].join("\n");
}
