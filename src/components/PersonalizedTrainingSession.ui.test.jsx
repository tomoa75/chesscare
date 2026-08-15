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
  it,
  vi,
} from "vitest";
import { createMoveAnalysis } from "../domain/analysis";
import { createGame } from "../domain/game";
import { createPlayer } from "../domain/player";
import {
  createEmptyDomainSnapshot,
  DOMAIN_STORAGE_KEY,
} from "../domain/repository";
import { createTrainingTask } from "../domain/training";
import PersonalizedTrainingSession from "./PersonalizedTrainingSession";

vi.mock("react-chessboard", () => ({
  Chessboard: ({ onPieceDrop }) => (
    <div aria-label="Testna sahovska ploca">
      <button type="button" onClick={() => onPieceDrop("d2", "d4")}>
        Odigraj d4
      </button>
      <button type="button" onClick={() => onPieceDrop("e2", "e4")}>
        Odigraj e4
      </button>
    </div>
  ),
}));

const player = createPlayer({
  id: "player-ana",
  displayName: "Ana",
  aliases: [],
});

const game = createGame({
  id: "game-ui",
  title: "Ana - Iva",
  rawPgn: `[Event "Test"]
[White "Ana"]
[Black "Iva"]
[Result "*"]

1. e4 *`,
  headers: { White: "Ana", Black: "Iva", Result: "*" },
  players: { whitePlayerId: player.id },
  result: "*",
  source: { kind: "migration" },
  fingerprint: "game-ui-fingerprint",
});

const moveAnalysis = createMoveAnalysis({
  id: "move-ui",
  analysisRunId: "run-ui",
  gameId: game.id,
  playerId: player.id,
  ply: 1,
  color: "white",
  phase: "opening",
  beforeFen:
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  afterFen:
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
  playedMove: { san: "e4", uci: "e2e4" },
  bestMove: { san: "d4", uci: "d2d4" },
  beforeEvaluation: { type: "cp", value: 20 },
  afterEvaluation: { type: "cp", value: -100 },
  centipawnLoss: 120,
  classification: "mistake",
});

const trainingTask = createTrainingTask({
  id: "task-ui",
  playerId: player.id,
  source: {
    moveAnalysisId: moveAnalysis.id,
    analysisRunId: "run-ui",
    gameId: game.id,
    gameTitle: game.title,
    ply: 1,
    moveNumber: 1,
  },
  fen: moveAnalysis.beforeFen,
  color: "white",
  phase: "opening",
  bestMove: { san: "d4", uci: "d2d4" },
  alternatives: [{ san: "Nf3", uci: "g1f3" }],
  playedMove: { san: "e4", uci: "e2e4" },
  centipawnLoss: 120,
  classification: "mistake",
  weaknessKey: "opening:mistake",
  priority: 70,
  tags: ["opening", "mistake"],
  schedule: {
    status: "new",
    dueAt: "2020-01-01T00:00:00.000Z",
    intervalDays: 0,
    easeFactor: 2.5,
    repetitions: 0,
    lapses: 0,
  },
});

function seedDomain() {
  const snapshot = createEmptyDomainSnapshot();
  snapshot.players = [player];
  snapshot.games = [game];
  snapshot.moveAnalyses = [moveAnalysis];
  snapshot.trainingTasks = [trainingTask];
  localStorage.setItem(DOMAIN_STORAGE_KEY, JSON.stringify(snapshot));
}

async function renderSelectedSession() {
  render(
    <MemoryRouter>
      <PersonalizedTrainingSession />
    </MemoryRouter>,
  );

  fireEvent.change(await screen.findByLabelText("Profil igraca"), {
    target: { value: player.id },
  });

  await screen.findByRole("heading", { name: game.title });
}

function readDomain() {
  return JSON.parse(localStorage.getItem(DOMAIN_STORAGE_KEY));
}

describe("PersonalizedTrainingSession", () => {
  beforeEach(() => {
    localStorage.clear();
    seedDomain();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("sprema tocan pokusaj i novi raspored bez promjene izvora", async () => {
    const sourceGame = readDomain().games[0];
    const sourceMoveAnalysis = readDomain().moveAnalyses[0];

    await renderSelectedSession();
    fireEvent.click(screen.getByRole("button", { name: "Odigraj d4" }));

    await screen.findByRole("heading", { name: "Tocan potez" });
    expect(screen.getByRole("button", { name: "Dobro" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dobro" }));
    await screen.findByText(
      /Pokusaj je spremljen\. Sljedece ponavljanje za 1 dana\./,
    );

    const saved = readDomain();
    expect(saved.trainingAttempts).toHaveLength(1);
    expect(saved.trainingAttempts[0].correct).toBe(true);
    expect(saved.trainingAttempts[0].outcome).toBe("good");
    expect(saved.trainingTasks[0].schedule.status).toBe("learning");
    expect(saved.trainingTasks[0].schedule.intervalDays).toBe(1);
    expect(saved.games[0]).toEqual(sourceGame);
    expect(saved.moveAnalyses[0]).toEqual(sourceMoveAnalysis);
  });

  it("za netocan potez nudi samo ponavljanje i sprema neuspjeh", async () => {
    const sourceGame = readDomain().games[0];
    const sourceMoveAnalysis = readDomain().moveAnalyses[0];

    await renderSelectedSession();
    fireEvent.click(screen.getByRole("button", { name: "Odigraj e4" }));

    await screen.findByRole("heading", {
      name: "Pokusaj nije medu preporucenim potezima",
    });
    expect(screen.queryByRole("button", { name: "Dobro" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ponovi" }));
    await screen.findByText(/Pokusaj je spremljen\./);

    const saved = readDomain();
    expect(saved.trainingAttempts).toHaveLength(1);
    expect(saved.trainingAttempts[0].correct).toBe(false);
    expect(saved.trainingAttempts[0].outcome).toBe("again");
    expect(saved.trainingTasks[0].schedule.lapses).toBe(1);
    expect(saved.trainingTasks[0].schedule.repetitions).toBe(0);
    expect(saved.games[0]).toEqual(sourceGame);
    expect(saved.moveAnalyses[0]).toEqual(sourceMoveAnalysis);
  });

  it("odbija spremanje ako su se domenski podaci promijenili nakon poteza", async () => {
    await renderSelectedSession();
    fireEvent.click(screen.getByRole("button", { name: "Odigraj d4" }));
    await screen.findByRole("heading", { name: "Tocan potez" });

    const changed = readDomain();
    changed.players.push(
      createPlayer({
        id: "player-iva",
        displayName: "Iva",
        aliases: [],
      }),
    );
    localStorage.setItem(DOMAIN_STORAGE_KEY, JSON.stringify(changed));

    fireEvent.click(screen.getByRole("button", { name: "Dobro" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          /Domenski podaci promijenili su se nakon poteza|Domenski podaci promijenili su se prije spremanja pokusaja/,
        ),
      ).toBeTruthy();
    });

    const saved = readDomain();
    expect(saved.trainingAttempts).toHaveLength(0);
    expect(saved.trainingTasks[0].schedule.status).toBe("new");
  });
});
