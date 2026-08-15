import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TrainingPlanDashboard from "./TrainingPlanDashboard";
import { createMoveAnalysis } from "../domain/analysis";
import { createGame } from "../domain/game";
import { createPlayer } from "../domain/player";
import {
  createEmptyDomainSnapshot,
  DOMAIN_STORAGE_KEY,
} from "../domain/repository";

const START_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function player(id = "player-ana", displayName = "Ana") {
  return createPlayer({
    id,
    displayName,
    aliases: [],
  });
}

function game() {
  return createGame({
    id: "game-training-ui",
    title: "Ana - Iva",
    rawPgn: "1. e4 e5",
    headers: {
      White: "Ana",
      Black: "Iva",
      Opening: "Open Game",
    },
    players: { whitePlayerId: "player-ana" },
    result: "*",
    source: { kind: "migration" },
    fingerprint: "sha256:game-training-ui",
  });
}

function analyzedMove() {
  return createMoveAnalysis({
    id: "move-training-ui",
    analysisRunId: "run-training-ui",
    gameId: "game-training-ui",
    playerId: "player-ana",
    ply: 1,
    color: "white",
    phase: "opening",
    beforeFen: START_FEN,
    afterFen:
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    playedMove: { san: "e4", uci: "e2e4" },
    bestMove: { san: "d4", uci: "d2d4" },
    beforeEvaluation: { type: "cp", value: 20 },
    afterEvaluation: { type: "cp", value: -100 },
    centipawnLoss: 120,
    classification: "mistake",
  });
}

function seedDomain() {
  const snapshot = {
    ...createEmptyDomainSnapshot(),
    players: [player()],
    games: [game()],
    moveAnalyses: [analyzedMove()],
  };
  window.localStorage.setItem(
    DOMAIN_STORAGE_KEY,
    JSON.stringify(snapshot),
  );
  return snapshot;
}

function readDomain() {
  return JSON.parse(window.localStorage.getItem(DOMAIN_STORAGE_KEY));
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <TrainingPlanDashboard />
    </MemoryRouter>,
  );
}

async function preparePreview() {
  await screen.findByRole("heading", {
    name: "Personalizirani trening",
  });
  fireEvent.change(
    screen.getByRole("combobox", { name: "Profil igraca" }),
    { target: { value: "player-ana" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Pripremi preview" }),
  );
  await screen.findByRole("heading", { name: "Zadaci za spremanje" });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("materijalizacija trening zadataka iz UI-ja", () => {
  test("preview je read-only, a potvrda sprema samo izvedeni zadatak", async () => {
    seedDomain();
    renderDashboard();

    await preparePreview();

    const confirmButton = screen.getByRole("button", {
      name: "Spremi 1 zadataka",
    });
    expect(confirmButton.disabled).toBe(true);
    expect(readDomain().trainingTasks).toHaveLength(0);

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Potvrdujem spremanje tocnog skupa prikazanih zadataka/,
      }),
    );
    expect(confirmButton.disabled).toBe(false);
    fireEvent.click(confirmButton);

    await screen.findByText("Spremljeno novih zadataka: 1.");

    const saved = readDomain();
    expect(saved.trainingTasks).toHaveLength(1);
    expect(saved.trainingTasks[0].playerId).toBe("player-ana");
    expect(saved.trainingTasks[0].source.gameId).toBe(
      "game-training-ui",
    );
    expect(saved.trainingTasks[0].source.moveAnalysisId).toBe(
      "move-training-ui",
    );
    expect(saved.trainingTasks[0].bestMove.uci).toBe("d2d4");
    expect(saved.trainingTasks[0].schedule.status).toBe("new");
    expect(saved.trainingAttempts).toHaveLength(0);
    expect(saved.moveAnalyses).toHaveLength(1);
    expect(saved.games).toHaveLength(1);
  });

  test("promjena domene nakon previewa blokira spremanje zadataka", async () => {
    seedDomain();
    renderDashboard();

    await preparePreview();

    const changed = readDomain();
    changed.players.push(player("player-iva", "Iva"));
    window.localStorage.setItem(
      DOMAIN_STORAGE_KEY,
      JSON.stringify(changed),
    );

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Potvrdujem spremanje tocnog skupa prikazanih zadataka/,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Spremi 1 zadataka" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Domenski podaci promijenili su se nakon previewa.",
        ),
      ).toBeTruthy();
    });
    expect(readDomain().trainingTasks).toHaveLength(0);
    expect(readDomain().trainingAttempts).toHaveLength(0);
  });
});
