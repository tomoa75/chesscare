import { Chess, DEFAULT_POSITION } from "chess.js";

export { DEFAULT_POSITION as STANDARD_INITIAL_FEN };

export class PositionServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "PositionServiceError";
    this.code = code;
    this.ply = options.ply ?? null;
  }
}

function requireMoves(moves) {
  if (!Array.isArray(moves)) {
    throw new TypeError("Potezi moraju biti polje.");
  }

  return moves;
}

function requirePly(ply, maximum) {
  if (!Number.isInteger(ply) || ply < 0) {
    throw new PositionServiceError(
      "invalid-ply",
      "Ply mora biti nenegativan cijeli broj.",
      { ply },
    );
  }

  if (ply > maximum) {
    throw new PositionServiceError(
      "ply-out-of-range",
      `Ply ${ply} je izvan povijesti od ${maximum} poteza.`,
      { ply },
    );
  }

  return ply;
}

function moveInput(move, ply) {
  if (typeof move === "string" && move.trim() !== "") return move;
  if (move && typeof move.san === "string" && move.san.trim() !== "") {
    return move.san;
  }

  throw new PositionServiceError(
    "invalid-move",
    `Potez na plyju ${ply} nema SAN zapis.`,
    { ply },
  );
}

function createChessAtInitialFen(initialFen) {
  if (typeof initialFen !== "string" || initialFen.trim() === "") {
    throw new PositionServiceError(
      "invalid-initial-fen",
      "Pocetni FEN mora biti neprazan string.",
    );
  }

  try {
    return new Chess(initialFen);
  } catch (error) {
    throw new PositionServiceError(
      "invalid-initial-fen",
      "Pocetni FEN nije valjan.",
      { cause: error },
    );
  }
}

export function getInitialFenFromHeaders(headers = {}) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    throw new TypeError("PGN headeri moraju biti objekt.");
  }

  const fenEntry = Object.entries(headers).find(
    ([name, value]) =>
      name.toLocaleLowerCase() === "fen" &&
      typeof value === "string" &&
      value.trim() !== "",
  );

  return fenEntry ? fenEntry[1].trim() : DEFAULT_POSITION;
}

export function replayMoves(
  moves,
  options = {},
) {
  const safeMoves = requireMoves(moves);
  const throughPly = requirePly(
    options.throughPly ?? safeMoves.length,
    safeMoves.length,
  );
  const chess = createChessAtInitialFen(
    options.initialFen ?? DEFAULT_POSITION,
  );

  for (let index = 0; index < throughPly; index += 1) {
    const ply = index + 1;
    const san = moveInput(safeMoves[index], ply);

    try {
      chess.move(san);
    } catch (error) {
      throw new PositionServiceError(
        "illegal-move",
        `Potez '${san}' nije legalan na plyju ${ply}.`,
        { cause: error, ply },
      );
    }
  }

  return chess;
}

export function getFenAtPly(moves, ply, options = {}) {
  return replayMoves(moves, {
    ...options,
    throughPly: ply,
  }).fen();
}

export function createPositionTimeline(moves, options = {}) {
  const safeMoves = requireMoves(moves);
  const chess = createChessAtInitialFen(
    options.initialFen ?? DEFAULT_POSITION,
  );
  const timeline = [
    {
      ply: 0,
      san: null,
      fen: chess.fen(),
    },
  ];

  for (let index = 0; index < safeMoves.length; index += 1) {
    const ply = index + 1;
    const san = moveInput(safeMoves[index], ply);

    try {
      chess.move(san);
    } catch (error) {
      throw new PositionServiceError(
        "illegal-move",
        `Potez '${san}' nije legalan na plyju ${ply}.`,
        { cause: error, ply },
      );
    }

    timeline.push({
      ply,
      san,
      fen: chess.fen(),
    });
  }

  return timeline;
}

export function createLineFromPgn(pgn) {
  if (typeof pgn !== "string" || pgn.trim() === "") {
    throw new TypeError("PGN mora biti neprazan string.");
  }

  const game = new Chess();

  try {
    game.loadPgn(pgn);
  } catch (error) {
    throw new PositionServiceError(
      "invalid-pgn",
      "PGN se ne moze pretvoriti u liniju pozicija.",
      { cause: error },
    );
  }

  const headers = game.header();

  return {
    headers: { ...headers },
    initialFen: getInitialFenFromHeaders(headers),
    moves: game.history({ verbose: true }),
  };
}

export function branchLine(
  moves,
  branchPly,
  nextMove,
  options = {},
) {
  const safeMoves = requireMoves(moves);
  requirePly(branchPly, safeMoves.length);
  const chess = replayMoves(safeMoves, {
    initialFen: options.initialFen ?? DEFAULT_POSITION,
    throughPly: branchPly,
  });

  try {
    chess.move(nextMove);
  } catch (error) {
    throw new PositionServiceError(
      "illegal-branch-move",
      `Novi potez nije legalan nakon plyja ${branchPly}.`,
      { cause: error, ply: branchPly + 1 },
    );
  }

  return {
    initialFen: options.initialFen ?? DEFAULT_POSITION,
    moves: chess.history({ verbose: true }),
    fen: chess.fen(),
  };
}

