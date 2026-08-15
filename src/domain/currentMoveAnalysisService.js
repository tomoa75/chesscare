export function selectCurrentMoveAnalyses(moveAnalyses, analysisRuns) {
  const runsById = new Map(analysisRuns.map((run) => [run.id, run]));
  const selected = new Map();

  const rank = (move) => {
    const run = runsById.get(move.analysisRunId);
    return {
      completed: run?.status === "completed" ? 1 : 0,
      completedAt: run?.completedAt || "",
      createdAt: run?.createdAt || "",
      runId: move.analysisRunId,
      moveId: move.id,
    };
  };
  const isNewer = (candidate, current) => {
    const left = rank(candidate);
    const right = rank(current);

    return (
      left.completed > right.completed ||
      (left.completed === right.completed &&
        (left.completedAt > right.completedAt ||
          (left.completedAt === right.completedAt &&
            (left.createdAt > right.createdAt ||
              (left.createdAt === right.createdAt &&
                (left.runId > right.runId ||
                  (left.runId === right.runId &&
                    left.moveId > right.moveId)))))))
    );
  };

  for (const move of moveAnalyses) {
    const key = `${move.playerId || ""}:${move.gameId}:${move.ply}`;
    const current = selected.get(key);
    if (!current || isNewer(move, current)) selected.set(key, move);
  }

  return [...selected.values()];
}
