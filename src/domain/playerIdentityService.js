import {
  createPlayer,
  normalizePlayerAlias,
  playerMatchesAlias,
} from "./player.js";
import { sha256Hex, stableStringify } from "./stableHash.js";

export class PlayerIdentityError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "PlayerIdentityError";
    this.code = code;
  }
}

function requireRepository(options, requireWrite = false) {
  if (!options?.repository?.readSnapshot) {
    throw new TypeError("Repozitorij mora podrzavati readSnapshot.");
  }
  if (requireWrite && !options.repository.replaceSnapshot) {
    throw new TypeError("Repozitorij mora podrzavati replaceSnapshot.");
  }
}

function referenceTime(value) {
  const date = new Date(value);
  if (typeof value !== "string" || Number.isNaN(date.getTime())) {
    throw new TypeError("Vrijeme previewa mora biti valjani ISO datum.");
  }
  return date.toISOString();
}

function meaningfulName(value) {
  return typeof value === "string" && value.trim() && value.trim() !== "?";
}

function canonicalTokens(value, foldDiacritics = false) {
  let normalized = normalizePlayerAlias(value);
  if (foldDiacritics) {
    normalized = normalized.normalize("NFD").replace(/\p{M}/gu, "");
  }
  return normalized
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join("|");
}

function possibleMatch(left, right) {
  const exactLeft = canonicalTokens(left.displayName);
  const exactRight = canonicalTokens(right.displayName);
  const foldedLeft = canonicalTokens(left.displayName, true);
  const foldedRight = canonicalTokens(right.displayName, true);

  if (exactLeft.includes("|") && exactLeft === exactRight) {
    return "same-tokens-different-order-or-punctuation";
  }
  if (foldedLeft.includes("|") && foldedLeft === foldedRight) {
    return "possible-diacritic-variant";
  }
  return null;
}

function aliasOwners(players) {
  const owners = new Map();
  for (const player of players) {
    for (const alias of player.aliases) {
      const normalized = normalizePlayerAlias(alias);
      const current = owners.get(normalized) || [];
      if (!current.includes(player.id)) current.push(player.id);
      owners.set(normalized, current);
    }
  }
  return owners;
}

function collectionCount(collection, playerId) {
  return collection.filter((item) => item.playerId === playerId).length;
}

function profileView(player, snapshot) {
  const gameLinks = snapshot.games.reduce(
    (count, game) =>
      count +
      Number(game.players.whitePlayerId === player.id) +
      Number(game.players.blackPlayerId === player.id),
    0,
  );

  return {
    id: player.id,
    displayName: player.displayName,
    aliases: [...player.aliases],
    references: {
      gameLinks,
      moveAnalyses: collectionCount(snapshot.moveAnalyses, player.id),
      trainingTasks: collectionCount(snapshot.trainingTasks, player.id),
      trainingAttempts: collectionCount(
        snapshot.trainingAttempts,
        player.id,
      ),
    },
  };
}

function headerOccurrences(snapshot, owners) {
  const occurrences = [];
  for (const game of snapshot.games) {
    for (const [color, header] of [
      ["white", "White"],
      ["black", "Black"],
    ]) {
      const sourceName = game.headers[header];
      if (!meaningfulName(sourceName)) continue;
      const normalizedName = normalizePlayerAlias(sourceName);
      const playerId =
        color === "white"
          ? game.players.whitePlayerId
          : game.players.blackPlayerId;
      occurrences.push({
        gameId: game.id,
        gameTitle: game.title,
        color,
        sourceName,
        normalizedName,
        linkedPlayerId: playerId,
        aliasOwnerIds: [...(owners.get(normalizedName) || [])],
      });
    }
  }
  return occurrences;
}

function unresolvedNames(occurrences) {
  const groups = new Map();
  for (const occurrence of occurrences) {
    const unresolved =
      !occurrence.linkedPlayerId && occurrence.aliasOwnerIds.length === 0;
    if (!unresolved) continue;
    const current = groups.get(occurrence.normalizedName) || {
      normalizedName: occurrence.normalizedName,
      sourceNames: [],
      occurrences: [],
    };
    if (!current.sourceNames.includes(occurrence.sourceName)) {
      current.sourceNames.push(occurrence.sourceName);
    }
    current.occurrences.push(occurrence);
    groups.set(occurrence.normalizedName, current);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      displayName: group.sourceNames[0],
      count: group.occurrences.length,
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.displayName.localeCompare(right.displayName),
    );
}

