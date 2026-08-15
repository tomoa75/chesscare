import { Chess } from "chess.js";
import { createMoveAnalysis } from "./analysis.js";
import { GAME_PHASES, GAME_RESULTS } from "./constants.js";
import { createPositionCacheKey } from "./analysisJobService.js";
import {
  createLineFromPgn,
  createPositionTimeline,
} from "./positionService.js";
import { playerMatchesAlias } from "./player.js";
import { uciMoveToSan } from "./stockfishService.js";

const CLASSIFICATIONS = ["good", "inaccuracy", "mistake", "blunder"];
const WEAK_CLASSIFICATIONS = ["inaccuracy", "mistake", "blunder"];
const CLASSIFICATION_PRIORITY = {
  inaccuracy: 1,
  mistake: 2,
  blunder: 3,
};
const MATERIAL_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const MATE_BASE_SCORE = 100000;
const MAX_MATE_RELATED_CENTIPAWN_LOSS = 300;

function meaningfulName(value) {
  return typeof value === "string" && value.trim() && value.trim() !== "?";
}

function headerAliasMatches(player, value) {
  return meaningfulName(value) && playerMatchesAlias(player, value);
}

export function resolvePlayerColorInGame(game, player) {
  const whitePlayerId = game?.players?.whitePlayerId || null;
  const blackPlayerId = game?.players?.blackPlayerId || null;
  const whiteLinked = whitePlayerId === player?.id;
  const blackLinked = blackPlayerId === player?.id;
  const whiteAlias =
    !whitePlayerId && headerAliasMatches(player, game?.headers?.White);
  const blackAlias =
    !blackPlayerId && headerAliasMatches(player, game?.headers?.Black);
  const whiteMatch = whiteLinked || whiteAlias;
  const blackMatch = blackLinked || blackAlias;

  if (whiteMatch && blackMatch) {
    return {
      status: "ambiguous",
      color: null,
      method: null,
    };
  }

  if (!whiteMatch && !blackMatch) {
    return {
      status: "unmatched",
      color: null,
      method: null,
    };
  }

  const color = whiteMatch ? "white" : "black";
  const linked = color === "white" ? whiteLinked : blackLinked;

  return {
    status: "matched",
    color,
    method: linked ? "player-id" : "confirmed-alias",
  };
}

function materialValue(chess) {
  return chess.board().reduce(
    (sum, row) =>
      sum +
      row.reduce((rowSum, piece) => {
        if (!piece || piece.type === "k") return rowSum;
        return rowSum + MATERIAL_VALUES[piece.type];
      }, 0),
    0,
  );
}

function hasQueens(chess) {
  return chess.board().some((row) =>
    row.some((piece) => piece?.type === "q"),
  );
}

export function classifyGamePhase(fen, ply) {
  const chess = new Chess(fen);
  const fenFullMove = Number(fen.split(" ")[5]);
  const fullMove = Number.isInteger(fenFullMove)
    ? fenFullMove
    : Math.floor((ply - 1) / 2) + 1;

  if (fullMove <= 10) return "opening";
  if (fullMove >= 35 || (!hasQueens(chess) && materialValue(chess) <= 24)) {
    return "endgame";
  }

  return "middlegame";
}

function openingName(headers = {}) {
  const eco = meaningfulName(headers.ECO) ? `${headers.ECO.trim()} ` : "";
  const name = meaningfulName(headers.Opening)
    ? headers.Opening.trim()
    : meaningfulName(headers.Variant)
      ? headers.Variant.trim()
      : "Unknown opening";
  const variation = meaningfulName(headers.Variation)
    ? `: ${headers.Variation.trim()}`
    : "";

  return `${eco}${name}${variation}`;
}

function moveToUci(move) {
  return `${move.from}${move.to}${move.promotion || ""}`;
}

function contextWarning(code, game, message) {
  return {
    code,
    gameId: game?.id || null,
    message,
  };
}

