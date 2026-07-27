const RESULT_LABELS = Object.freeze({
  "1-0": "1-0",
  "0-1": "0-1",
  "1/2-1/2": "Remi",
  "*": "Bez rezultata",
});

function normalizedSearch(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function playerName(game, color, playersById) {
  const playerId =
    color === "white"
      ? game.players.whitePlayerId
      : game.players.blackPlayerId;
  const headerName = game.headers[color === "white" ? "White" : "Black"];

  if (playerId && playersById.has(playerId)) {
    return {
      id: playerId,
      name: playersById.get(playerId).displayName,
      resolved: true,
    };
  }

  return {
    id: playerId,
    name: headerName || (color === "white" ? "Bijeli" : "Crni"),
    resolved: false,
  };
}

function toLibraryGame(game, playersById) {
  const white = playerName(game, "white", playersById);
  const black = playerName(game, "black", playersById);

  return {
    id: game.id,
    title: game.title,
    white,
    black,
    result: game.result,
    resultLabel: RESULT_LABELS[game.result],
    event: game.headers.Event || "Nepoznat dogadaj",
    site: game.headers.Site || null,
    playedAt: game.headers.Date || null,
    opening:
      game.headers.Opening ||
      game.headers.Variation ||
      game.headers.ECO ||
      null,
    importedAt: game.importedAt,
    sourceKind: game.source.kind,
    sourceFileName: game.source.fileName,
    fingerprint: game.fingerprint,
    rawPgn: game.rawPgn,
    unresolvedPlayerReferences:
      Number(!white.resolved) + Number(!black.resolved),
  };
}

function matchesSearch(game, query) {
  if (!query) return true;

  return [
    game.title,
    game.white.name,
    game.black.name,
    game.event,
    game.site,
    game.opening,
  ].some((value) => normalizedSearch(value).includes(query));
}

function compareGames(left, right, sort) {
  if (sort === "title") {
    return left.title.localeCompare(right.title);
  }

  if (sort === "oldest") {
    return left.importedAt.localeCompare(right.importedAt);
  }

  return right.importedAt.localeCompare(left.importedAt);
}

export async function loadDomainGameLibrary(options) {
  if (!options?.repository?.readSnapshot) {
    throw new TypeError("Repozitorij mora podrzavati readSnapshot.");
  }

  const snapshot = await options.repository.readSnapshot();
  const playersById = new Map(
    snapshot.players.map((player) => [player.id, player]),
  );
  const allGames = snapshot.games.map((game) =>
    toLibraryGame(game, playersById),
  );
  const query = normalizedSearch(options.filters?.query);
  const playerId = options.filters?.playerId || "";
  const result = options.filters?.result || "";
  const sort = options.filters?.sort || "newest";
  const games = allGames
    .filter((game) => matchesSearch(game, query))
    .filter(
      (game) =>
        !playerId ||
        game.white.id === playerId ||
        game.black.id === playerId,
    )
    .filter((game) => !result || game.result === result)
    .sort((left, right) => compareGames(left, right, sort));

  return {
    games,
    filters: { query: options.filters?.query || "", playerId, result, sort },
    players: snapshot.players
      .map((player) => ({
        id: player.id,
        displayName: player.displayName,
        aliases: [...player.aliases],
      }))
      .sort((left, right) =>
        left.displayName.localeCompare(right.displayName),
      ),
    summary: {
      totalGames: allGames.length,
      visibleGames: games.length,
      totalPlayers: snapshot.players.length,
      unresolvedPlayerReferences: allGames.reduce(
        (total, game) => total + game.unresolvedPlayerReferences,
        0,
      ),
    },
  };
}

