import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import { createPlayer } from "../domain/player";
import {
  createEmptyDomainSnapshot,
  DOMAIN_STORAGE_KEY,
} from "../domain/repository";
import {
  createTrainingAttempt,
  createTrainingTask,
} from "../domain/training";
import TrainingProgressDashboard from "./TrainingProgressDashboard";

const NOW = "2026-07-27T10:00:00.000Z";
const FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function player() {
  return createPlayer(
    { id: "player-ana", displayName: "Ana", aliases: [] },
    { now: NOW },
  );
}

function task(id, weaknessKey, phase, priority) {
  return createTrainingTask(
    {
      id,
      playerId: "player-ana",
      source: {
        moveAnalysisId: `move-${id}`,
        analysisRunId: "run-progress-ui",
        gameId: `game-${id}`,
        gameTitle: `Partija ${id}`,
        ply: 1,
        moveNumber: 1,
      },
      fen: FEN,
      color: "white",
      phase,
      playedMove: { san: "e4", uci: "e2e4" },
      bestMove: { san: "d4", uci: "d2d4" },
      alternatives: [],
      centipawnLoss: 120,
      classification: "mistake",
      weaknessKey,
      priority,
      tags: [phase],
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
}

function attempt({
  id,
  taskId,
  outcome,
  correct,
  attemptedAt,
  san,
}) {
  return createTrainingAttempt(
    {
      id,
      taskId,
      playerId: "player-ana",
      outcome,
      correct,
      attemptedMove: { san, uci: san === "d4" ? "d2d4" : "e2e4" },
      attemptedAt,
      previousDueAt: NOW,
      nextDueAt: "2026-07-28T10:00:00.000Z",
    },
    { now: NOW },
  );
}

function seedDomain({ orphanAttempt = false } = {}) {
  const openingA = task(
    "opening-a",
    "opening:mistake",
    "opening",
    70,
  );
  const openingB = task(
    "opening-b",
    "opening:mistake",
    "opening",
    80,
  );
  const endgame = task(
    "endgame",
    "endgame:mistake",
    "endgame",
    90,
  );
  const failed = attempt({
    id: "attempt-again",
    taskId: orphanAttempt ? "missing-task" : openingA.id,
    outcome: "again",
    correct: false,
    attemptedAt: NOW,
    san: "e4",
  });
  const correct = attempt({
    id: "attempt-good",
    taskId: openingB.id,
    outcome: "good",
    correct: true,
    attemptedAt: "2026-07-27T09:00:00.000Z",
    san: "d4",
  });
  const snapshot = {
    ...createEmptyDomainSnapshot(),
    players: [player()],
    trainingTasks: [openingA, openingB, endgame],
    trainingAttempts: [failed, correct],
  };
  localStorage.setItem(DOMAIN_STORAGE_KEY, JSON.stringify(snapshot));
  return snapshot;
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <TrainingProgressDashboard />
    </MemoryRouter>,
  );
}

function readDomain() {
  return JSON.parse(localStorage.getItem(DOMAIN_STORAGE_KEY));
}

function summaryValue(label) {
  const summary = document.querySelector(".training-progress-summary");
  const article = [...summary.querySelectorAll("article")].find(
    (item) => item.querySelector("span")?.textContent === label,
  );
  return article.querySelector("strong").textContent;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("napredak treninga iz UI-ja", () => {
  test("prikazuje agregate, slabosti i posljednje pokusaje bez pisanja", async () => {
    const before = seedDomain();
    renderDashboard();

    fireEvent.change(await screen.findByLabelText("Profil igraca"), {
      target: { value: "player-ana" },
    });

    await waitFor(() => {
      expect(summaryValue("Zadaci")).toBe("3");
    });
    expect(summaryValue("Pokusaji")).toBe("2");
    expect(summaryValue("Uspjesnost")).toBe("50%");
    expect(screen.getByRole("heading", { name: "opening:mistake" })).toBeTruthy();
    expect(screen.getByText("Partija opening-a")).toBeTruthy();
    expect(screen.getByText("Partija opening-b")).toBeTruthy();
    expect(readDomain()).toEqual(before);
  });

  test("pokusaj bez zadatka ostaje upozorenje i ne rusi izvjestaj", async () => {
    const before = seedDomain({ orphanAttempt: true });
    renderDashboard();

    fireEvent.change(await screen.findByLabelText("Profil igraca"), {
      target: { value: "player-ana" },
    });

    expect(
      await screen.findByText("missing-training-task"),
    ).toBeTruthy();
    expect(summaryValue("Pokusaji")).toBe("1");
    expect(screen.getByText("Izvorni zadatak nedostaje")).toBeTruthy();
    expect(readDomain()).toEqual(before);
  });
});
