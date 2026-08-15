import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { createMoveAnalysis } from "../domain/analysis";
import { createGame } from "../domain/game";
import { createPlayer } from "../domain/player";
import {
  createEmptyDomainSnapshot,
  DOMAIN_STORAGE_KEY,
} from "../domain/repository";
import {
  createTrainingAttempt,
  createTrainingTask,
} from "../domain/training";
import PlayerIdentityDashboard from "./PlayerIdentityDashboard";

const NOW = "2026-07-27T12:00:00.000Z";
const FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function player(id, displayName, aliases = []) {
  return createPlayer(
    { id, displayName, aliases },
    { now: NOW },
  );
}

function game({
  id = "game-identity-ui",
  white = "A. Saric",
  black = "Iva",
  whitePlayerId = null,
  blackPlayerId = null,
} = {}) {
  return createGame(
    {
      id,
      title: `${white} - ${black}`,
      rawPgn: `1. e4 e5`,
      headers: { White: white, Black: black },
      players: { whitePlayerId, blackPlayerId },
      result: "*",
      source: { kind: "migration" },
      fingerprint: `sha256:${id}`,
    },
    { now: NOW },
  );
}

function seedDomain(overrides = {}) {
  const snapshot = {
    ...createEmptyDomainSnapshot(),
    ...overrides,
  };
  localStorage.setItem(DOMAIN_STORAGE_KEY, JSON.stringify(snapshot));
  return snapshot;
}

function readDomain() {
  return JSON.parse(localStorage.getItem(DOMAIN_STORAGE_KEY));
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <PlayerIdentityDashboard />
    </MemoryRouter>,
  );
}

async function aliasSection() {
  const heading = await screen.findByRole("heading", {
    name: "Potvrdi novi alias",
  });
  return within(heading.closest("section"));
}

async function mergeSection() {
  const heading = await screen.findByRole("heading", {
    name: "Spoji dva profila",
  });
  return within(heading.closest("section"));
}

