import { beforeEach, describe, expect, test } from "vitest";
import {
  DATA_AUTHORITY_STORAGE_KEY,
  writeDomainAuthority,
} from "./domain/dataAuthority";
import {
  SAVED_GAMES_STORAGE_KEY,
  loadSavedGames,
  saveSavedGames,
} from "./gameStorage";

const GAME = { id: "legacy-1", title: "Legacy", pgn: "1. e4 e5" };

beforeEach(() => {
  window.localStorage.clear();
});

describe("legacy storage nakon cutovera", () => {
  test("prije migracije zapisuje legacy zbirku", () => {
    saveSavedGames([GAME]);

    expect(loadSavedGames()).toEqual([GAME]);
  });

  test("nakon migracije ostavlja legacy vrijednost netaknutom", () => {
    window.localStorage.setItem(
      SAVED_GAMES_STORAGE_KEY,
      JSON.stringify([GAME]),
    );
    writeDomainAuthority(window.localStorage, {
      migratedAt: "2026-08-12T12:00:00.000Z",
      backupKey: "backup-1",
      previewToken: "sha256:preview",
    });

    expect(() => saveSavedGames([])).toThrow(/read-only/);
    expect(loadSavedGames()).toEqual([GAME]);
    expect(
      window.localStorage.getItem(DATA_AUTHORITY_STORAGE_KEY),
    ).not.toBeNull();
  });
});
