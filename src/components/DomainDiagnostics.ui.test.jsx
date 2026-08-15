import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import DomainDiagnostics from "./DomainDiagnostics";
import {
  DOMAIN_BACKUP_KEY_PREFIX,
  LEGACY_GAMES_STORAGE_KEY,
} from "../domain/legacyMigrationService";
import { DOMAIN_STORAGE_KEY } from "../domain/repository";

const VALID_PGN = [
  '[Event "UI migracija"]',
  '[White "Ana Horvat"]',
  '[Black "Marko Marić"]',
  '[Result "1-0"]',
  "",
  "1. e4 e5 2. Nf3 Nc6 1-0",
].join("\n");

function legacyRecord(id = "legacy-ui-1") {
  return {
    id,
    title: "UI migracija",
    pgn: VALID_PGN,
  };
}

function backupKeys() {
  return Array.from(
    { length: window.localStorage.length },
    (_, index) => window.localStorage.key(index),
  ).filter((key) => key?.startsWith(DOMAIN_BACKUP_KEY_PREFIX));
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("kontrolirana legacy migracija u dijagnostici", () => {
  test("preview je read-only, a potvrda sprema backup prije domene", async () => {
    const legacyValue = JSON.stringify([legacyRecord()]);
    window.localStorage.setItem(LEGACY_GAMES_STORAGE_KEY, legacyValue);

    render(<DomainDiagnostics />);

    await screen.findByRole("heading", {
      name: "Domenski read-only izvjestaj",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Pripremi preview" }),
    );

    await screen.findByText("Novi igraci");
    const confirmButton = screen.getByRole("button", {
      name: "Potvrdi i migriraj",
    });

    expect(confirmButton.disabled).toBe(true);
    expect(window.localStorage.getItem(DOMAIN_STORAGE_KEY)).toBeNull();
    expect(backupKeys()).toHaveLength(0);

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Potvrdujem migraciju prikazanih zapisa/,
      }),
    );
    expect(confirmButton.disabled).toBe(false);
    fireEvent.click(confirmButton);

    await screen.findByText("Migracija je zavrsena.");
    expect(
      screen.getByText("novi domenski repository"),
    ).toBeTruthy();

    const savedDomain = JSON.parse(
      window.localStorage.getItem(DOMAIN_STORAGE_KEY),
    );
    const savedBackupKeys = backupKeys();

    expect(savedDomain.players).toHaveLength(2);
    expect(savedDomain.games).toHaveLength(1);
    expect(savedBackupKeys).toHaveLength(1);
    expect(window.localStorage.getItem(LEGACY_GAMES_STORAGE_KEY)).toBe(
      legacyValue,
    );

    const backup = JSON.parse(
      window.localStorage.getItem(savedBackupKeys[0]),
    );
    expect(backup.legacyStorageValue).toBe(legacyValue);
    expect(backup.domainStorageValue).toBeNull();
  });

  test("promjena legacy zapisa nakon previewa blokira potvrdu", async () => {
    window.localStorage.setItem(
      LEGACY_GAMES_STORAGE_KEY,
      JSON.stringify([legacyRecord()]),
    );

    render(<DomainDiagnostics />);

    await screen.findByRole("heading", {
      name: "Domenski read-only izvjestaj",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Pripremi preview" }),
    );
    await screen.findByText("Novi igraci");

    window.localStorage.setItem(
      LEGACY_GAMES_STORAGE_KEY,
      JSON.stringify([
        legacyRecord(),
        legacyRecord("legacy-ui-promijenjen"),
      ]),
    );

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Potvrdujem migraciju prikazanih zapisa/,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Potvrdi i migriraj" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Legacy ili domenski podaci promijenili su se nakon previewa.",
        ),
      ).toBeTruthy();
    });
    expect(window.localStorage.getItem(DOMAIN_STORAGE_KEY)).toBeNull();
    expect(backupKeys()).toHaveLength(0);
  });
});