export async function loadPlayerIdentityDashboard(options) {
  requireRepository(options);
  const snapshot = await options.repository.readSnapshot();
  const owners = aliasOwners(snapshot.players);
  const occurrences = headerOccurrences(snapshot, owners);
  const possibleMatches = [];

  for (let leftIndex = 0; leftIndex < snapshot.players.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < snapshot.players.length;
      rightIndex += 1
    ) {
      const left = snapshot.players[leftIndex];
      const right = snapshot.players[rightIndex];
      const reason = possibleMatch(left, right);
      if (reason) {
        possibleMatches.push({
          leftPlayerId: left.id,
          leftDisplayName: left.displayName,
          rightPlayerId: right.id,
          rightDisplayName: right.displayName,
          reason,
          action: "manual-review",
        });
      }
    }
  }

  return {
    players: snapshot.players
      .map((player) => profileView(player, snapshot))
      .sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      ),
    unresolvedNames: unresolvedNames(occurrences),
    possibleMatches,
    conflicts: [...owners.entries()]
      .filter(([, playerIds]) => playerIds.length > 1)
      .map(([normalizedAlias, playerIds]) => ({
        code: "alias-owned-by-multiple-profiles",
        normalizedAlias,
        playerIds,
      })),
    summary: {
      players: snapshot.players.length,
      aliases: snapshot.players.reduce(
        (total, player) => total + player.aliases.length,
        0,
      ),
      unresolvedNames: unresolvedNames(occurrences).length,
      possibleMatches: possibleMatches.length,
    },
  };
}

async function token(snapshot, request) {
  return `sha256:${await sha256Hex(
    stableStringify({ snapshot, request }),
  )}`;
}

function requireAliasOptions(options) {
  requireRepository(options);
  if (typeof options.playerId !== "string" || !options.playerId.trim()) {
    throw new TypeError("ID profila mora biti neprazan string.");
  }
  if (typeof options.alias !== "string" || !options.alias.trim()) {
    throw new TypeError("Alias mora biti neprazan string.");
  }
}

export async function createAliasConfirmationPreview(options) {
  requireAliasOptions(options);
  const playerId = options.playerId.trim();
  const alias = options.alias.trim();
  const normalizedAlias = normalizePlayerAlias(alias);
  const now = referenceTime(
    options.referenceTime || new Date().toISOString(),
  );
  const snapshot = await options.repository.readSnapshot();
  const player = snapshot.players.find((item) => item.id === playerId);
  if (!player) {
    throw new PlayerIdentityError(
      "player-not-found",
      `Profil '${playerId}' ne postoji.`,
    );
  }

  const owners = aliasOwners(snapshot.players);
  const ownerIds = owners.get(normalizedAlias) || [];
  const linkedToOther = headerOccurrences(snapshot, owners).filter(
    (occurrence) =>
      occurrence.normalizedName === normalizedAlias &&
      occurrence.linkedPlayerId &&
      occurrence.linkedPlayerId !== player.id,
  );
  const conflicts = [
    ...ownerIds
      .filter((ownerId) => ownerId !== player.id)
      .map((ownerId) => ({
        code: "alias-owned-by-other-profile",
        playerId: ownerId,
        message: `Alias vec pripada profilu '${ownerId}'.`,
      })),
    ...linkedToOther.map((occurrence) => ({
      code: "header-linked-to-other-profile",
      playerId: occurrence.linkedPlayerId,
      gameId: occurrence.gameId,
      color: occurrence.color,
      message: `PGN ime je vec povezano s drugim profilom u partiji '${occurrence.gameTitle}'.`,
    })),
  ];
  const alreadyConfirmed = playerMatchesAlias(player, alias);
  const occurrences = headerOccurrences(snapshot, owners).filter(
    (occurrence) => occurrence.normalizedName === normalizedAlias,
  );
  const request = { playerId, alias, referenceTime: now };

  return {
    token: await token(snapshot, request),
    referenceTime: now,
    player: profileView(player, snapshot),
    alias,
    normalizedAlias,
    alreadyConfirmed,
    conflicts,
    occurrences,
    summary: {
      occurrences: occurrences.length,
      conflicts: conflicts.length,
    },
    canConfirm: !alreadyConfirmed && conflicts.length === 0,
  };
}