export function extractPlayerMoveContexts(games, player) {
  if (!Array.isArray(games)) {
    throw new TypeError("Partije moraju biti polje.");
  }
  if (!player?.id || !Array.isArray(player.aliases)) {
    throw new TypeError("Profil igraca nije valjan.");
  }

  const contexts = [];
  const warnings = [];
  const gameMatches = [];

  for (const game of games) {
    const identity = resolvePlayerColorInGame(game, player);

    if (identity.status === "unmatched") continue;
    if (identity.status === "ambiguous") {
      warnings.push(
        contextWarning(
          "ambiguous-player-color",
          game,
          "Profil igraca odgovara objema bojama; partija je preskocena.",
        ),
      );
      continue;
    }

    try {
      const line = createLineFromPgn(game.rawPgn);
      const timeline = createPositionTimeline(line.moves, {
        initialFen: line.initialFen,
      });
      const opening = openingName(game.headers);
      const result = GAME_RESULTS.includes(game.result) ? game.result : "*";
      let movesAdded = 0;

      line.moves.forEach((move, index) => {
        const ply = index + 1;
        const before = timeline[index];
        const after = timeline[index + 1];
        const moverColor =
          new Chess(before.fen).turn() === "w" ? "white" : "black";

        if (moverColor !== identity.color) return;

        contexts.push({
          id: `${game.id}-${ply}`,
          gameId: game.id,
          gameTitle: game.title,
          playerId: player.id,
          color: moverColor,
          identityMethod: identity.method,
          ply,
          moveNumber: Number(before.fen.split(" ")[5]),
          phase: classifyGamePhase(before.fen, ply),
          opening,
          result,
          beforeFen: before.fen,
          afterFen: after.fen,
          playedMove: {
            san: move.san,
            uci: moveToUci(move),
          },
        });
        movesAdded += 1;
      });

      gameMatches.push({
        gameId: game.id,
        color: identity.color,
        method: identity.method,
        moves: movesAdded,
      });
    } catch (error) {
      warnings.push(
        contextWarning(
          "invalid-game-pgn",
          game,
          `Partija se ne moze reproducirati: ${error.message}`,
        ),
      );
    }
  }

  return { contexts, gameMatches, warnings };
}

function numericEvaluation(score) {
  if (score.type === "cp") return score.value;

  const direction = score.value >= 0 ? 1 : -1;
  const distance = Math.min(Math.abs(score.value), 100);
  return direction * (MATE_BASE_SCORE - distance);
}

export function classifyCentipawnLoss(loss) {
  if (loss >= 200) return "blunder";
  if (loss >= 100) return "mistake";
  if (loss >= 50) return "inaccuracy";
  return "good";
}

export function calculateCentipawnLoss(beforeScore, afterScore, color) {
  const multiplier = color === "white" ? 1 : -1;
  const before = numericEvaluation(beforeScore) * multiplier;
  const after = numericEvaluation(afterScore) * multiplier;
  const loss = Math.max(0, before - after);

  if (beforeScore.type === "mate" || afterScore.type === "mate") {
    return Math.min(loss, MAX_MATE_RELATED_CENTIPAWN_LOSS);
  }

  return loss;
}

function sameUciMove(left, right) {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.trim().toLowerCase() === right.trim().toLowerCase()
  );
}

function normalizeMoveAnalysis(move) {
  const playedBestMove = sameUciMove(
    move.playedMove?.uci,
    move.bestMove?.uci,
  );
  const mateRelated =
    move.beforeEvaluation?.type === "mate" ||
    move.afterEvaluation?.type === "mate";

  if (!playedBestMove && !mateRelated) {
    return move;
  }

  const centipawnLoss = playedBestMove
    ? 0
    : calculateCentipawnLoss(
        move.beforeEvaluation,
        move.afterEvaluation,
        move.color,
      );

  return {
    ...move,
    centipawnLoss,
    classification: classifyCentipawnLoss(centipawnLoss),
  };
}

function mainLine(evaluation) {
  return [...evaluation.lines].sort(
    (left, right) => left.multiPv - right.multiPv,
  )[0];
}

