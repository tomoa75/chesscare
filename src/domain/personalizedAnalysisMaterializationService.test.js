import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmPersonalizedMaterialization,
  createAnalysisRun,
  createGame,
  createMemoryDomainRepository,
  createPersonalizedMaterializationPreview,
  createPlayer,
  createPositionCacheKey,
  createPositionEvaluation,
  extractPlayerMoveContexts,
} from "./index.js";

const NOW = "2026-07-26T12:00:00.000Z";
const ENGINE = { name: "Stockfish", version: "18" };
const SETTINGS = { depth: 8, multiPv: 1, uciOptions: { Hash: 16 } };
const PGN = [
  '[Event "Test"]',
  '[White "Ana Saric"]',
  '[Black "Marko"]',
  '[Result "1-0"]',
  "",
  "1. e4 1-0",
].join("\n");

function player(id = "player-ana", displayName = "Ana Saric") {
  return createPlayer(
    { id, displayName, aliases: [displayName] },
    { now: NOW },
  );
}

function game() {
  return createGame(
    {
      id: "game-1",
      title: "Test partija",
      rawPgn: PGN,
      headers: { White: "Ana Saric", Black: "Marko", Result: "1-0" },
      players: { whitePlayerId: "player-ana" },
      result: "1-0",
      source: { kind: "migration" },
      fingerprint: "sha256:game-1",
    },
    { now: NOW },
  );
}

function run(status = "completed") {
  return createAnalysisRun(
    {
      id: "run-1",
      gameIds: ["game-1"],
      engine: ENGINE,
      settings: SETTINGS,
      status,
      progress: {
        completed: status === "completed" ? 2 : 0,
        total: 2,
      },
      completedAt: status === "completed" ? NOW : null,
    },
    { now: NOW },
  );
}

async function evaluation(fen, value, bestMove = null) {
  const cacheKey = await createPositionCacheKey({
    fen,
    engine: ENGINE,
    settings: SETTINGS,
  });

  return createPositionEvaluation(
    {
      id: `evaluation-${cacheKey.slice(-12)}`,
      cacheKey,
      fen,
      engine: ENGINE,
      settings: SETTINGS,
      lines: [
        {
          multiPv: 1,
          depth: 8,
          score: { type: "cp", value, perspective: "white" },
          bestMove,
          pv: bestMove ? [bestMove] : [],
        },
      ],
    },
    { now: NOW },
  );
}

async function completeSnapshot(overrides = {}) {
  const ana = player();
  const domainGame = game();
  const context = extractPlayerMoveContexts([domainGame], ana).contexts[0];

  return {
    schemaVersion: 1,
    players: [ana],
    games: [domainGame],
    analysisRuns: [run()],
    moveAnalyses: [],
    positionEvaluations: [
      await evaluation(context.beforeFen, 30, "d2d4"),
      await evaluation(context.afterFen, -90),
    ],
    trainingTasks: [],
    trainingAttempts: [],
    ...overrides,
  };
}

test("preview generira personalizirani potez bez zapisivanja", async () => {
  const repository = createMemoryDomainRepository(await completeSnapshot());
  const preview = await createPersonalizedMaterializationPreview({
    repository,
    runId: "run-1",
    playerId: "player-ana",
  });

  assert.equal(preview.canMaterialize, true);
  assert.equal(preview.summary.gamesMatched, 1);
  assert.equal(preview.summary.generated, 1);
  assert.equal(preview.summary.toAdd, 1);
  assert.equal(preview.moveAnalyses[0].centipawnLoss, 120);
  assert.deepEqual(await repository.listMoveAnalyses(), []);
});

test("potvrda sprema rezultat, a ponavljanje je idempotentno", async () => {
  const repository = createMemoryDomainRepository(await completeSnapshot());
  const preview = await createPersonalizedMaterializationPreview({
    repository,
    runId: "run-1",
    playerId: "player-ana",
  });
  const request = {
    repository,
    runId: "run-1",
    playerId: "player-ana",
    previewToken: preview.token,
  };
  const first = await confirmPersonalizedMaterialization(request);
  const second = await confirmPersonalizedMaterialization(request);

  assert.equal(first.status, "materialized");
  assert.equal(first.added, 1);
  assert.equal(second.status, "already-materialized");
  assert.equal((await repository.listMoveAnalyses()).length, 1);
});

test("nedovrseni posao i cache koji nedostaje blokiraju potvrdu", async () => {
  const incompleteRepository = createMemoryDomainRepository(
    await completeSnapshot({ analysisRuns: [run("queued")] }),
  );
  const missingCacheSnapshot = await completeSnapshot();
  missingCacheSnapshot.positionEvaluations.pop();
  const missingCacheRepository =
    createMemoryDomainRepository(missingCacheSnapshot);

  const incomplete = await createPersonalizedMaterializationPreview({
    repository: incompleteRepository,
    runId: "run-1",
    playerId: "player-ana",
  });
  const missingCache = await createPersonalizedMaterializationPreview({
    repository: missingCacheRepository,
    runId: "run-1",
    playerId: "player-ana",
  });

  assert.equal(incomplete.canMaterialize, false);
  assert.equal(
    incomplete.blockingWarnings.some(
      (item) => item.code === "analysis-run-not-completed",
    ),
    true,
  );
  assert.equal(missingCache.canMaterialize, false);
  assert.equal(
    missingCache.blockingWarnings.some(
      (item) => item.code === "missing-position-evaluation",
    ),
    true,
  );
});

test("profil koji nije u partijama ne proizvodi rezultate", async () => {
  const snapshot = await completeSnapshot();
  snapshot.players.push(player("player-iva", "Iva"));
  const repository = createMemoryDomainRepository(snapshot);
  const preview = await createPersonalizedMaterializationPreview({
    repository,
    runId: "run-1",
    playerId: "player-iva",
  });

  assert.equal(preview.canMaterialize, false);
  assert.equal(preview.summary.generated, 0);
  assert.equal(
    preview.blockingWarnings[0].code,
    "player-not-in-run-games",
  );
});

test("promjena snapshot stanja nakon previewa blokira novi zapis", async () => {
  const repository = createMemoryDomainRepository(await completeSnapshot());
  const preview = await createPersonalizedMaterializationPreview({
    repository,
    runId: "run-1",
    playerId: "player-ana",
  });
  await repository.savePlayer(player("player-iva", "Iva"));

  await assert.rejects(
    confirmPersonalizedMaterialization({
      repository,
      runId: "run-1",
      playerId: "player-ana",
      previewToken: preview.token,
    }),
    (error) => error.code === "stale-preview",
  );
  assert.equal((await repository.listMoveAnalyses()).length, 0);
});

