import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AnalysisJobsDashboard from "./AnalysisJobsDashboard";
import {
  deriveAnalysisTargets,
} from "../domain/analysisDashboardService";
import {
  createAnalysisRun,
  createPositionEvaluation,
} from "../domain/analysis";
import { createPositionCacheKey } from "../domain/analysisJobService";
import { createGame } from "../domain/game";
import { extractPlayerMoveContexts } from "../domain/playerAnalysisService";
import { createPlayer } from "../domain/player";
import {
  createEmptyDomainSnapshot,
  DOMAIN_STORAGE_KEY,
} from "../domain/repository";

const engineControl = vi.hoisted(() => ({
  mode: "auto",
  clients: [],
  pending: [],
}));

vi.mock("../domain/stockfishService", async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...actual,
    createStockfishClient: () => {
    const result = () => ({
      bestMove: "e2e4",
      lines: [
        {
          multiPv: 1,
          depth: 8,
          whiteScore: {
            type: "cp",
            value: 20,
            perspective: "white",
          },
          pv: ["e2e4"],
        },
      ],
    });
    const client = {
      initialize: vi.fn(async () => {}),
      analyzeFen: vi.fn(() => {
        if (engineControl.mode === "auto") {
          return Promise.resolve(result());
        }

        return new Promise((resolve, reject) => {
          engineControl.pending.push({
            client,
            complete: () => resolve(result()),
            reject,
          });
        });
      }),
      cancelAnalysis: vi.fn(async () => {
        const cancellation = Object.assign(
          new Error("Stockfish analiza je otkazana."),
          { code: "analysis-cancelled" },
        );
        const ownPending = engineControl.pending.filter(
          (item) => item.client === client,
        );
        engineControl.pending = engineControl.pending.filter(
          (item) => item.client !== client,
        );
        ownPending.forEach((item) => item.reject(cancellation));
      }),
      dispose: vi.fn(),
    };
      engineControl.clients.push(client);
      return client;
    },
  };
});

const VALID_PGN = [
  '[Event "UI analiza"]',
  '[White "Ana"]',
  '[Black "Marko"]',
  '[Result "1-0"]',
  "",
  "1. e4 e5 2. Nf3 Nc6 1-0",
].join("\n");
const PERSONALIZED_PGN = [
  '[Event "UI personalizacija"]',
  '[White "Ana"]',
  '[Black "Marko"]',
  '[Result "1-0"]',
  "",
  "1. e4 1-0",
].join("\n");
const ENGINE = { name: "Stockfish", version: "18" };
const SETTINGS = {
  depth: 8,
  multiPv: 1,
  uciOptions: { Hash: 16 },
};

function game(id = "game-ui-1") {
  return createGame({
    id,
    title: `Test partija ${id}`,
    rawPgn: VALID_PGN,
    headers: {
      Event: "UI analiza",
      White: "Ana",
      Black: "Marko",
      Result: "1-0",
    },
    players: {},
    result: "1-0",
    source: { kind: "migration" },
    fingerprint: `sha256:${id}`,
  });
}

function seedDomain(games = [game()]) {
  const snapshot = {
    ...createEmptyDomainSnapshot(),
    games,
  };
  window.localStorage.setItem(
    DOMAIN_STORAGE_KEY,
    JSON.stringify(snapshot),
  );
  return snapshot;
}

async function seedStoredRun(status = "queued", withCache = false) {
  const analyzedGame = game();
  const baseRun = {
    id: `run-${status}`,
    gameIds: [analyzedGame.id],
    engine: ENGINE,
    settings: SETTINGS,
    status,
    progress: { completed: 0, total: 0 },
    ...(status === "failed"
      ? {
          startedAt: "2026-07-27T10:00:00.000Z",
          error: "Privremena greska enginea.",
        }
      : {}),
  };
  let run = createAnalysisRun(baseRun);
  const snapshot = {
    ...createEmptyDomainSnapshot(),
    games: [analyzedGame],
    analysisRuns: [run],
  };
  const derived = await deriveAnalysisTargets({
    snapshot,
    gameIds: run.gameIds,
    engine: run.engine,
    settings: run.settings,
  });

  if (withCache) {
    const cached = await positionEvaluation(
      derived.targets[0].fen,
      15,
      "e2e4",
    );
    snapshot.positionEvaluations = [cached];
    run = createAnalysisRun({
      ...run,
      progress: {
        completed: 1,
        total: derived.targets.length,
      },
    });
    snapshot.analysisRuns = [run];
  }

  window.localStorage.setItem(
    DOMAIN_STORAGE_KEY,
    JSON.stringify(snapshot),
  );
  return { snapshot, targetCount: derived.targets.length, run };
}

function readDomain() {
  return JSON.parse(window.localStorage.getItem(DOMAIN_STORAGE_KEY));
}

