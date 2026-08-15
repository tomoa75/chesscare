import {
  createAnalysisRun,
  createMoveAnalysis,
  createPositionEvaluation,
} from "./analysis.js";
import { DOMAIN_SCHEMA_VERSION } from "./constants.js";
import { createGame } from "./game.js";
import { createPlayer } from "./player.js";
import {
  createTrainingAttempt,
  createTrainingTask,
} from "./training.js";
import {
  createIndexedDbKeyValueStore,
  DOMAIN_SNAPSHOTS_STORE,
} from "./indexedDbStorage.js";

export const DOMAIN_STORAGE_KEY = "chesscare.domain.v1";
export const DOMAIN_STORAGE_CHANGED_EVENT = "chesscare:domain-storage-changed";

const COLLECTIONS = Object.freeze({
  players: createPlayer,
  games: createGame,
  analysisRuns: createAnalysisRun,
  moveAnalyses: createMoveAnalysis,
  positionEvaluations: createPositionEvaluation,
  trainingTasks: createTrainingTask,
  trainingAttempts: createTrainingAttempt,
});

export class DomainRepositoryError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "DomainRepositoryError";
    this.code = code;
  }
}

function clone(value) {
  return structuredClone(value);
}

function validateCollection(snapshot, collectionName) {
  const collection = snapshot[collectionName];

  if (!Array.isArray(collection)) {
    throw new DomainRepositoryError(
      "invalid-snapshot",
      `${collectionName} mora biti polje.`,
    );
  }

  const createEntity = COLLECTIONS[collectionName];
  const validated = collection.map((entity, index) => {
    try {
      return createEntity(entity);
    } catch (error) {
      throw new DomainRepositoryError(
        "invalid-entity",
        `${collectionName}[${index}] nije valjani domenski zapis.`,
        { cause: error },
      );
    }
  });
  const ids = new Set();

  for (const entity of validated) {
    if (ids.has(entity.id)) {
      throw new DomainRepositoryError(
        "duplicate-id",
        `${collectionName} sadrzi duplicirani ID '${entity.id}'.`,
      );
    }
    ids.add(entity.id);
  }

  return validated;
}

export function createEmptyDomainSnapshot() {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    players: [],
    games: [],
    analysisRuns: [],
    moveAnalyses: [],
    positionEvaluations: [],
    trainingTasks: [],
    trainingAttempts: [],
  };
}

export function validateDomainSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainRepositoryError(
      "invalid-snapshot",
      "Domenski snapshot mora biti objekt.",
    );
  }

  if (value.schemaVersion !== DOMAIN_SCHEMA_VERSION) {
    throw new DomainRepositoryError(
      "unsupported-schema-version",
      `Nepodrzana verzija domenske sheme: ${String(value.schemaVersion)}.`,
    );
  }

  const compatibleValue = {
    ...value,
    positionEvaluations: value.positionEvaluations ?? [],
    trainingTasks: value.trainingTasks ?? [],
    trainingAttempts: value.trainingAttempts ?? [],
  };

  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    players: validateCollection(compatibleValue, "players"),
    games: validateCollection(compatibleValue, "games"),
    analysisRuns: validateCollection(compatibleValue, "analysisRuns"),
    moveAnalyses: validateCollection(compatibleValue, "moveAnalyses"),
    positionEvaluations: validateCollection(
      compatibleValue,
      "positionEvaluations",
    ),
    trainingTasks: validateCollection(compatibleValue, "trainingTasks"),
    trainingAttempts: validateCollection(
      compatibleValue,
      "trainingAttempts",
    ),
  };
}

