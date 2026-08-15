import { afterEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import PgnSaver from "./Pgnsaver";

afterEach(() => {
  cleanup();
  delete window.showSaveFilePicker;
  vi.restoreAllMocks();
});

describe("PGN dijalog za spremanje", () => {
  test("sustavski dijalog sprema s odabranim imenom i putanjom", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    window.showSaveFilePicker = vi.fn().mockResolvedValue({
      name: "odabrana-partija.pgn",
      createWritable,
    });
    const onSave = vi.fn();

    render(
      <PgnSaver
        pgnText={'[Event "Test"]\n\n1. e4'}
        fileName="predlozena.pgn"
        buttonText="Spremi test"
        showSaveDialog
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Spremi test" }));

    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(window.showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "chesscare-pgn-export",
        startIn: "documents",
        suggestedName: "predlozena.pgn",
      }),
    );
    expect(createWritable).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(expect.any(Blob));
    expect(onSave).toHaveBeenCalledWith("odabrana-partija.pgn");
  });

  test("otkazivanje dijaloga ne pokrece spremanje", async () => {
    const cancelled = new Error("Korisnik je otkazao spremanje.");
    cancelled.name = "AbortError";
    window.showSaveFilePicker = vi.fn().mockRejectedValue(cancelled);
    const onSave = vi.fn();

    render(
      <PgnSaver
        pgnText="1. d4"
        buttonText="Spremi test"
        showSaveDialog
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Spremi test" }));

    await waitFor(() =>
      expect(window.showSaveFilePicker).toHaveBeenCalledOnce(),
    );
    expect(onSave).not.toHaveBeenCalled();
  });
});