export async function confirmPlayerAlias(options) {
  requireRepository(options, true);
  requireAliasOptions(options);
  if (typeof options.previewToken !== "string" || !options.previewToken.trim()) {
    throw new PlayerIdentityError(
      "confirmation-required",
      "Dodavanje aliasa zahtijeva token previewa.",
    );
  }
  const snapshot = await options.repository.readSnapshot();
  const player = snapshot.players.find(
    (item) => item.id === options.playerId.trim(),
  );
  if (player && playerMatchesAlias(player, options.alias)) {
    return { status: "already-confirmed", player };
  }

  const preview = await createAliasConfirmationPreview(options);
  if (preview.token !== options.previewToken) {
    throw new PlayerIdentityError(
      "stale-preview",
      "Domenski podaci promijenili su se nakon previewa.",
    );
  }
  if (!preview.canConfirm) {
    throw new PlayerIdentityError(
      "alias-confirmation-blocked",
      "Alias ima konflikt ili je vec potvrden.",
    );
  }

  const finalSnapshot = await options.repository.readSnapshot();
  const finalToken = await token(finalSnapshot, {
    playerId: preview.player.id,
    alias: preview.alias,
    referenceTime: preview.referenceTime,
  });
  if (finalToken !== preview.token) {
    throw new PlayerIdentityError(
      "stale-preview",
      "Domenski podaci promijenili su se prije spremanja aliasa.",
    );
  }
  const playerIndex = finalSnapshot.players.findIndex(
    (item) => item.id === preview.player.id,
  );
  const updated = createPlayer({
    ...finalSnapshot.players[playerIndex],
    aliases: [...finalSnapshot.players[playerIndex].aliases, preview.alias],
    updatedAt: preview.referenceTime,
  });
  finalSnapshot.players[playerIndex] = updated;
  await options.repository.replaceSnapshot(finalSnapshot);

  return { status: "confirmed", player: updated };
}

function requireMergeOptions(options) {
  requireRepository(options);
  if (
    typeof options.sourcePlayerId !== "string" ||
    !options.sourcePlayerId.trim() ||
    typeof options.targetPlayerId !== "string" ||
    !options.targetPlayerId.trim()
  ) {
    throw new TypeError("Izvorni i ciljni profil moraju imati ID.");
  }
  if (options.sourcePlayerId.trim() === options.targetPlayerId.trim()) {
    throw new TypeError("Izvorni i ciljni profil moraju biti razliciti.");
  }
}

export async function createPlayerMergePreview(options) {
  requireMergeOptions(options);
  const sourcePlayerId = options.sourcePlayerId.trim();
  const targetPlayerId = options.targetPlayerId.trim();
  const now = referenceTime(
    options.referenceTime || new Date().toISOString(),
  );
  const snapshot = await options.repository.readSnapshot();
  const source = snapshot.players.find((item) => item.id === sourcePlayerId);
  const target = snapshot.players.find((item) => item.id === targetPlayerId);
  if (!source || !target) {
    throw new PlayerIdentityError(
      "player-not-found",
      "Izvorni ili ciljni profil ne postoji.",
    );
  }

  const ambiguousGames = snapshot.games
    .filter((game) => {
      const ids = [
        game.players.whitePlayerId,
        game.players.blackPlayerId,
      ];
      return ids.includes(source.id) && ids.includes(target.id);
    })
    .map((game) => ({
      code: "merge-would-link-both-colors",
      gameId: game.id,
      message: `Profili igraju jedan protiv drugoga u partiji '${game.title}'.`,
    }));
  const owners = aliasOwners(snapshot.players);
  const thirdPartyAliasConflicts = source.aliases.flatMap((alias) =>
    (owners.get(normalizePlayerAlias(alias)) || [])
      .filter((playerId) => playerId !== source.id && playerId !== target.id)
      .map((playerId) => ({
        code: "source-alias-owned-by-third-profile",
        playerId,
        alias,
        message: `Alias '${alias}' pripada i trecem profilu '${playerId}'.`,
      })),
  );
  const conflicts = [...ambiguousGames, ...thirdPartyAliasConflicts];
  const request = {
    sourcePlayerId,
    targetPlayerId,
    referenceTime: now,
  };

  return {
    token: await token(snapshot, request),
    referenceTime: now,
    source: profileView(source, snapshot),
    target: profileView(target, snapshot),
    mergedAliases: createPlayer({
      ...target,
      aliases: [...target.aliases, ...source.aliases],
      updatedAt: now,
    }).aliases,
    conflicts,
    changes: {
      gameLinks: snapshot.games.reduce(
        (count, game) =>
          count +
          Number(game.players.whitePlayerId === source.id) +
          Number(game.players.blackPlayerId === source.id),
        0,
      ),
      moveAnalyses: collectionCount(snapshot.moveAnalyses, source.id),
      trainingTasks: collectionCount(snapshot.trainingTasks, source.id),
      trainingAttempts: collectionCount(
        snapshot.trainingAttempts,
        source.id,
      ),
      aliasesAdded: source.aliases.filter(
        (alias) => !playerMatchesAlias(target, alias),
      ).length,
    },
    canMerge: conflicts.length === 0,
  };
}

