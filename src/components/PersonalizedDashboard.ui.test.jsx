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
  vi,
} from "vitest";
import {
  createAnalysisRun,
  createMoveAnalysis,
} from "../domain/analysis";
import { createGame } from "../domain/game";
import { createPlayer } from "../domain/player";
import {
  createEmptyDomainSnapshot,
  createLocalStorageDomainRepository,
  DOMAIN_STORAGE_KEY,
} from "../domain/repository";
import PersonalizedDashboard from "./PersonalizedDashboard";

vi.mock("react-chessboard", () => ({
  Chessboard: ({ position, boardOrientation }) => (
    <div
      aria-label="Dokazna sahovska pozicija"
      data-position={position}
      data-orientation={boardOrientation}
    />
  ),
}));

const NOW = "2026-07-27T10:00:00.000Z";

function player() {
  return createPlayer(
    { id: "player-ana", displayName: "Ana", aliases: ["A. Saric"] },
    { now: NOW },
  );
}

function game(id, date) {
  return createGame(
    {
      id,
      title: `Ana - Iva ${date}`,
      rawPgn: `1. e4 e5`,
      headers: {
        White: "Ana",
        Black: "Iva",
        Result: "1-0",
        Opening: "Open Game",
        Date: date,
      },
      players: { whitePlayerId: "player-ana" },
      result: "1-0",
      source: { kind: "migration" },
      fingerprint: `sha256:${id}`,
    },
    { now: NOW },
  );
}

function run(id, gameId, completedAt = NOW) {
  return createAnalysisRun(
    {
      id,
      gameIds: [gameId],
      engine: { name: "Stockfish", version: "18" },
      settings: { depth: 12, multiPv: 1, uciOptions: {} },
      status: "completed",
      progress: { completed: 1, total: 1 },
      completedAt,
    },
    { now: NOW },
  );
}

function move(id, gameId, runId, loss, classification) {
  return createMoveAnalysis({
    id,
    analysisRunId: runId,
    gameId,
    playerId: "player-ana",
    ply: 1,
    color: "white",
    phase: "opening",
    beforeFen: "before",
    afterFen: "after",
    playedMove: { san: "e4", uci: "e2e4" },
    bestMove: { san: "d4", uci: "d2d4" },
    beforeEvaluation: { type: "cp", value: 20 },
    afterEvaluation: { type: "cp", value: 20 - loss },
    centipawnLoss: loss,
    classification,
  });
}

function seedDomain() {
  const ana = player();
  const olderGame = game("game-2024", "2024.06.01");
  const newerGame = game("game-2025", "2025.06.01");
  const unrelatedGame = createGame(
    {
      id: "game-unrelated",
      title: "Iva - Marko",
      rawPgn: "1. d4 d5",
      headers: {
        White: "Iva",
        Black: "Marko",
        Result: "1/2-1/2",
        Date: "2025.07.01",
      },
      players: {
        whitePlayerId: "player-iva",
        blackPlayerId: "player-marko",
      },
      result: "1/2-1/2",
      source: { kind: "migration" },
      fingerprint: "sha256:game-unrelated",
    },
    { now: NOW },
  );
  const olderRun = run("run-2024", olderGame.id);
  const newerRun = run("run-2025", newerGame.id);
  const supersededRun = run(
    "run-2025-old",
    newerGame.id,
    "2026-07-26T10:00:00.000Z",
  );
  const snapshot = {
    ...createEmptyDomainSnapshot(),
    players: [ana],
    games: [olderGame, newerGame, unrelatedGame],
    analysisRuns: [olderRun, newerRun, supersededRun],
    moveAnalyses: [
      move("move-2024", olderGame.id, olderRun.id, 100, "mistake"),
      move("move-2025", newerGame.id, newerRun.id, 20, "good"),
      move(
        "move-2025-old",
        newerGame.id,
        supersededRun.id,
        300,
        "blunder",
      ),
    ],
  };
  localStorage.setItem(DOMAIN_STORAGE_KEY, JSON.stringify(snapshot));
  return snapshot;
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <PersonalizedDashboard />
    </MemoryRouter>,
  );
}

function readDomain() {
  return JSON.parse(localStorage.getItem(DOMAIN_STORAGE_KEY));
}

function summaryValue(label) {
  const labelNode = screen.getByText(label);
  return labelNode.closest("div").querySelector("strong").textContent;
}

function classificationValue(label) {
  const grid = document.querySelector(".classification-grid");
  const labelNode = [...grid.querySelectorAll("span")].find(
    (node) => node.textContent === label,
  );
  return labelNode.closest("article").querySelector("strong").textContent;
}

