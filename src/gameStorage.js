import {
  DATA_AUTHORITY_STORAGE_KEY,
  isLegacyStorageWritable,
} from "./domain/dataAuthority.js";

export { isLegacyStorageWritable } from "./domain/dataAuthority.js";

export const SAVED_GAMES_STORAGE_KEY = "chesscare.savedGames";
export const SAVED_GAMES_CHANGED_EVENT = "chesscare:saved-games-changed";

export function loadSavedGames() {
  try {
    const storedGames = localStorage.getItem(SAVED_GAMES_STORAGE_KEY);
    const parsedGames = storedGames ? JSON.parse(storedGames) : [];

    return Array.isArray(parsedGames)
      ? parsedGames.filter((game) => game?.id && game?.pgn)
      : [];
  } catch {
    return [];
  }
}

export function saveSavedGames(games) {
  if (!isLegacyStorageWritable(localStorage)) {
    throw new Error(
      `Legacy zbirka je read-only nakon aktivacije '${DATA_AUTHORITY_STORAGE_KEY}'.`,
    );
  }

  localStorage.setItem(SAVED_GAMES_STORAGE_KEY, JSON.stringify(games));
  window.dispatchEvent(new Event(SAVED_GAMES_CHANGED_EVENT));
}

export function subscribeToSavedGames(callback) {
  const handleChange = () => callback(loadSavedGames());
  const handleStorage = (event) => {
    if (event.key === SAVED_GAMES_STORAGE_KEY) {
      handleChange();
    }
  };

  window.addEventListener(SAVED_GAMES_CHANGED_EVENT, handleChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(SAVED_GAMES_CHANGED_EVENT, handleChange);
    window.removeEventListener("storage", handleStorage);
  };
}