export async function buildPersonalizedMoveAnalyses(options) {
  const {
    games,
    player,
    positionEvaluations,
    engine,
    settings,
    analysisRunId,
  } = options;

  if (!Array.isArray(positionEvaluations)) {
    throw new TypeError("Cache evaluacije moraju biti polje.");
  }

  const extracted = extractPlayerMoveContexts(games, player);
  const byCacheKey = new Map(
    positionEvaluations.map((evaluation) => [
      evaluation.cacheKey,
      evaluation,
    ]),
  );
  const moveAnalyses = [];
  const warnings = [...extracted.warnings];

  for (const context of extracted.contexts) {
    const beforeKey = await createPositionCacheKey({
      fen: context.beforeFen,
      engine,
      settings,
    });
    const afterKey = await createPositionCacheKey({
      fen: context.afterFen,
      engine,
      settings,
    });
    const beforeEvaluation = byCacheKey.get(beforeKey);
    const afterEvaluation = byCacheKey.get(afterKey);

    if (!beforeEvaluation || !afterEvaluation) {
      warnings.push({
        code: "missing-position-evaluation",
        gameId: context.gameId,
        ply: context.ply,
        missing: [
          ...(!beforeEvaluation ? ["before"] : []),
          ...(!afterEvaluation ? ["after"] : []),
        ],
        message: "Nedostaje cache evaluacija prije ili nakon poteza.",
      });
      continue;
    }

    const beforeLine = mainLine(beforeEvaluation);
    const afterLine = mainLine(afterEvaluation);
    const bestMoveUci = beforeLine.bestMove;
    const loss = sameUciMove(context.playedMove.uci, bestMoveUci)
      ? 0
      : calculateCentipawnLoss(
          beforeLine.score,
          afterLine.score,
          context.color,
        );

    moveAnalyses.push(
      createMoveAnalysis({
        id: `move-analysis-${analysisRunId}-${context.gameId}-${context.ply}`,
        analysisRunId,
        gameId: context.gameId,
        playerId: player.id,
        ply: context.ply,
        color: context.color,
        phase: context.phase,
        beforeFen: context.beforeFen,
        afterFen: context.afterFen,
        playedMove: context.playedMove,
        bestMove: bestMoveUci
          ? {
              uci: bestMoveUci,
              san: uciMoveToSan(context.beforeFen, bestMoveUci),
            }
          : null,
        beforeEvaluation: beforeLine.score,
        afterEvaluation: afterLine.score,
        centipawnLoss: loss,
        classification: classifyCentipawnLoss(loss),
      }),
    );
  }

  return {
    moveAnalyses,
    contexts: extracted.contexts,
    gameMatches: extracted.gameMatches,
    warnings,
  };
}

function emptyCounts() {
  return Object.fromEntries(
    CLASSIFICATIONS.map((classification) => [classification, 0]),
  );
}

function summarizeMoves(moves) {
  const classifications = emptyCounts();
  let totalLoss = 0;

  for (const move of moves) {
    totalLoss += move.centipawnLoss;
    classifications[move.classification] += 1;
  }

  const sampleSize = moves.length;
  const averageLoss = sampleSize ? totalLoss / sampleSize : 0;

  return {
    sampleSize,
    gameCount: new Set(moves.map((move) => move.gameId)).size,
    totalLoss,
    averageLoss,
    accuracy: sampleSize
      ? Math.max(0, Math.min(100, 100 * Math.exp(-averageLoss / 220)))
      : 0,
    classifications,
    confidence:
      sampleSize >= 30 ? "high" : sampleSize >= 10 ? "medium" : "low",
  };
}

function groupMoves(moves, keys, selector) {
  return keys.map((key) => ({
    key,
    ...summarizeMoves(moves.filter((move) => selector(move) === key)),
  }));
}

