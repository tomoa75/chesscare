export const DATA_AUTHORITY_STORAGE_KEY = "chesscare.data-authority.v1";
export const DATA_AUTHORITY_VERSION = 1;

export class DataAuthorityError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "DataAuthorityError";
    this.code = code;
  }
}

function requireStorage(storage) {
  if (
    !storage ||
    typeof storage.getItem !== "function" ||
    typeof storage.setItem !== "function"
  ) {
    throw new TypeError("Storage mora podrzavati getItem i setItem.");
  }
}

export function readDataAuthority(storage) {
  requireStorage(storage);
  const serialized = storage.getItem(DATA_AUTHORITY_STORAGE_KEY);

  if (serialized === null) {
    return Object.freeze({ version: DATA_AUTHORITY_VERSION, authority: "legacy" });
  }

  let value;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new DataAuthorityError(
      "invalid-authority-marker",
      "Marker autoritativnog izvora nije valjani JSON.",
      { cause: error },
    );
  }

  if (
    !value ||
    value.version !== DATA_AUTHORITY_VERSION ||
    value.authority !== "domain" ||
    typeof value.migratedAt !== "string" ||
    typeof value.backupKey !== "string" ||
    typeof value.previewToken !== "string"
  ) {
    throw new DataAuthorityError(
      "invalid-authority-marker",
      "Marker autoritativnog izvora nema podrzani oblik.",
    );
  }

  return Object.freeze(structuredClone(value));
}

export function isLegacyStorageWritable(storage) {
  try {
    return readDataAuthority(storage).authority === "legacy";
  } catch {
    return false;
  }
}

export function createDomainAuthorityMarker(input) {
  return {
    version: DATA_AUTHORITY_VERSION,
    authority: "domain",
    migratedAt: input.migratedAt,
    backupKey: input.backupKey,
    previewToken: input.previewToken,
  };
}

export function writeDomainAuthority(storage, input) {
  requireStorage(storage);
  const marker = createDomainAuthorityMarker(input);
  storage.setItem(DATA_AUTHORITY_STORAGE_KEY, JSON.stringify(marker));
  return Object.freeze(structuredClone(marker));
}
