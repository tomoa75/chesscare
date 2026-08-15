import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Import from "./Import";
import {
  createEmptyDomainSnapshot,
  createGame,
  createPlayer,
  DATA_AUTHORITY_STORAGE_KEY,
  DOMAIN_STORAGE_KEY,
  LEGACY_GAMES_STORAGE_KEY,
  writeDomainAuthority,
} from "../domain";

const NOW = "2026-08-13T10:00:00.000Z";
const PGN = [
  '[Event "UI domena"]',
  '[White "Ana"]',
  '[Black "Marko"]',
  '[Result "1-0"]',
  "",
  "1. e4 e5 1-0",
].join("\n");

function seedDomain() {
  const snapshot = createEmptyDomainSnapshot();
  snapshot.players.push(
    createPlayer({ id: "white", displayName: "Ana", aliases: [] }, { now: NOW }),
    createPlayer(
      { id: "black", displayName: "Marko", aliases: [] },
      { now: NOW },
    ),
  );
  snapshot.games.push(
    createGame({
      id: "game-ui-1",
      title: "UI domena: Ana - Marko",
      rawPgn: PGN,
      headers: {
        Event: "UI domena",
        White: "Ana",
        Black: "Marko",
        Result: "1-0",
      },
      players: { whitePlayerId: "white", blackPlayerId: "black" },
      result: "1-0",
      source: { kind: "file", fileName: "ui.pgn" },
      fingerprint: "sha256:ui-game",
      importedAt: NOW,
    }),
  );
  window.localStorage.setItem(DOMAIN_STORAGE_KEY, JSON.stringify(snapshot));
  window.localStorage.setItem(
    LEGACY_GAMES_STORAGE_KEY,
    JSON.stringify([{ id: "legacy-only", title: "Legacy", pgn: PGN }]),
  );
  writeDomainAuthority(window.localStorage, {
    migratedAt: NOW,
    backupKey: "backup-ui",
    previewToken: "sha256:ui-migration",
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  seedDomain();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("Import s autoritativnim domenskim repositoryjem", () => {
  test("cita domensku biblioteku i ne prikazuje legacy partiju", async () => {
    render(
      <MemoryRouter>
        <Import />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("button", {
        name: "1. UI domena: Ana - Marko",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("Legacy")).toBeNull();
    expect(
      screen.getByText(/Domenska biblioteka je autoritativni izvor/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ukloni" }).disabled).toBe(
      true,
    );
  });

  test("sigurna izmjena zapisuje domenu i ostavlja legacy netaknut", async () => {
    const legacyBefore = window.localStorage.getItem(
      LEGACY_GAMES_STORAGE_KEY,
    );
    render(
      <MemoryRouter>
        <Import />
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "1. UI domena: Ana - Marko",
      }),
    );
    fireEvent.change(screen.getByPlaceholderText(/ime turnira/), {
      target: { value: "Promijenjeni UI turnir" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Spremi promjene u odabranu partiju",
      }),
    );

    await screen.findByText("Promjene su spremljene u domensku biblioteku.");
    await waitFor(() => {
      const snapshot = JSON.parse(
        window.localStorage.getItem(DOMAIN_STORAGE_KEY),
      );
      expect(snapshot.games[0].headers.Event).toBe(
        "Promijenjeni UI turnir",
      );
    });
    expect(window.localStorage.getItem(LEGACY_GAMES_STORAGE_KEY)).toBe(
      legacyBefore,
    );
    expect(window.localStorage.getItem(DATA_AUTHORITY_STORAGE_KEY)).not.toBeNull();
  });
});