function priorityEvidence(move, gamesById) {
  const game = gamesById.get(move.gameId);

  return {
    moveAnalysisId: move.id,
    gameId: move.gameId,
    gameTitle: game?.title || move.gameId,
    gameFound: Boolean(game),
    ply: move.ply,
    moveNumber: Math.ceil(move.ply / 2),
    color: move.color,
    phase: move.phase,
    beforeFen: move.beforeFen,
    playedMove: { ...move.playedMove },
    bestMove: move.bestMove ? { ...move.bestMove } : null,
    centipawnLoss: move.centipawnLoss,
    classification: move.classification,
  };
}

function buildImprovementPriorities(
  moves,
  gamesById,
  openingByGame,
) {
  const weakMoves = moves.filter((move) =>
    WEAK_CLASSIFICATIONS.includes(move.classification),
  );
  const dimensions = [
    ["phase", (move) => move.phase],
    [
      "opening",
      (move) => openingByGame.get(move.gameId) || "Unknown opening",
    ],
    ["color", (move) => move.color],
  ];
  const candidates = [];

  for (const [dimension, keyForMove] of dimensions) {
    const grouped = new Map();

    for (const move of weakMoves) {
      const key = keyForMove(move);
      const groupKey = `${key}:${move.classification}`;
      const group = grouped.get(groupKey) || {
        dimension,
        key,
        classification: move.classification,
        moves: [],
      };
      group.moves.push(move);
      grouped.set(groupKey, group);
    }

    for (const group of grouped.values()) {
      const summary = summarizeMoves(group.moves);
      const recurring = summary.sampleSize >= 2;
      candidates.push({
        id: `${group.dimension}:${group.key}:${group.classification}`,
        dimension: group.dimension,
        key: group.key,
        classification: group.classification,
        occurrences: summary.sampleSize,
        gameCount: summary.gameCount,
        averageLoss: summary.averageLoss,
        recurring,
        priorityScore:
          (recurring ? 100000 : 0) +
          CLASSIFICATION_PRIORITY[group.classification] * 10000 +
          summary.sampleSize * 100 +
          summary.averageLoss,
        evidence: [...group.moves]
          .sort(
            (left, right) =>
              right.centipawnLoss - left.centipawnLoss ||
              left.id.localeCompare(right.id),
          )
          .slice(0, 3)
          .map((move) => priorityEvidence(move, gamesById)),
      });
    }
  }

  return candidates
    .sort(
      (left, right) =>
        right.priorityScore - left.priorityScore ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 3)
    .map((priority, index) => ({
      ...priority,
      rank: index + 1,
    }));
}

export function parsePgnPlayedDate(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})[.-](\d{2})[.-](\d{2})$/);
  if (!match) return null;

  const [, year, month, day] = match;
  const normalized = `${year}-${month}-${day}`;
  const date = new Date(`${normalized}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return normalized;
}

function reportBoundary(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = parsePgnPlayedDate(value);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${fieldName} mora biti valjani datum YYYY-MM-DD.`);
  }
  return normalized;
}

function reportPeriod(value = {}) {
  const from = reportBoundary(value.from, "Pocetak razdoblja");
  const to = reportBoundary(value.to, "Kraj razdoblja");
  if (from && to && from > to) {
    throw new TypeError("Pocetak razdoblja ne moze biti nakon kraja.");
  }
  return { from, to, active: Boolean(from || to) };
}

