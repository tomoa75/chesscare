import { buildPersonalizedPlayerReport } from "./playerAnalysisService.js";
import { selectCurrentMoveAnalyses } from "./currentMoveAnalysisService.js";

function uniqueCount(values) {
  return new Set(values).size;
}

function playerOption(player, moveAnalyses) {
  const moves = moveAnalyses.filter((move) => move.playerId === player.id);

  return {
    id: player.id,
    displayName: player.displayName,
    aliases: [...player.aliases],
    analyzedMoves: moves.length,
    analyzedGames: uniqueCount(moves.map((move) => move.gameId)),
  };
}

function analysisSources(playerMoves, analysisRuns) {
  const runsById = new Map(analysisRuns.map((run) => [run.id, run]));
  const grouped = new Map();

  for (const move of playerMoves) {
    const current = grouped.get(move.analysisRunId) || {
      runId: move.analysisRunId,
      moveCount: 0,
      gameIds: new Set(),
    };
    current.moveCount += 1;
    current.gameIds.add(move.gameId);
    grouped.set(move.analysisRunId, current);
  }

  return [...grouped.values()]
    .map((group) => {
      const run = runsById.get(group.runId);

      return {
        runId: group.runId,
        found: Boolean(run),
        moveCount: group.moveCount,
        gameCount: group.gameIds.size,
        engine: run ? { ...run.engine } : null,
        settings: run
          ? {
              ...run.settings,
              uciOptions: { ...run.settings.uciOptions },
            }
          : null,
        completedAt: run?.completedAt || null,
      };
    })
    .sort(
      (left, right) =>
        (right.completedAt || "").localeCompare(left.completedAt || "") ||
        left.runId.localeCompare(right.runId),
    );
}

export async function loadPersonalizedDashboard(options) {
  if (!options?.repository?.readSnapshot) {
    throw new TypeError("Repozitorij mora podrzavati readSnapshot.");
  }

  const snapshot = await options.repository.readSnapshot();
  const currentMoveAnalyses = selectCurrentMoveAnalyses(
    snapshot.moveAnalyses,
    snapshot.analysisRuns,
  );
  const players = snapshot.players
    .map((player) => playerOption(player, currentMoveAnalyses))
    .sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    );
  const playerId = options.playerId || "";
  const player = playerId
    ? snapshot.players.find((candidate) => candidate.id === playerId)
    : null;

  if (playerId && !player) {
    throw new TypeError(`Profil igraca '${playerId}' ne postoji.`);
  }

  const rawPlayerMoves = player
    ? snapshot.moveAnalyses.filter((move) => move.playerId === player.id)
    : [];
  const playerMoves = player
    ? currentMoveAnalyses.filter((move) => move.playerId === player.id)
    : [];
  const knownGameIds = new Set(snapshot.games.map((game) => game.id));
  const knownRunIds = new Set(
    snapshot.analysisRuns.map((run) => run.id),
  );
  const warnings = player
    ? [
        ...new Set(
          playerMoves
            .filter((move) => !knownGameIds.has(move.gameId))
            .map((move) => move.gameId),
        ),
      ].map((gameId) => ({
        code: "missing-game",
        referenceId: gameId,
        message: `Partija '${gameId}' povezana s rezultatom vise ne postoji.`,
      }))
    : [];

  if (player) {
    warnings.push(
      ...[
        ...new Set(
          playerMoves
            .filter((move) => !knownRunIds.has(move.analysisRunId))
            .map((move) => move.analysisRunId),
        ),
      ].map((runId) => ({
        code: "missing-analysis-run",
        referenceId: runId,
        message: `Analiticki posao '${runId}' povezan s rezultatom vise ne postoji.`,
      })),
    );
  }

  return {
    players,
    selectedPlayer: player
      ? {
          id: player.id,
          displayName: player.displayName,
          aliases: [...player.aliases],
        }
      : null,
    report: player
      ? buildPersonalizedPlayerReport({
          player,
          moveAnalyses: currentMoveAnalyses,
          games: snapshot.games,
          period: options.period,
        })
      : null,
    sources: player
      ? analysisSources(playerMoves, snapshot.analysisRuns)
      : [],
    warnings,
    summary: {
      totalPlayers: players.length,
      analyzedPlayers: players.filter((item) => item.analyzedMoves > 0)
        .length,
      totalMoveAnalyses: snapshot.moveAnalyses.length,
      selectedMoveAnalyses: playerMoves.length,
      supersededMoveAnalyses: rawPlayerMoves.length - playerMoves.length,
    },
  };
}
