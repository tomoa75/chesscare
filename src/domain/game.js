import {
  DOMAIN_SCHEMA_VERSION,
  GAME_RESULTS,
} from "./constants.js";
import {
  createDomainId,
  optionalString,
  requireEnum,
  requireIsoDate,
  requireObject,
  requireString,
} from "./validation.js";

function normalizeHeaders(headers) {
  if (headers === undefined || headers === null) return {};
  requireObject(headers, "PGN headeri");

  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([name, value]) => [
        requireString(name, "Naziv PGN headera"),
        String(value).trim(),
      ]),
  );
}

function createGameSource(source = {}) {
  requireObject(source, "Izvor partije");

  return {
    kind: requireEnum(
      source.kind || "manual",
      ["file", "manual", "migration"],
      "Vrsta izvora",
    ),
    fileName: optionalString(source.fileName, "Ime izvorne datoteke"),
  };
}

export function createGame(input, options = {}) {
  const headers = normalizeHeaders(input?.headers);
  const result = input?.result ?? headers.Result ?? "*";
  const importedAt = requireIsoDate(
    input?.importedAt || options.now || new Date().toISOString(),
    "importedAt",
  );

  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: requireString(input?.id || createDomainId("game"), "ID partije"),
    title: requireString(input?.title, "Naslov partije"),
    rawPgn: requireString(input?.rawPgn, "Izvorni PGN"),
    headers,
    players: {
      whitePlayerId: optionalString(
        input?.players?.whitePlayerId,
        "ID bijelog igraca",
      ),
      blackPlayerId: optionalString(
        input?.players?.blackPlayerId,
        "ID crnog igraca",
      ),
    },
    result: requireEnum(result, GAME_RESULTS, "Rezultat partije"),
    source: createGameSource(input?.source),
    fingerprint: optionalString(input?.fingerprint, "Fingerprint partije"),
    importedAt,
  };
}
