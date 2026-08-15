import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createAnalysisRun } from "./analysis.js";
import { createGame } from "./game.js";
import {
  deleteDomainGame,
  previewDomainGameDeletion,
} from "./gameLibraryActionService.js";
import {
  createEmptyDomainSnapshot,
  createMemoryDomainRepository,
} from "./repository.js";

const NOW = "2026-08-13T10:00:00.000Z";

function game(id) {
  return createGame(
    {
      id,
      title: `Partija ${id}`,
      rawPgn: `[Event "Test"]\n\n1. e4 e5 *`,
      headers: { Event: "Test", White: "Bijeli", Black: "Crni" },
      players: { whitePlayerId: null, blackPlayerId: null },
      result: "*",
      source: { kind: "manual" },
      fingerprint: `sha256:${id}`,
      importedAt: NOW,
    },
    { now: NOW },
  );
}

function run(id, gameIds) {
  return createAnalysisRun(
    {
      id,
      gameIds,
      engine: { name: "Stockfish", version: "18" },
      settings: { depth: 8, multiPv: 1, uciOptions: {} },
      status: "queued",
      progress: { completed: 0, total: 0 },
      createdAt: NOW,
    },
    { now: NOW },
  );
}

function repository(snapshot = {}) {
  return createMemoryDomainRepository({
    ...createEmptyDomainSnapshot(),
    games: [game("game-1"), game("game-2")],
    ...snapshot,
  });
}

describe("akcije domenske biblioteke", () => {
  test("preview ne mijenja podatke, a potvrda brise samo ciljanu partiju", async () => {
    const repo = repository();
    const before = await repo.readSnapshot();

    const preview = await previewDomainGameDeletion({
      repository: repo,
      gameId: "game-1",
    });

    assert.equal(preview.canDelete, true);
    assert.equal(preview.removals.games, 1);
    assert.equal(preview.removals.analysisRuns, 0);
    assert.deepEqual(await repo.readSnapshot(), before);

    await deleteDomainGame({
      repository: repo,
      gameId: "game-1",
      confirmationToken: preview.confirmationToken,
    });
    assert.deepEqual((await repo.listGames()).map((item) => item.id), [
      "game-2",
    ]);
  });

  test("uklanja analizu koja pripada samo obrisanoj partiji", async () => {
    const repo = repository({ analysisRuns: [run("run-1", ["game-1"])] });
    const preview = await previewDomainGameDeletion({
      repository: repo,
      gameId: "game-1",
    });

    assert.equal(preview.removals.analysisRuns, 1);
    await deleteDomainGame({
      repository: repo,
      gameId: "game-1",
      confirmationToken: preview.confirmationToken,
    });
    assert.deepEqual(await repo.listAnalysisRuns(), []);
  });

  test("blokira brisanje kada analiza obuhvaca i drugu partiju", async () => {
    const repo = repository({
      analysisRuns: [run("run-shared", ["game-1", "game-2"])],
    });
    const preview = await previewDomainGameDeletion({
      repository: repo,
      gameId: "game-1",
    });

    assert.equal(preview.canDelete, false);
    assert.deepEqual(preview.blockers, [
      { analysisRunId: "run-shared", otherGameIds: ["game-2"] },
    ]);
    await assert.rejects(
      deleteDomainGame({
        repository: repo,
        gameId: "game-1",
        confirmationToken: preview.confirmationToken,
      }),
      (error) => error.code === "shared-analysis-run",
    );
    assert.equal((await repo.listGames()).length, 2);
  });

  test("odbija zastarjeli preview nakon promjene snapshota", async () => {
    const repo = repository();
    const preview = await previewDomainGameDeletion({
      repository: repo,
      gameId: "game-1",
    });
    await repo.saveGame(game("game-3"));

    await assert.rejects(
      deleteDomainGame({
        repository: repo,
        gameId: "game-1",
        confirmationToken: preview.confirmationToken,
      }),
      (error) => error.code === "stale-preview",
    );
  });
});
