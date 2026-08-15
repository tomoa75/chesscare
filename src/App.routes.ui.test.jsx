import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import App from "./App";

const NEW_ROUTES = [
  ["/library", "Biblioteka partija"],
  ["/analysis-jobs", "Status analiza"],
  ["/players", "Profil igraca"],
  ["/player-identities", "Identiteti igraca"],
  ["/training-plan", "Personalizirani trening"],
  ["/training-session", "Vjezbaj svoje pozicije"],
  ["/training-progress", "Napredak treninga"],
  ["/development", "Domenski read-only izvjestaj"],
];

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("nove aplikacijske rute", () => {
  test.each(NEW_ROUTES)(
    "%s prikazuje ocekivani prazan prikaz bez pisanja u storage",
    async (path, heading) => {
      window.location.hash = path;

      render(<App />);

      expect(
        await screen.findByRole(
          "heading",
          { name: heading },
          { timeout: 10_000 },
        ),
      ).toBeTruthy();
      expect(window.localStorage.length).toBe(0);
    },
  );

  test("stara ruta statistike vodi na novi trajni prikaz analiza", async () => {
    window.location.hash = "/statistics";

    render(<App />);

    expect(
      await screen.findByRole(
        "heading",
        { name: "Status analiza" },
        { timeout: 10_000 },
      ),
    ).toBeTruthy();
    expect(window.location.hash).toBe("#/analysis-jobs");
    expect(window.localStorage.length).toBe(0);
  });

  test("stara trening ruta bez partije vodi u personaliziranu sesiju", async () => {
    window.location.hash = "/training";

    render(<App />);

    expect(
      await screen.findByRole(
        "heading",
        { name: "Vjezbaj svoje pozicije" },
        { timeout: 10_000 },
      ),
    ).toBeTruthy();
    expect(window.location.hash).toBe("#/training-session");
  });

  test("stara trening poveznica s gameId cuva partiju u analizi pozicije", async () => {
    window.location.hash = "/training?gameId=game-bookmark";

    render(<App />);

    await waitFor(() => {
      expect(window.location.hash).toBe(
        "#/position-analysis?gameId=game-bookmark",
      );
    });
  });
});
