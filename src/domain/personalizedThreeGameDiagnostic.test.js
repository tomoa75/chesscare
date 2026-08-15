import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptLegacyGameRecords,
  confirmAnalysisJobCreation,
  confirmPersonalizedMaterialization,
  createAnalysisJobPreview,
  createMemoryDomainRepository,
  createPersonalizedMaterializationPreview,
  executeStoredAnalysisJob,
  importLegacyAdapterResult,
  loadPersonalizedDashboard,
  parsePgnCollection,
  resolvePlayerColorInGame,
} from "./index.js";
import { createPlayer } from "./player.js";

const ENGINE = { name: "Stockfish", version: "18" };
const SETTINGS = {
  depth: 8,
  multiPv: 1,
  uciOptions: { Hash: 16 },
};
const INITIAL_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function pgn(event, white, black, moves) {
  return [
    `[Event "${event}"]`,
    `[White "${white}"]`,
    `[Black "${black}"]`,
    '[Result "*"]',
    "",
    `${moves} *`,
  ].join("\n");
}

class DiagnosticStockfishClient {
  async initialize() {}

  async analyzeFen(fen) {
    const initial = fen === INITIAL_FEN;

    return {
      bestMove: initial ? "d2d4" : null,
      lines: [
        {
          multiPv: 1,
          depth: SETTINGS.depth,
          whiteScore: {
            type: "cp",
            value: initial ? 80 : 0,
            perspective: "white",
          },
          pv: initial ? ["d2d4"] : [],
        },
      ],
    };
  }
}

test("dijagnostika prati tri partije do personaliziranog izvjestaja", async () => {
  const sourcePgns = [
    pgn("Prva", "Ana Saric", "Iva", "1. e4 e5"),
    pgn("Druga", "A. Saric", "Marko", "1. d4 d5"),
    pgn("Treca", "Ivan", "Petar", "1. c4 c5"),
  ];
  const parsed = parsePgnCollection(sourcePgns.join("\n\n"));
  const records = parsed.map((game, index) => ({
    id: `diagnostic-game-${index + 1}`,
    title: game.header().Event,
    pgn: game.pgn(),
  }));
  const adapted = await adaptLegacyGameRecords(records);
  const repository = createMemoryDomainRepository();

  await importLegacyAdapterResult(repository, adapted);

  const snapshot = await repository.readSnapshot();
  const anaIndex = snapshot.players.findIndex(
    (player) => player.displayName === "Ana Saric",
  );
  snapshot.players[anaIndex] = createPlayer({
    ...snapshot.players[anaIndex],
    aliases: [...snapshot.players[anaIndex].aliases, "A. Saric"],
  });
  await repository.replaceSnapshot(snapshot);

  const linked = await repository.readSnapshot();
  const ana = linked.players.find(
    (player) => player.displayName === "Ana Saric",
  );
  const identities = new Map(
    linked.games.map((game) => [
      game.id,
      resolvePlayerColorInGame(game, ana),
    ]),
  );
  const creationPreview = await createAnalysisJobPreview({
    repository,
    gameIds: linked.games.map((game) => game.id),
    engine: ENGINE,
    settings: SETTINGS,
  });
  const creation = await confirmAnalysisJobCreation({
    repository,
    gameIds: linked.games.map((game) => game.id),
    engine: ENGINE,
    settings: SETTINGS,
    previewToken: creationPreview.token,
  });
  const execution = await executeStoredAnalysisJob({
    repository,
    stockfishClient: new DiagnosticStockfishClient(),
    runId: creation.run.id,
  });
  const materializationPreview =
    await createPersonalizedMaterializationPreview({
      repository,
      runId: creation.run.id,
      playerId: ana.id,
    });
  await confirmPersonalizedMaterialization({
    repository,
    runId: creation.run.id,
    playerId: ana.id,
    previewToken: materializationPreview.token,
  });

  const finalSnapshot = await repository.readSnapshot();
  const dashboard = await loadPersonalizedDashboard({
    repository,
    playerId: ana.id,
  });
  const duplicateIds = new Set(
    adapted.duplicateGroups.flatMap((group) => group.duplicateGameIds),
  );
  const playersById = new Map(
    finalSnapshot.players.map((player) => [player.id, player.displayName]),
  );
  const includedGameIds = new Set(
    finalSnapshot.moveAnalyses
      .filter((move) => move.playerId === ana.id)
      .map((move) => move.gameId),
  );
  const diagnostics = finalSnapshot.games.map((game) => {
    const identity = identities.get(game.id);
    const included = includedGameIds.has(game.id);
    const profileName = (playerId) =>
      playerId ? playersById.get(playerId) || playerId : null;

    return {
      title: game.title,
      White: game.headers.White,
      Black: game.headers.Black,
      fingerprint: game.fingerprint,
      linkedProfiles: {
        white: profileName(game.players.whitePlayerId),
        black: profileName(game.players.blackPlayerId),
      },
      duplicate: duplicateIds.has(game.id),
      analysisStatus: execution.run.gameIds.includes(game.id)
        ? execution.run.status
        : "not-selected",
      includedInStatistics: included,
      reason: included
        ? "included: saved MoveAnalysis exists for selected player"
        : game.headers.White === "A. Saric"
          ? "excluded: linked playerId belongs to another profile, so confirmed alias is not checked"
          : identity.status === "unmatched"
            ? "excluded: selected player is not linked to either color"
            : "excluded: no saved MoveAnalysis for selected player",
    };
  });

  console.table(
    diagnostics.map((item) => ({
      title: item.title,
      White: item.White,
      Black: item.Black,
      fingerprint: item.fingerprint,
      linkedProfiles: `${item.linkedProfiles.white} / ${item.linkedProfiles.black}`,
      duplicate: item.duplicate,
      analysisStatus: item.analysisStatus,
      included: item.includedInStatistics,
      reason: item.reason,
    })),
  );

  assert.equal(parsed.length, 3);
  assert.equal(adapted.games.length, 3);
  assert.equal(adapted.duplicateGroups.length, 0);
  assert.equal(execution.run.status, "completed");
  assert.deepEqual(
    diagnostics.map((item) => item.includedInStatistics),
    [true, false, false],
  );
  assert.equal(identities.get("diagnostic-game-2").status, "unmatched");
  assert.equal(materializationPreview.summary.gamesInRun, 3);
  assert.equal(materializationPreview.summary.gamesMatched, 1);
  assert.equal(dashboard.report.gamesAnalyzed, 1);
});