function reassignPlayer(collection, sourcePlayerId, targetPlayerId) {
  return collection.map((item) =>
    item.playerId === sourcePlayerId
      ? { ...item, playerId: targetPlayerId }
      : item,
  );
}

export async function confirmPlayerMerge(options) {
  requireRepository(options, true);
  requireMergeOptions(options);
  if (typeof options.previewToken !== "string" || !options.previewToken.trim()) {
    throw new PlayerIdentityError(
      "confirmation-required",
      "Spajanje profila zahtijeva token previewa.",
    );
  }
  const initialSnapshot = await options.repository.readSnapshot();
  const sourceExists = initialSnapshot.players.some(
    (player) => player.id === options.sourcePlayerId.trim(),
  );
  const targetExists = initialSnapshot.players.some(
    (player) => player.id === options.targetPlayerId.trim(),
  );
  if (!sourceExists && targetExists) {
    return { status: "already-merged", targetPlayerId: options.targetPlayerId };
  }

  const preview = await createPlayerMergePreview(options);
  if (preview.token !== options.previewToken) {
    throw new PlayerIdentityError(
      "stale-preview",
      "Domenski podaci promijenili su se nakon previewa.",
    );
  }
  if (!preview.canMerge) {
    throw new PlayerIdentityError(
      "merge-blocked",
      "Profili se ne mogu spojiti zbog konflikta.",
    );
  }

  const snapshot = await options.repository.readSnapshot();
  const finalToken = await token(snapshot, {
    sourcePlayerId: preview.source.id,
    targetPlayerId: preview.target.id,
    referenceTime: preview.referenceTime,
  });
  if (finalToken !== preview.token) {
    throw new PlayerIdentityError(
      "stale-preview",
      "Domenski podaci promijenili su se prije spajanja profila.",
    );
  }
  const targetIndex = snapshot.players.findIndex(
    (player) => player.id === preview.target.id,
  );
  snapshot.players[targetIndex] = createPlayer({
    ...snapshot.players[targetIndex],
    aliases: preview.mergedAliases,
    updatedAt: preview.referenceTime,
  });
  snapshot.players = snapshot.players.filter(
    (player) => player.id !== preview.source.id,
  );
  snapshot.games = snapshot.games.map((game) => ({
    ...game,
    players: {
      whitePlayerId:
        game.players.whitePlayerId === preview.source.id
          ? preview.target.id
          : game.players.whitePlayerId,
      blackPlayerId:
        game.players.blackPlayerId === preview.source.id
          ? preview.target.id
          : game.players.blackPlayerId,
    },
  }));
  snapshot.moveAnalyses = reassignPlayer(
    snapshot.moveAnalyses,
    preview.source.id,
    preview.target.id,
  );
  snapshot.trainingTasks = reassignPlayer(
    snapshot.trainingTasks,
    preview.source.id,
    preview.target.id,
  );
  snapshot.trainingAttempts = reassignPlayer(
    snapshot.trainingAttempts,
    preview.source.id,
    preview.target.id,
  );
  await options.repository.replaceSnapshot(snapshot);

  return {
    status: "merged",
    targetPlayerId: preview.target.id,
    changes: preview.changes,
  };
}