async function positionEvaluation(fen, value, bestMove = null) {
  const cacheKey = await createPositionCacheKey({
    fen,
    engine: ENGINE,
    settings: SETTINGS,
  });

  return createPositionEvaluation({
    id: `evaluation-${cacheKey.slice(-12)}`,
    cacheKey,
    fen,
    engine: ENGINE,
    settings: SETTINGS,
    lines: [
      {
        multiPv: 1,
        depth: SETTINGS.depth,
        score: { type: "cp", value, perspective: "white" },
        bestMove,
        pv: bestMove ? [bestMove] : [],
      },
    ],
  });
}

async function seedCompletedAnalysis() {
  const ana = createPlayer({
    id: "player-ana",
    displayName: "Ana",
    aliases: ["Ana"],
  });
  const analyzedGame = createGame({
    id: "game-personalized",
    title: "Personalizirana partija",
    rawPgn: PERSONALIZED_PGN,
    headers: { White: "Ana", Black: "Marko", Result: "1-0" },
    players: { whitePlayerId: ana.id },
    result: "1-0",
    source: { kind: "migration" },
    fingerprint: "sha256:game-personalized",
  });
  const context = extractPlayerMoveContexts(
    [analyzedGame],
    ana,
  ).contexts[0];
  const completedAt = new Date().toISOString();
  const run = createAnalysisRun({
    id: "run-completed",
    gameIds: [analyzedGame.id],
    engine: ENGINE,
    settings: SETTINGS,
    status: "completed",
    progress: { completed: 2, total: 2 },
    completedAt,
  });
  const snapshot = {
    ...createEmptyDomainSnapshot(),
    players: [ana],
    games: [analyzedGame],
    analysisRuns: [run],
    positionEvaluations: [
      await positionEvaluation(context.beforeFen, 30, "d2d4"),
      await positionEvaluation(context.afterFen, -90),
    ],
  };

  window.localStorage.setItem(
    DOMAIN_STORAGE_KEY,
    JSON.stringify(snapshot),
  );
  return snapshot;
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <AnalysisJobsDashboard />
    </MemoryRouter>,
  );
}

async function prepareJobPreview() {
  await screen.findByRole("heading", { name: "Status analiza" });
  fireEvent.click(
    screen.getByRole("checkbox", { name: /Test partija game-ui-1/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Pripremi preview" }),
  );
  await screen.findByText("Jedinstvene pozicije");
}

async function preparePersonalizationPreview() {
  await screen.findByRole("heading", { name: "Status analiza" });
  const section = screen
    .getByRole("heading", {
      name: "Personalizirani rezultati igraca",
    })
    .closest("section");
  const controls = within(section);

  fireEvent.change(
    controls.getByRole("combobox", { name: "Dovrseni posao" }),
    { target: { value: "run-completed" } },
  );
  fireEvent.change(
    controls.getByRole("combobox", { name: "Profil igraca" }),
    { target: { value: "player-ana" } },
  );
  fireEvent.click(
    controls.getByRole("button", { name: "Pripremi preview" }),
  );
  await controls.findByText("Novi rezultati");

  return controls;
}

async function completeNextEngineAnalysis() {
  await waitFor(() => {
    expect(engineControl.pending.length).toBeGreaterThan(0);
  });
  const pending = engineControl.pending.shift();
  await act(async () => {
    pending.complete();
  });
}

beforeEach(() => {
  window.localStorage.clear();
  engineControl.mode = "auto";
  engineControl.clients.length = 0;
  engineControl.pending.length = 0;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  engineControl.pending.length = 0;
});

describe("stvaranje analitickog posla iz UI-ja", () => {
  test("preview je read-only, a potvrda stvara samo queued posao", async () => {
    seedDomain();
    renderDashboard();

    await prepareJobPreview();

    const confirmButton = screen.getByRole("button", {
      name: "Stvori queued posao",
    });
    expect(confirmButton.disabled).toBe(true);
    expect(readDomain().analysisRuns).toHaveLength(0);
    expect(readDomain().positionEvaluations).toHaveLength(0);

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Potvrdujem stvaranje queued posla/,
      }),
    );
    expect(confirmButton.disabled).toBe(false);
    fireEvent.click(confirmButton);

    await screen.findByText(/Engine nije pokrenut/);

    const saved = readDomain();
    expect(saved.analysisRuns).toHaveLength(1);
    expect(saved.analysisRuns[0].status).toBe("queued");
    expect(saved.analysisRuns[0].progress.completed).toBe(0);
    expect(saved.analysisRuns[0].progress.total).toBeGreaterThan(0);
    expect(saved.positionEvaluations).toHaveLength(0);
    expect(saved.moveAnalyses).toHaveLength(0);
  });

  test("promjena domene nakon previewa blokira stvaranje posla", async () => {
    seedDomain();
    renderDashboard();

    await prepareJobPreview();

    const changed = readDomain();
    changed.games.push(game("game-ui-promijenjen"));
    window.localStorage.setItem(
      DOMAIN_STORAGE_KEY,
      JSON.stringify(changed),
    );

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Potvrdujem stvaranje queued posla/,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Stvori queued posao" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Domenski podaci ili odabir promijenili su se nakon previewa.",
        ),
      ).toBeTruthy();
    });
    expect(readDomain().analysisRuns).toHaveLength(0);
    expect(readDomain().positionEvaluations).toHaveLength(0);
  });
});