function createRepository(readState, writeState) {
  async function readSnapshot() {
    return clone(validateDomainSnapshot(await readState()));
  }

  async function replaceSnapshot(snapshot) {
    const validated = validateDomainSnapshot(snapshot);
    await writeState(clone(validated));
    return clone(validated);
  }

  async function list(collectionName) {
    const snapshot = await readSnapshot();
    return snapshot[collectionName];
  }

  async function get(collectionName, id) {
    const entities = await list(collectionName);
    return entities.find((entity) => entity.id === id) || null;
  }

  async function save(collectionName, entity) {
    const createEntity = COLLECTIONS[collectionName];
    const validatedEntity = createEntity(entity);
    const snapshot = await readSnapshot();
    const existingIndex = snapshot[collectionName].findIndex(
      (item) => item.id === validatedEntity.id,
    );

    if (existingIndex === -1) {
      snapshot[collectionName].push(validatedEntity);
    } else {
      snapshot[collectionName][existingIndex] = validatedEntity;
    }

    await replaceSnapshot(snapshot);
    return clone(validatedEntity);
  }

  async function remove(collectionName, id) {
    const snapshot = await readSnapshot();
    const remaining = snapshot[collectionName].filter(
      (entity) => entity.id !== id,
    );
    const removed = remaining.length !== snapshot[collectionName].length;

    if (removed) {
      snapshot[collectionName] = remaining;
      await replaceSnapshot(snapshot);
    }

    return removed;
  }

  return Object.freeze({
    readSnapshot,
    replaceSnapshot,
    listPlayers: () => list("players"),
    getPlayer: (id) => get("players", id),
    savePlayer: (player) => save("players", player),
    removePlayer: (id) => remove("players", id),
    listGames: () => list("games"),
    getGame: (id) => get("games", id),
    saveGame: (game) => save("games", game),
    removeGame: (id) => remove("games", id),
    listAnalysisRuns: () => list("analysisRuns"),
    getAnalysisRun: (id) => get("analysisRuns", id),
    saveAnalysisRun: (analysisRun) => save("analysisRuns", analysisRun),
    removeAnalysisRun: (id) => remove("analysisRuns", id),
    listMoveAnalyses: () => list("moveAnalyses"),
    getMoveAnalysis: (id) => get("moveAnalyses", id),
    saveMoveAnalysis: (moveAnalysis) =>
      save("moveAnalyses", moveAnalysis),
    removeMoveAnalysis: (id) => remove("moveAnalyses", id),
    listPositionEvaluations: () => list("positionEvaluations"),
    getPositionEvaluation: (id) => get("positionEvaluations", id),
    savePositionEvaluation: (evaluation) =>
      save("positionEvaluations", evaluation),
    removePositionEvaluation: (id) => remove("positionEvaluations", id),
    listTrainingTasks: () => list("trainingTasks"),
    getTrainingTask: (id) => get("trainingTasks", id),
    saveTrainingTask: (task) => save("trainingTasks", task),
    removeTrainingTask: (id) => remove("trainingTasks", id),
    listTrainingAttempts: () => list("trainingAttempts"),
    getTrainingAttempt: (id) => get("trainingAttempts", id),
    saveTrainingAttempt: (attempt) =>
      save("trainingAttempts", attempt),
    removeTrainingAttempt: (id) => remove("trainingAttempts", id),
  });
}

export function createMemoryDomainRepository(initialSnapshot) {
  let state = validateDomainSnapshot(
    initialSnapshot ?? createEmptyDomainSnapshot(),
  );

  return createRepository(
    async () => state,
    async (nextState) => {
      state = nextState;
    },
  );
}

function requireStorage(storage) {
  if (
    !storage ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function"
  ) {
    throw new TypeError("Storage mora podrzavati getItem i setItem.");
  }

  return storage;
}

export function createLocalStorageDomainRepository(
  storage,
  options = {},
) {
  const safeStorage = requireStorage(storage);
  const key = options.key || DOMAIN_STORAGE_KEY;

  return createRepository(
    async () => {
      const serialized = safeStorage.getItem(key);
      if (serialized === null) return createEmptyDomainSnapshot();

      try {
        return validateDomainSnapshot(JSON.parse(serialized));
      } catch (error) {
        if (error instanceof DomainRepositoryError) throw error;

        throw new DomainRepositoryError(
          "invalid-json",
          `Domenska pohrana '${key}' ne sadrzi valjani JSON.`,
          { cause: error },
        );
      }
    },
    async (snapshot) => {
      safeStorage.setItem(key, JSON.stringify(snapshot));
      if (
        typeof window !== "undefined" &&
        typeof window.dispatchEvent === "function" &&
        typeof window.CustomEvent === "function"
      ) {
        window.dispatchEvent(
          new window.CustomEvent(DOMAIN_STORAGE_CHANGED_EVENT, {
            detail: { key },
          }),
        );
      }
    },
  );
}