function gameAccuracy(title) {
  return screen
    .getByText(title)
    .closest("article")
    .querySelector(".player-game-accuracy strong").textContent;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("personalizirani dashboard iz UI-ja", () => {
  test("prikazuje samo poteze odabranog igraca i read-only vremenski filter", async () => {
    const before = seedDomain();
    renderDashboard();

    fireEvent.change(await screen.findByLabelText("Profil"), {
      target: { value: "player-ana" },
    });

    await waitFor(() => {
      expect(summaryValue("Potezi")).toBe("2");
    });
    expect(summaryValue("Partije")).toBe("2");
    expect(
      screen.getByRole("heading", { name: "Preciznost po partijama" }),
    ).toBeTruthy();
    expect(screen.getByText("Ana - Iva 2024.06.01")).toBeTruthy();
    expect(screen.getByText("Ana - Iva 2025.06.01")).toBeTruthy();
    expect(gameAccuracy("Ana - Iva 2024.06.01")).toBe("63,5%");
    expect(gameAccuracy("Ana - Iva 2025.06.01")).toBe("91,3%");
    expect(screen.getAllByText("Stockfish 18")).toHaveLength(2);
    expect(
      screen.getByText(/Zanemareno starijih rezultata: 1/),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: "Tri prioriteta za napredak",
      }),
    ).toBeTruthy();
    expect(screen.getAllByText(/Prioritet [123]/)).toHaveLength(3);

    fireEvent.click(
      screen.getAllByRole("button", { name: /Otvori dokaz 1:/ })[0],
    );
    const board = await screen.findByLabelText(
      "Dokazna sahovska pozicija",
    );
    expect(board.dataset.position).toBe("before");
    expect(screen.getByText(/odigrano/).textContent).toContain("d4");
    fireEvent.click(
      screen.getByRole("button", { name: "Zatvori dokaz" }),
    );
    expect(
      screen.queryByLabelText("Dokazna sahovska pozicija"),
    ).toBeNull();
    expect(readDomain()).toEqual(before);

    fireEvent.change(screen.getByLabelText("Od"), {
      target: { value: "2025-01-01" },
    });

    await waitFor(() => {
      expect(summaryValue("Potezi")).toBe("1");
    });
    expect(summaryValue("Partije")).toBe("1");
    expect(screen.queryByText("Ana - Iva 2024.06.01")).toBeNull();
    expect(screen.getByText("Ana - Iva 2025.06.01")).toBeTruthy();
    expect(screen.getByText(/Aktivni raspon: 2025-01-01/)).toBeTruthy();
    expect(readDomain()).toEqual(before);

    fireEvent.click(screen.getByRole("button", { name: "Ponisti" }));
    await waitFor(() => {
      expect(summaryValue("Potezi")).toBe("2");
    });
    expect(readDomain()).toEqual(before);
  });

  test("neispravan vremenski raspon prikazuje gresku bez novog zapisa", async () => {
    const before = seedDomain();
    renderDashboard();
    fireEvent.change(await screen.findByLabelText("Profil"), {
      target: { value: "player-ana" },
    });
    await waitFor(() => {
      expect(summaryValue("Potezi")).toBe("2");
    });

    fireEvent.change(screen.getByLabelText("Od"), {
      target: { value: "2025-12-31" },
    });
    fireEvent.change(screen.getByLabelText("Do"), {
      target: { value: "2025-01-01" },
    });

    expect(
      await screen.findByText(
        "Pocetak razdoblja ne moze biti nakon kraja.",
      ),
    ).toBeTruthy();
    expect(readDomain()).toEqual(before);
  });

  test("isti-tab zapis automatski osvjezava aktualni centipawn profil", async () => {
    seedDomain();
    renderDashboard();
    fireEvent.change(await screen.findByLabelText("Profil"), {
      target: { value: "player-ana" },
    });
    await waitFor(() => {
      expect(classificationValue("Pogreske")).toBe("1");
    });

    const refreshed = readDomain();
    const refreshedRun = run(
      "run-refresh",
      "game-2025",
      "2026-07-28T10:00:00.000Z",
    );
    refreshed.analysisRuns.push(refreshedRun);
    refreshed.moveAnalyses.push(
      move(
        "move-refresh",
        "game-2025",
        refreshedRun.id,
        150,
        "mistake",
      ),
    );
    const repository = createLocalStorageDomainRepository(localStorage);
    await repository.replaceSnapshot(refreshed);

    await waitFor(() => {
      expect(classificationValue("Pogreske")).toBe("2");
    });
    expect(classificationValue("Dobri")).toBe("0");
    expect(
      screen.getByText(/Zanemareno starijih rezultata: 2/),
    ).toBeTruthy();
  });
});
