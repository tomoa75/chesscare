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
import { createGame } from "../domain/game";
import { createPlayer } from "../domain/player";
import {
  createEmptyDomainSnapshot,
  DOMAIN_STORAGE_KEY,
} from "../domain/repository";
import DomainGameLibrary from "./DomainGameLibrary";

const NOW = "2026-07-27T10:00:00.000Z";

function player(id, displayName) {
  return createPlayer(
    { id, displayName, aliases: [`${displayName} alias`] },
    { now: NOW },
  );
}

function game(input) {
  return createGame(
    {
      id: input.id,
      title: input.title,
      rawPgn: input.rawPgn,
      headers: input.headers,
      players: input.players,
      result: input.result,
      source: { kind: "migration" },
      fingerprint: `sha256:${input.id}`,
      importedAt: input.importedAt,
    },
    { now: NOW },
  );
}

function seedDomain() {
  const snapshot = {
    ...createEmptyDomainSnapshot(),
    players: [
      player("player-ana", "Ana Saric"),
      player("player-marko", "Marko Horvat"),
    ],
    games: [
      game({
        id: "game-zagreb",
        title: "Zagrebacki turnir",
        rawPgn:
          '[Event "Zagreb Open"]\n[White "A. Saric"]\n[Black "M. Horvat"]\n\n1. e4 c5 1-0',
        headers: {
          Event: "Zagreb Open",
          White: "A. Saric",
          Black: "M. Horvat",
          Date: "2026.07.20",
          Opening: "Sicilijanska obrana",
        },
        players: {
          whitePlayerId: "player-ana",
          blackPlayerId: "player-marko",
        },
        result: "1-0",
        importedAt: "2026-07-27T10:00:00.000Z",
      }),
      game({
        id: "game-klub",
        title: "Klupska partija",
        rawPgn:
          '[Event "Klub"]\n[White "Nepoznati Igrac"]\n[Black "Ana Saric"]\n\n1. d4 d5 1/2-1/2',
        headers: {
          Event: "Klub",
          White: "Nepoznati Igrac",
          Black: "Ana Saric",
          Opening: "Damin gambit",
        },
        players: {
          whitePlayerId: "missing-player",
          blackPlayerId: "player-ana",
        },
        result: "1/2-1/2",
        importedAt: "2026-07-26T10:00:00.000Z",
      }),
    ],
  };
  localStorage.setItem(DOMAIN_STORAGE_KEY, JSON.stringify(snapshot));
  return snapshot;
}

function renderLibrary() {
  return render(
    <MemoryRouter>
      <DomainGameLibrary />
    </MemoryRouter>,
  );
}

function readDomain() {
  return JSON.parse(localStorage.getItem(DOMAIN_STORAGE_KEY));
}

function visibleTitles() {
  return [...document.querySelectorAll(".library-game h2")].map(
    (heading) => heading.textContent,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("domenska biblioteka partija iz UI-ja", () => {
  test("prikazuje povezane i nerazrijesene igrace te otvara izvorni PGN", async () => {
    const before = seedDomain();
    renderLibrary();

    expect(
      await screen.findByText("Prikazano 2 od 2 partija"),
    ).toBeTruthy();
    expect(visibleTitles()).toEqual([
      "Zagrebacki turnir",
      "Klupska partija",
    ]);
    expect(
      screen.getByText(/1 referenci igraca nema povezani profil/),
    ).toBeTruthy();
    expect(screen.getByText("profil nije povezan")).toBeTruthy();

    const details = screen
      .getAllByText("Prikazi izvorni PGN")[0]
      .closest("details");
    expect(details.open).toBe(false);
    fireEvent.click(details.querySelector("summary"));
    expect(details.open).toBe(true);
    expect(details.querySelector("pre").textContent).toContain("1. e4 c5");
    expect(readDomain()).toEqual(before);
  });

  test("pretraga i ponistavanje filtra mijenjaju samo vidljivi skup", async () => {
    const before = seedDomain();
    renderLibrary();
    await screen.findByText("Prikazano 2 od 2 partija");

    fireEvent.change(screen.getByLabelText("Pretraga"), {
      target: { value: "sicilijanska" },
    });
    await screen.findByText("Prikazano 1 od 2 partija");
    expect(visibleTitles()).toEqual(["Zagrebacki turnir"]);

    fireEvent.change(screen.getByLabelText("Pretraga"), {
      target: { value: "nepostojeca partija" },
    });
    await screen.findByRole("heading", { name: "Nema rezultata" });
    expect(visibleTitles()).toEqual([]);

    fireEvent.click(
      screen.getByRole("button", { name: "Ponisti filtre" }),
    );
    await screen.findByText("Prikazano 2 od 2 partija");
    expect(visibleTitles()).toEqual([
      "Zagrebacki turnir",
      "Klupska partija",
    ]);
    expect(readDomain()).toEqual(before);
  });

  test("sortiranje i kombinirani filtri igraca i rezultata rade zajedno", async () => {
    const before = seedDomain();
    renderLibrary();
    await screen.findByText("Prikazano 2 od 2 partija");

    fireEvent.change(screen.getByLabelText("Redoslijed"), {
      target: { value: "oldest" },
    });
    await waitFor(() => {
      expect(visibleTitles()).toEqual([
        "Klupska partija",
        "Zagrebacki turnir",
      ]);
    });

    fireEvent.change(screen.getByLabelText("Redoslijed"), {
      target: { value: "title" },
    });
    await waitFor(() => {
      expect(visibleTitles()).toEqual([
        "Klupska partija",
        "Zagrebacki turnir",
      ]);
    });

    fireEvent.change(screen.getByLabelText("Igrac"), {
      target: { value: "player-ana" },
    });
    fireEvent.change(screen.getByLabelText("Rezultat"), {
      target: { value: "1/2-1/2" },
    });
    await screen.findByText("Prikazano 1 od 2 partija");
    expect(visibleTitles()).toEqual(["Klupska partija"]);
    expect(readDomain()).toEqual(before);
  });

  test("nudi povezane akcije i brise tek nakon pregleda i potvrde", async () => {
    seedDomain();
    renderLibrary();
    await screen.findByText("Prikazano 2 od 2 partija");

    const article = screen
      .getByRole("heading", { name: "Zagrebacki turnir" })
      .closest("article");
    const actions = within(article);
    expect(actions.getByRole("link", { name: "Otvori u Importu" }).getAttribute("href"))
      .toBe("/import?gameId=game-zagreb");
    expect(actions.getByRole("link", { name: "Pokreni analizu" }).getAttribute("href"))
      .toBe("/analysis-jobs?gameId=game-zagreb");
    expect(actions.getByRole("link", { name: "Analiziraj poziciju" }).getAttribute("href"))
      .toBe("/position-analysis?gameId=game-zagreb");

    fireEvent.click(actions.getByRole("button", { name: "Obrisi" }));
    await actions.findByRole("heading", { name: "Utjecaj brisanja" });
    expect(readDomain().games).toHaveLength(2);

    const confirmButton = actions.getByRole("button", {
      name: "Potvrdi brisanje",
    });
    expect(confirmButton.disabled).toBe(true);
    fireEvent.click(
      actions.getByLabelText(/Razumijem da se navedeni podaci trajno brisu/),
    );
    expect(confirmButton.disabled).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(readDomain().games).toHaveLength(1));
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Zagrebacki turnir" }),
      ).toBeNull();
    });
  });
});
