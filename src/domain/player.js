import { DOMAIN_SCHEMA_VERSION } from "./constants.js";
import {
  createDomainId,
  requireIsoDate,
  requireString,
} from "./validation.js";

export function normalizePlayerAlias(value) {
  return requireString(value, "Alias igraca")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function uniqueAliases(displayName, aliases) {
  if (!Array.isArray(aliases)) {
    throw new TypeError("Aliasi igraca moraju biti polje.");
  }

  const seen = new Set();
  const result = [];

  for (const candidate of [displayName, ...aliases]) {
    const alias = requireString(candidate, "Alias igraca");
    const normalizedAlias = normalizePlayerAlias(alias);

    if (!seen.has(normalizedAlias)) {
      seen.add(normalizedAlias);
      result.push(alias);
    }
  }

  return result;
}

export function createPlayer(input, options = {}) {
  const displayName = requireString(input?.displayName, "Ime igraca");
  const now = options.now || new Date().toISOString();
  const createdAt = requireIsoDate(input?.createdAt || now, "createdAt");
  const updatedAt = requireIsoDate(input?.updatedAt || createdAt, "updatedAt");

  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: requireString(input?.id || createDomainId("player"), "ID igraca"),
    displayName,
    aliases: uniqueAliases(displayName, input?.aliases || []),
    createdAt,
    updatedAt,
  };
}

export function playerMatchesAlias(player, candidate) {
  const normalizedCandidate = normalizePlayerAlias(candidate);

  return player.aliases.some(
    (alias) => normalizePlayerAlias(alias) === normalizedCandidate,
  );
}

