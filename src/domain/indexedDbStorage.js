export const CHESSCARE_DATABASE_NAME = "chesscare";
export const CHESSCARE_DATABASE_VERSION = 1;
export const DOMAIN_SNAPSHOTS_STORE = "domainSnapshots";
export const MIGRATION_BACKUPS_STORE = "migrationBackups";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), {
      once: true,
    });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error || new Error("IndexedDB transakcija je prekinuta.")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error || new Error("IndexedDB transakcija nije uspjela.")),
      { once: true },
    );
  });
}

export function openChesscareDatabase(indexedDBFactory, options = {}) {
  if (!indexedDBFactory || typeof indexedDBFactory.open !== "function") {
    throw new TypeError("IndexedDB nije dostupan u ovom pregledniku.");
  }

  const databaseName = options.databaseName || CHESSCARE_DATABASE_NAME;
  const request = indexedDBFactory.open(
    databaseName,
    CHESSCARE_DATABASE_VERSION,
  );

  request.addEventListener("upgradeneeded", () => {
    const database = request.result;

    if (!database.objectStoreNames.contains(DOMAIN_SNAPSHOTS_STORE)) {
      database.createObjectStore(DOMAIN_SNAPSHOTS_STORE);
    }
    if (!database.objectStoreNames.contains(MIGRATION_BACKUPS_STORE)) {
      database.createObjectStore(MIGRATION_BACKUPS_STORE);
    }
  });

  return requestResult(request);
}

export function createIndexedDbKeyValueStore(
  indexedDBFactory,
  storeName,
  options = {},
) {
  let databasePromise;

  const getDatabase = () => {
    databasePromise ??= openChesscareDatabase(indexedDBFactory, options);
    return databasePromise;
  };

  return Object.freeze({
    async get(key) {
      const database = await getDatabase();
      const transaction = database.transaction(storeName, "readonly");
      const completed = transactionComplete(transaction);
      const result = await requestResult(transaction.objectStore(storeName).get(key));
      await completed;
      return result;
    },

    async put(key, value) {
      const database = await getDatabase();
      const transaction = database.transaction(storeName, "readwrite");
      const completed = transactionComplete(transaction);
      transaction.objectStore(storeName).put(structuredClone(value), key);
      await completed;
    },

    async delete(key) {
      const database = await getDatabase();
      const transaction = database.transaction(storeName, "readwrite");
      const completed = transactionComplete(transaction);
      transaction.objectStore(storeName).delete(key);
      await completed;
    },

    async keys() {
      const database = await getDatabase();
      const transaction = database.transaction(storeName, "readonly");
      const completed = transactionComplete(transaction);
      const result = await requestResult(
        transaction.objectStore(storeName).getAllKeys(),
      );
      await completed;
      return result;
    },

    async close() {
      if (!databasePromise) return;
      const database = await databasePromise;
      database.close();
      databasePromise = undefined;
    },
  });
}

export function createIndexedDbMigrationBackupStore(
  indexedDBFactory,
  options = {},
) {
  const values = createIndexedDbKeyValueStore(
    indexedDBFactory,
    MIGRATION_BACKUPS_STORE,
    options,
  );

  return Object.freeze({
    save: (key, backup) => values.put(key, backup),
    get: (key) => values.get(key),
    keys: () => values.keys(),
    close: () => values.close(),
  });
}

export function createLocalStorageMigrationBackupStore(storage) {
  if (!storage || typeof storage.setItem !== "function") {
    throw new TypeError("Storage mora podrzavati setItem.");
  }

  return Object.freeze({
    async save(key, backup) {
      storage.setItem(key, JSON.stringify(backup));
    },
    async get(key) {
      const serialized = storage.getItem(key);
      return serialized === null ? undefined : JSON.parse(serialized);
    },
    async keys() {
      return Array.from({ length: storage.length }, (_, index) => storage.key(index))
        .filter(Boolean);
    },
  });
}

const browserBackupStores = new WeakMap();

export function createBrowserMigrationBackupStore(browserWindow = window) {
  const existing = browserBackupStores.get(browserWindow);
  if (existing) return existing;

  let backupStore;
  if (browserWindow?.indexedDB) {
    backupStore = createIndexedDbMigrationBackupStore(browserWindow.indexedDB);
  } else {
    backupStore = createLocalStorageMigrationBackupStore(
      browserWindow.localStorage,
    );
  }

  browserBackupStores.set(browserWindow, backupStore);
  return backupStore;
}
