import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmAnalysisJobCreation,
  confirmPersonalizedMaterialization,
  createAnalysisJobPreview,
  createLegacyMigrationPreview,
  createLocalStorageDomainRepository,
  createPersonalizedMaterializationPreview,
  executeLegacyMigration,
  executeStoredAnalysisJob,
  LEGACY_GAMES_STORAGE_KEY,
  loadPersonalizedDashboard,
} from "./index.js";

const ENGINE = { name: "Stockfish", version: "18" };
const SETTINGS = {
  depth: 8,
  multiPv: 1,
  uciOptions: { Hash: 16 },
};
const INITIAL_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function storageWith(records) {
  const values = new Map([
    [LEGACY_GAMES_STORAGE_KEY, JSON.stringify(records)],
  ]);

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function legacyRecords() {
  return [
    {
      id: "legacy-mvp-1",
      title: "Ana - Iva",
      pgn: [
        '[Event "MVP 1"]',
        '[White "Ana Saric"]',
        '[Black "Iva"]',
        '[Result "1-0"]',
        '[Opening "Open Game"]',
        "",
        "1. e4 e5 1-0",
      ].join("\n"),
    },
    {
      id: "legacy-mvp-2",
      title: "Ana - Marko",
      pgn: [
        '[Event "MVP 2"]',
        '[White "Ana Saric"]',
        '[Black "Marko"]',
        '[Result "1-0"]',
        '[Opening "Open Game"]',
        "",
        "1. c4 d5 1-0",
      ].join("\n"),
    },
  ];
}

class MvpStockfishClient {
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
            value: initial ? 100 : -100,
            perspective: "white",
          },
          pv: initial ? ["d2d4"] : [],
        },
      ],
    };
  }
}

test("MVP tok od vise PGN partija daje tri prioriteta s dokazima", async () => {
  const records = legacyRecords();
  const storage = storageWith(records);
  const migrationPreview = await createLegacyMigrationPreview({
    legacyRecords: records,
    storage,
  });
  await executeLegacyMigration({
    legacyRecords: records,
    storage,
    previewToken: migrationPreview.token,
  });

  const repository = createLocalStorageDomainRepository(storage);
  const migrated = await repository.readSnapshot();
  const ana = migrated.players.find(
    (player) => player.displayName === "Ana Saric",
  );

  assert.ok(ana);
  assert.equal(migrated.games.length, 2);
  assert.equal(
    migrated.games.every(
      (game) => game.players.whitePlayerId === ana.id,
    ),
    true,
  );

  const creationPreview = await createAnalysisJobPreview({
    repository,
    gameIds: migrated.games.map((game) => game.id),
    engine: ENGINE,
    settings: SETTINGS,
  });
  const creation = await confirmAnalysisJobCreation({
    repository,
    gameIds: migrated.games.map((game) => game.id),
    engine: ENGINE,
    settings: SETTINGS,
    previewToken: creationPreview.token,
  });
  const execution = await executeStoredAnalysisJob({
    repository,
    stockfishClient: new MvpStockfishClient(),
    runId: creation.run.id,
  });

  assert.equal(execution.run.status, "completed");
  assert.equal(
    execution.run.progress.completed,
    execution.run.progress.total,
  );

  const materializationPreview =
    await createPersonalizedMaterializationPreview({
      repository,
      runId: creation.run.id,
      playerId: ana.id,
    });
  const materialized = await confirmPersonalizedMaterialization({
    repository,
    runId: creation.run.id,
    playerId: ana.id,
    previewToken: materializationPreview.token,
  });

  assert.equal(materialized.added, 2);

  const dashboard = await loadPersonalizedDashboard({
    repository,
    playerId: ana.id,
  });

  assert.equal(dashboard.report.overall.sampleSize, 2);
  assert.equal(dashboard.report.priorities.length, 3);
  assert.equal(
    dashboard.report.priorities.every(
      (priority) =>
        priority.recurring &&
        priority.occurrences === 2 &&
        priority.gameCount === 2 &&
        priority.evidence.length === 2,
    ),
    true,
  );
  assert.equal(
    dashboard.report.priorities.every((priority) =>
      priority.evidence.every(
        (evidence) =>
          evidence.gameFound &&
          evidence.beforeFen.includes(" w ") &&
          evidence.playedMove.san &&
          evidence.bestMove?.san,
      ),
    ),
    true,
  );
});