export function createIndexedDbDomainRepository(
  indexedDBFactory,
  options = {},
) {
  const key = options.key || DOMAIN_STORAGE_KEY;
  const fallbackStorage = options.fallbackStorage;
  const values = createIndexedDbKeyValueStore(
    indexedDBFactory,
    DOMAIN_SNAPSHOTS_STORE,
    options,
  );
  let promotionPromise;

  const removeFallbackSnapshot = () => {
    if (typeof fallbackStorage?.removeItem === "function") {
      fallbackStorage.removeItem(key);
    }
  };

  const readIndexedDbSnapshot = async () => {
    const stored = await values.get(key);
    if (stored !== undefined) return stored;
    if (!fallbackStorage || typeof fallbackStorage.getItem !== "function") {
      return createEmptyDomainSnapshot();
    }

    promotionPromise ??= (async () => {
      const serialized = fallbackStorage.getItem(key);
      if (serialized === null) return createEmptyDomainSnapshot();

      let snapshot;
      try {
        snapshot = validateDomainSnapshot(JSON.parse(serialized));
      } catch (error) {
        if (error instanceof DomainRepositoryError) throw error;
        throw new DomainRepositoryError(
          "invalid-json",
          `Domenska pohrana '${key}' ne sadrzi valjani JSON.`,
          { cause: error },
        );
      }

      await values.put(key, snapshot);
      removeFallbackSnapshot();
      return snapshot;
    })();

    return promotionPromise;
  };

  return createRepository(
    readIndexedDbSnapshot,
    async (snapshot) => {
      await values.put(key, snapshot);
      removeFallbackSnapshot();
      if (
        typeof window !== "undefined" &&
        typeof window.dispatchEvent === "function" &&
        typeof window.CustomEvent === "function"
      ) {
        window.dispatchEvent(
          new window.CustomEvent(DOMAIN_STORAGE_CHANGED_EVENT, {
            detail: { key },
          }),
        );
      }
    },
  );
}

const browserRepositories = new WeakMap();

export function createBrowserDomainRepository(browserWindow = window) {
  const existing = browserRepositories.get(browserWindow);
  if (existing) return existing;

  let repository;
  if (browserWindow?.indexedDB) {
    repository = createIndexedDbDomainRepository(browserWindow.indexedDB, {
      fallbackStorage: browserWindow.localStorage,
    });
  } else {
    repository = createLocalStorageDomainRepository(browserWindow.localStorage);
  }

  browserRepositories.set(browserWindow, repository);
  return repository;
}

export async function importLegacyAdapterResult(repository, adapterResult) {
  if (
    !adapterResult ||
    !Array.isArray(adapterResult.games) ||
    !Array.isArray(adapterResult.playerSuggestions)
  ) {
    throw new TypeError("Rezultat legacy adaptera nije ispravan.");
  }

  const snapshot = await repository.readSnapshot();
  const existingPlayerIds = new Set(
    snapshot.players.map((player) => player.id),
  );
  const existingGameIds = new Set(snapshot.games.map((game) => game.id));
  const existingFingerprints = new Set(
    snapshot.games
      .map((game) => game.fingerprint)
      .filter((fingerprint) => fingerprint !== null),
  );
  const report = {
    playersAdded: 0,
    playersSkipped: 0,
    gamesAdded: 0,
    gamesSkipped: 0,
    conflicts: [],
  };

  for (const suggestion of adapterResult.playerSuggestions) {
    const player = createPlayer(suggestion.profile);

    if (existingPlayerIds.has(player.id)) {
      report.playersSkipped += 1;
      continue;
    }

    snapshot.players.push(player);
    existingPlayerIds.add(player.id);
    report.playersAdded += 1;
  }

  for (const candidate of adapterResult.games) {
    const game = createGame(candidate);

    if (
      game.fingerprint &&
      existingFingerprints.has(game.fingerprint)
    ) {
      report.gamesSkipped += 1;
      continue;
    }

    if (existingGameIds.has(game.id)) {
      report.gamesSkipped += 1;
      report.conflicts.push({
        code: "game-id-conflict",
        gameId: game.id,
        fingerprint: game.fingerprint,
      });
      continue;
    }

    snapshot.games.push(game);
    existingGameIds.add(game.id);
    if (game.fingerprint) existingFingerprints.add(game.fingerprint);
    report.gamesAdded += 1;
  }

  if (report.playersAdded > 0 || report.gamesAdded > 0) {
    await repository.replaceSnapshot(snapshot);
  }

  return report;
}