function downstreamRecords(sourcePlayerId) {
  const move = createMoveAnalysis({
    id: "move-identity-ui",
    analysisRunId: "run-identity-ui",
    gameId: "game-identity-ui",
    playerId: sourcePlayerId,
    ply: 1,
    color: "white",
    phase: "opening",
    beforeFen: FEN,
    afterFen:
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    playedMove: { san: "e4", uci: "e2e4" },
    bestMove: { san: "d4", uci: "d2d4" },
    beforeEvaluation: { type: "cp", value: 20 },
    afterEvaluation: { type: "cp", value: -100 },
    centipawnLoss: 120,
    classification: "mistake",
  });
  const task = createTrainingTask(
    {
      id: "task-identity-ui",
      playerId: sourcePlayerId,
      source: {
        moveAnalysisId: move.id,
        analysisRunId: move.analysisRunId,
        gameId: move.gameId,
        gameTitle: "Saric, Ana - Iva",
        ply: 1,
        moveNumber: 1,
      },
      fen: FEN,
      color: "white",
      phase: "opening",
      playedMove: { san: "e4", uci: "e2e4" },
      bestMove: { san: "d4", uci: "d2d4" },
      alternatives: [],
      centipawnLoss: 120,
      classification: "mistake",
      weaknessKey: "opening:mistake",
      priority: 70,
      tags: ["opening"],
      schedule: {
        status: "new",
        dueAt: NOW,
        intervalDays: 0,
        easeFactor: 2.5,
        repetitions: 0,
        lapses: 0,
      },
    },
    { now: NOW },
  );
  const attempt = createTrainingAttempt(
    {
      id: "attempt-identity-ui",
      taskId: task.id,
      playerId: sourcePlayerId,
      outcome: "again",
      correct: false,
      attemptedMove: { san: "e4", uci: "e2e4" },
      attemptedAt: NOW,
      previousDueAt: NOW,
      nextDueAt: "2026-07-28T12:00:00.000Z",
    },
    { now: NOW },
  );

  return { move, task, attempt };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("upravljanje identitetima igraca iz UI-ja", () => {
  test("alias preview je read-only, a potvrda sprema izvorni zapis aliasa", async () => {
    const ana = player("player-ana", "Ana Saric");
    seedDomain({
      players: [ana],
      games: [game()],
    });
    renderDashboard();
    const operation = await aliasSection();

    fireEvent.change(operation.getByLabelText("Ciljni profil"), {
      target: { value: ana.id },
    });
    fireEvent.change(operation.getByLabelText("Izvorni zapis aliasa"), {
      target: { value: "A. Saric" },
    });

    const beforePreview = readDomain();
    fireEvent.click(
      operation.getByRole("button", { name: "Pripremi preview" }),
    );
    const confirmation = await operation.findByRole("checkbox", {
      name: /Potvrdujem tocno prikazani alias/,
    });
    expect(readDomain()).toEqual(beforePreview);

    fireEvent.click(confirmation);
    fireEvent.click(
      operation.getByRole("button", { name: "Potvrdi alias" }),
    );
    await operation.findByText("Alias je potvrden.");

    const saved = readDomain();
    expect(saved.players[0].aliases).toEqual([
      "Ana Saric",
      "A. Saric",
    ]);
    expect(saved.games).toEqual(beforePreview.games);
  });

  test("potvrdeno spajanje preusmjerava sve veze i uklanja samo izvorni profil", async () => {
    const target = player("player-target", "Ana Saric");
    const source = player("player-source", "Saric, Ana");
    const records = downstreamRecords(source.id);
    seedDomain({
      players: [target, source],
      games: [
        game({
          white: source.displayName,
          whitePlayerId: source.id,
        }),
      ],
      moveAnalyses: [records.move],
      trainingTasks: [records.task],
      trainingAttempts: [records.attempt],
    });
    renderDashboard();
    const operation = await mergeSection();

    fireEvent.change(
      operation.getByLabelText("Izvorni profil koji se uklanja"),
      { target: { value: source.id } },
    );
    fireEvent.change(
      operation.getByLabelText("Ciljni profil koji ostaje"),
      { target: { value: target.id } },
    );
    const beforePreview = readDomain();
    fireEvent.click(
      operation.getByRole("button", { name: "Pripremi preview" }),
    );
    const confirmation = await operation.findByRole("checkbox", {
      name: /Potvrdujem uklanjanje izvornog profila/,
    });
    expect(readDomain()).toEqual(beforePreview);

    fireEvent.click(confirmation);
    fireEvent.click(
      operation.getByRole("button", { name: "Spoji profile" }),
    );
    await operation.findByText(
      "Profili su spojeni i veze su preusmjerene.",
    );

    const saved = readDomain();
    expect(saved.players).toHaveLength(1);
    expect(saved.players[0].id).toBe(target.id);
    expect(saved.players[0].aliases).toEqual([
      "Ana Saric",
      "Saric, Ana",
    ]);
    expect(saved.games[0].players.whitePlayerId).toBe(target.id);
    expect(saved.moveAnalyses[0].playerId).toBe(target.id);
    expect(saved.trainingTasks[0].playerId).toBe(target.id);
    expect(saved.trainingAttempts[0].playerId).toBe(target.id);
  });

  test("promjena domene nakon alias previewa blokira potvrdu", async () => {
    const ana = player("player-ana", "Ana Saric");
    seedDomain({ players: [ana] });
    renderDashboard();
    const operation = await aliasSection();

    fireEvent.change(operation.getByLabelText("Ciljni profil"), {
      target: { value: ana.id },
    });
    fireEvent.change(operation.getByLabelText("Izvorni zapis aliasa"), {
      target: { value: "A. Saric" },
    });
    fireEvent.click(
      operation.getByRole("button", { name: "Pripremi preview" }),
    );
    const confirmation = await operation.findByRole("checkbox", {
      name: /Potvrdujem tocno prikazani alias/,
    });

    const changed = readDomain();
    changed.players.push(player("player-iva", "Iva"));
    localStorage.setItem(DOMAIN_STORAGE_KEY, JSON.stringify(changed));

    fireEvent.click(confirmation);
    fireEvent.click(
      operation.getByRole("button", { name: "Potvrdi alias" }),
    );

    await waitFor(() => {
      expect(
        operation.getByText(
          /Domenski podaci promijenili su se nakon previewa|Domenski podaci promijenili su se prije spremanja aliasa/,
        ),
      ).toBeTruthy();
    });
    expect(readDomain().players[0].aliases).toEqual(["Ana Saric"]);
  });
});
