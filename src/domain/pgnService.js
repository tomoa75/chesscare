import { Chess } from "chess.js";

export const PGN_MIME_TYPE = "application/x-chess-pgn;charset=utf-8";

export class PgnServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "PgnServiceError";
    this.code = code;
    this.gameIndex = options.gameIndex ?? null;
  }
}

export function splitPgnGames(pgnContent) {
  if (typeof pgnContent !== "string") {
    throw new TypeError("PGN sadrzaj mora biti string.");
  }

  return pgnContent
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n(?=\s*\[)/g)
    .map((game) => game.trim())
    .filter(Boolean);
}

export function parsePgnCollection(pgnContent) {
  const parts = splitPgnGames(pgnContent);

  if (parts.length === 0) {
    throw new PgnServiceError("empty-pgn", "PGN datoteka je prazna.");
  }

  return parts.map((singlePgn, gameIndex) => {
    const game = new Chess();

    try {
      game.loadPgn(singlePgn);
      return game;
    } catch (error) {
      throw new PgnServiceError(
        "invalid-pgn",
        `Partija ${gameIndex + 1} nije u ispravnom PGN formatu.`,
        { cause: error, gameIndex },
      );
    }
  });
}

export function buildLegacyGameTitle(headers = {}) {
  const event = headers.Event || "Partija";
  const white = headers.White || "Bijeli";
  const black = headers.Black || "Crni";

  return `${event}: ${white} - ${black}`;
}

export function createLegacyGameRecord(game, index, options = {}) {
  if (
    !game ||
    typeof game.header !== "function" ||
    typeof game.pgn !== "function"
  ) {
    throw new TypeError("Game mora biti valjana chess.js instanca.");
  }

  if (!Number.isInteger(index) || index < 0) {
    throw new TypeError("Indeks partije mora biti nenegativan cijeli broj.");
  }

  const now = options.now || Date.now;
  const random = options.random || Math.random;

  return {
    id: `${now()}-${index}-${random().toString(36).slice(2)}`,
    title: buildLegacyGameTitle(game.header()),
    pgn: game.pgn(),
  };
}

export function createLegacyGameRecords(games, options = {}) {
  if (!Array.isArray(games)) {
    throw new TypeError("Partije moraju biti polje.");
  }

  return games.map((game, index) =>
    createLegacyGameRecord(game, index, options),
  );
}

export function serializeLegacyGameRecords(records) {
  if (!Array.isArray(records)) {
    throw new TypeError("Zapisi partija moraju biti polje.");
  }

  return records
    .map((record, index) => {
      if (typeof record?.pgn !== "string") {
        throw new TypeError(`Zapis partije ${index + 1} nema PGN string.`);
      }
      return record.pgn;
    })
    .join("\n\n");
}

export function normalizePgnFileName(fileName = "partija.pgn") {
  if (typeof fileName !== "string" || fileName.trim() === "") {
    throw new TypeError("Ime PGN datoteke mora biti neprazan string.");
  }

  return fileName.toLowerCase().endsWith(".pgn")
    ? fileName
    : `${fileName}.pgn`;
}

export function createPgnDownloadDescriptor(
  pgnText,
  fileName = "partija.pgn",
) {
  if (typeof pgnText !== "string" || pgnText.trim() === "") {
    throw new PgnServiceError(
      "empty-pgn",
      "Nema partija za spremanje.",
    );
  }

  return {
    pgnText,
    fileName: normalizePgnFileName(fileName),
    mimeType: PGN_MIME_TYPE,
  };
}

export function isAcceptedLegacyPgnFile(file) {
  return Boolean(
    file &&
      typeof file.name === "string" &&
      (file.name.endsWith(".pgn") || file.type === "text/plain"),
  );
}

