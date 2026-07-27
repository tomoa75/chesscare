import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmAnalysisJobCreation,
  createAnalysisJobPreview,
  createGame,
  createMemoryDomainRepository,
} from "./index.js";

const NOW = "2026-07-26T10:00:00.000Z";
const ENGINE = { name: "Stockfish", version: "18" };
const SETTINGS = { depth: 8, multiPv: 1, uciOptions: { Hash: 16 } };
const PGN = [
  '[Event "Test"]',
  '[White "Ana"]',
  '[Black "Marko"]',
  '[Result "1-0"]',
  "",
  "1. e4 e5 1-0",
].join("\n");

function game(id = "game-1", rawPgn = PGN) {
  return createGame(
    {
      id,
      title: `Partija ${id}`,
      rawPgn,
      headers: { White: "Ana", Black: "Marko", Result: "1-0" },
      players: {},
      result: "1-0",
      source: { kind: "migration" },
      fingerprint: `sha256:${id}`,
    },
    { now: NOW },
  );
}

function repositoryWithGames(games = [game()]) {
  return createMemoryDomainRepository({
    schemaVersion: 1,
    players: [],
    games,
    analysisRuns: [],
    moveAnalyses: [],
    positionEvaluations: [],
    trainingTasks: [],
    trainingAttempts: [],
  });
}

function request(repository, overrides = {}) {
  return {
    repository,
    gameIds: ["game-1"],
    engine: ENGINE,
    settings: SETTINGS,
    now: NOW,
    ...overrides,
  };
}

test("preview izvodi pozicije i ne zapisuje queued posao", async () => {
  const repository = repositoryWithGames();
  const preview = await createAnalysisJobPreview(request(repository));

  assert.equal(preview.canCreate, true);
  assert.equal(preview.targets.total, 3);
  assert.equal(preview.targets.cached, 0);
  assert.equal(preview.run.status, "queued");
  assert.deepEqual(preview.run.progress, { completed: 0, total: 3 });
  assert.match(preview.token, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(await repository.listAnalysisRuns(), []);
});

test("potvrda stvara samo queued posao i ne stvara evaluacije", async () => {
  const repository = repositoryWithGames();
  const preview = await createAnalysisJobPreview(request(repository));
  const result = await confirmAnalysisJobCreation(
    request(repository, { previewToken: preview.token }),
  );

  assert.equal(result.status, "created");
  assert.equal(result.run.id, preview.run.id);
  assert.equal((await repository.listAnalysisRuns()).length, 1);
  assert.equal((await repository.listPositionEvaluations()).length, 0);
});

test("dvostruka potvrda je idempotentna", async () => {
  const repository = repositoryWithGames();
  const preview = await createAnalysisJobPreview(request(repository));
  const confirmedRequest = request(repository, {
    previewToken: preview.token,
  });

  await confirmAnalysisJobCreation(confirmedRequest);
  const second = await confirmAnalysisJobCreation(confirmedRequest);

  assert.equal(second.status, "already-created");
  assert.equal((await repository.listAnalysisRuns()).length, 1);
});

test("promjena repositoryja nakon previewa blokira stvaranje", async () => {
  const repository = repositoryWithGames();
  const preview = await createAnalysisJobPreview(request(repository));
  await repository.saveGame(game("game-2"));

  await assert.rejects(
    confirmAnalysisJobCreation(
      request(repository, { previewToken: preview.token }),
    ),
    (error) => error.code === "stale-preview",
  );
  assert.equal((await repository.listAnalysisRuns()).length, 0);
});

test("nedostajuca ili neispravna partija ostaje vidljiva u previewu i blokira potvrdu", async () => {
  const repository = repositoryWithGames([
    game("broken", "nije valjani PGN"),
  ]);
  const missingPreview = await createAnalysisJobPreview(
    request(repository, { gameIds: ["missing"] }),
  );
  const brokenPreview = await createAnalysisJobPreview(
    request(repository, { gameIds: ["broken"] }),
  );

  assert.equal(missingPreview.canCreate, false);
  assert.equal(missingPreview.warnings[0].code, "missing-game");
  assert.equal(brokenPreview.canCreate, false);
  assert.equal(brokenPreview.warnings[0].code, "invalid-game-pgn");

  await assert.rejects(
    confirmAnalysisJobCreation(
      request(repository, {
        gameIds: ["broken"],
        previewToken: brokenPreview.token,
      }),
    ),
    (error) => error.code === "invalid-targets",
  );
  assert.equal((await repository.listAnalysisRuns()).length, 0);
});