export function buildPersonalizedPlayerReport(options) {
  const { player, moveAnalyses, games } = options;
  if (!Array.isArray(moveAnalyses) || !Array.isArray(games)) {
    throw new TypeError("Potezi i partije moraju biti polja.");
  }

  const period = reportPeriod(options.period);
  const allPlayerMoves = moveAnalyses
    .filter((move) => move.playerId === player.id)
    .map(normalizeMoveAnalysis);
  const gamesById = new Map(games.map((game) => [game.id, game]));
  const playedDateByGame = new Map(
    games.map((game) => [
      game.id,
      parsePgnPlayedDate(game.headers.Date),
    ]),
  );
  const playerMoves = allPlayerMoves.filter((move) => {
    if (!period.active) return true;
    const date = playedDateByGame.get(move.gameId);
    if (!date) return false;
    return (!period.from || date >= period.from) &&
      (!period.to || date <= period.to);
  });
  const openingByGame = new Map(
    games.map((game) => [game.id, openingName(game.headers)]),
  );
  const resultByGame = new Map(
    games.map((game) => [game.id, game.result || "*"]),
  );
  const byPhase = groupMoves(
    playerMoves,
    GAME_PHASES,
    (move) => move.phase,
  );
  const phasesWithMoves = byPhase.filter((phase) => phase.sampleSize > 0);
  const weakestPhase = [...phasesWithMoves].sort(
    (left, right) => right.averageLoss - left.averageLoss,
  )[0];
  const openingKeys = [
    ...new Set(
      playerMoves.map(
        (move) => openingByGame.get(move.gameId) || "Unknown opening",
      ),
    ),
  ];
  const periodKeys = [
    ...new Set(
      playerMoves.map((move) => {
        const date = playedDateByGame.get(move.gameId);
        return date ? date.slice(0, 4) : "unknown";
      }),
    ),
  ].sort((left, right) => {
    if (left === "unknown") return 1;
    if (right === "unknown") return -1;
    return left.localeCompare(right);
  });
  const datedGameDates = [
    ...new Set(
      allPlayerMoves
        .map((move) => playedDateByGame.get(move.gameId))
        .filter(Boolean),
    ),
  ].sort();
  const undatedMoves = allPlayerMoves.filter(
    (move) => !playedDateByGame.get(move.gameId),
  ).length;
  const gameKeys = [...new Set(playerMoves.map((move) => move.gameId))];

  return {
    player: {
      id: player.id,
      displayName: player.displayName,
    },
    gamesAnalyzed: new Set(
      playerMoves
        .map((move) => move.gameId)
        .filter((gameId) => gamesById.has(gameId)),
    ).size,
    overall: summarizeMoves(playerMoves),
    byGame: gameKeys
      .map((gameId) => {
        const game = gamesById.get(gameId);
        return {
          gameId,
          title: game?.title || gameId,
          date: playedDateByGame.get(gameId),
          result: game?.result || "*",
          gameFound: Boolean(game),
          ...summarizeMoves(
            playerMoves.filter((move) => move.gameId === gameId),
          ),
        };
      })
      .sort(
        (left, right) =>
          (right.date || "").localeCompare(left.date || "") ||
          left.title.localeCompare(right.title),
      ),
    byColor: groupMoves(playerMoves, ["white", "black"], (move) => move.color),
    byPhase,
    byResult: groupMoves(
      playerMoves,
      GAME_RESULTS,
      (move) => resultByGame.get(move.gameId) || "*",
    ),
    byOpening: groupMoves(
      playerMoves,
      openingKeys,
      (move) => openingByGame.get(move.gameId) || "Unknown opening",
    ).sort(
      (left, right) =>
        right.sampleSize - left.sampleSize ||
        left.key.localeCompare(right.key),
    ),
    byPeriod: groupMoves(
      playerMoves,
      periodKeys,
      (move) => playedDateByGame.get(move.gameId)?.slice(0, 4) || "unknown",
    ),
    priorities: buildImprovementPriorities(
      playerMoves,
      gamesById,
      openingByGame,
    ),
    period: {
      from: period.from,
      to: period.to,
      active: period.active,
      earliestAvailable: datedGameDates[0] || null,
      latestAvailable:
        datedGameDates[datedGameDates.length - 1] || null,
      undatedMoves,
      excludedUndatedMoves: period.active ? undatedMoves : 0,
      excludedOutsideRangeMoves: period.active
        ? allPlayerMoves.filter((move) => {
            const date = playedDateByGame.get(move.gameId);
            return (
              date &&
              ((period.from && date < period.from) ||
                (period.to && date > period.to))
            );
          }).length
        : 0,
    },
    weakestPhase: weakestPhase
      ? {
          phase: weakestPhase.key,
          averageLoss: weakestPhase.averageLoss,
          sampleSize: weakestPhase.sampleSize,
        }
      : null,
  };
}