describe("izvrsavanje spremljenog analitickog posla iz UI-ja", () => {
  test("queued posao prikazuje napredak i zavrsava sa spremljenim cacheom", async () => {
    engineControl.mode = "manual";
    const { snapshot, targetCount } = await seedStoredRun();
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Pokreni Stockfish" }),
    );
    expect(
      await screen.findByText("Stockfish analizira"),
    ).toBeTruthy();
    expect(screen.getByText(`0/${targetCount} pozicija`)).toBeTruthy();

    await completeNextEngineAnalysis();
    await screen.findByText(`1/${targetCount} pozicija`);
    for (let index = 1; index < targetCount; index += 1) {
      await completeNextEngineAnalysis();
    }

    expect(await screen.findByText("Analiza je zavrsena")).toBeTruthy();
    expect(
      screen.getByText(`${targetCount}/${targetCount} pozicija`),
    ).toBeTruthy();

    const saved = readDomain();
    expect(saved.analysisRuns[0].status).toBe("completed");
    expect(saved.analysisRuns[0].progress).toEqual({
      completed: targetCount,
      total: targetCount,
    });
    expect(saved.positionEvaluations).toHaveLength(targetCount);
    expect(saved.games).toEqual(snapshot.games);
    expect(engineControl.clients[0].dispose).toHaveBeenCalled();
  });

  test("failed posao nastavlja iz kompatibilnog cachea i analizira samo ostatak", async () => {
    const { targetCount } = await seedStoredRun("failed", true);
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Nastavi iz cachea" }),
    );

    expect(await screen.findByText("Analiza je zavrsena")).toBeTruthy();
    expect(screen.getByText(/cache 1, novo/)).toBeTruthy();

    const saved = readDomain();
    expect(saved.analysisRuns[0].status).toBe("completed");
    expect(saved.positionEvaluations).toHaveLength(targetCount);
    expect(
      engineControl.clients[0].analyzeFen,
    ).toHaveBeenCalledTimes(targetCount - 1);
  });

  test("otkazivanje aktivnog posla sprema cancelled status i oslobada klijent", async () => {
    engineControl.mode = "manual";
    const { snapshot } = await seedStoredRun();
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Pokreni Stockfish" }),
    );
    await waitFor(() => {
      expect(engineControl.pending).toHaveLength(1);
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Otka/ }),
    );

    expect(await screen.findByText("Analiza je otkazana")).toBeTruthy();
    const saved = readDomain();
    expect(saved.analysisRuns[0].status).toBe("cancelled");
    expect(saved.positionEvaluations).toHaveLength(0);
    expect(saved.games).toEqual(snapshot.games);
    expect(
      engineControl.clients[0].cancelAnalysis,
    ).toHaveBeenCalled();
    expect(engineControl.clients[0].dispose).toHaveBeenCalled();
  });
});

describe("personalizirana materijalizacija iz UI-ja", () => {
  test("preview je read-only, a potvrda sprema samo potez odabranog igraca", async () => {
    await seedCompletedAnalysis();
    renderDashboard();

    const controls = await preparePersonalizationPreview();
    const confirmButton = controls.getByRole("button", {
      name: "Spremi personalizirane rezultate",
    });

    expect(confirmButton.disabled).toBe(true);
    expect(readDomain().moveAnalyses).toHaveLength(0);

    fireEvent.click(
      controls.getByRole("checkbox", {
        name: /Potvrdujem spremanje prikazanih MoveAnalysis zapisa/,
      }),
    );
    expect(confirmButton.disabled).toBe(false);
    fireEvent.click(confirmButton);

    await controls.findByText("Spremljeno novih rezultata: 1.");

    const saved = readDomain();
    expect(saved.moveAnalyses).toHaveLength(1);
    expect(saved.moveAnalyses[0].playerId).toBe("player-ana");
    expect(saved.moveAnalyses[0].gameId).toBe("game-personalized");
    expect(saved.moveAnalyses[0].color).toBe("white");
    expect(saved.analysisRuns).toHaveLength(1);
    expect(saved.positionEvaluations).toHaveLength(2);
  });

  test("promjena domene nakon previewa blokira spremanje rezultata", async () => {
    await seedCompletedAnalysis();
    renderDashboard();

    const controls = await preparePersonalizationPreview();
    const changed = readDomain();
    changed.players.push(
      createPlayer({
        id: "player-novi",
        displayName: "Novi igrac",
        aliases: [],
      }),
    );
    window.localStorage.setItem(
      DOMAIN_STORAGE_KEY,
      JSON.stringify(changed),
    );

    fireEvent.click(
      controls.getByRole("checkbox", {
        name: /Potvrdujem spremanje prikazanih MoveAnalysis zapisa/,
      }),
    );
    fireEvent.click(
      controls.getByRole("button", {
        name: "Spremi personalizirane rezultate",
      }),
    );

    await waitFor(() => {
      expect(
        controls.getByText(
          "Domenski podaci promijenili su se nakon previewa.",
        ),
      ).toBeTruthy();
    });
    expect(readDomain().moveAnalyses).toHaveLength(0);
  });
});
