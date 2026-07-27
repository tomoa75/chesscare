import {
  ANALYSIS_STATUSES,
  DOMAIN_SCHEMA_VERSION,
  EVALUATION_TYPES,
  GAME_PHASES,
  MOVE_CLASSIFICATIONS,
  PLAYER_COLORS,
} from "./constants.js";
import {
  createDomainId,
  optionalIsoDate,
  optionalString,
  requireEnum,
  requireFiniteNumber,
  requireInteger,
  requireIsoDate,
  requireObject,
  requireString,
} from "./validation.js";

function createProgress(progress = {}) {
  requireObject(progress, "Napredak analize");
  const completed = requireInteger(progress.completed ?? 0, "Dovrseno");
  const total = requireInteger(progress.total ?? 0, "Ukupno");

  if (completed > total) {
    throw new TypeError("Dovrseni broj pozicija ne moze biti veci od ukupnog.");
  }

  return { completed, total };
}

function createEngine(engine) {
  requireObject(engine, "Engine");

  return {
    name: requireString(engine.name, "Naziv enginea"),
    version: requireString(engine.version, "Verzija enginea"),
  };
}

function createAnalysisSettings(settings) {
  requireObject(settings, "Postavke analize");
  const uciOptions = settings.uciOptions ?? {};
  requireObject(uciOptions, "UCI postavke");

  return {
    depth: requireInteger(settings.depth, "Dubina analize", 1),
    multiPv: requireInteger(settings.multiPv ?? 1, "MultiPV", 1),
    uciOptions: Object.fromEntries(
      Object.entries(uciOptions)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => {
          const validValue =
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean";

          if (!name.trim() || !validValue) {
            throw new TypeError("UCI postavke moraju imati skalarne vrijednosti.");
          }

          return [name.trim(), value];
        }),
    ),
  };
}

export function createAnalysisRun(input, options = {}) {
  const createdAt = requireIsoDate(
    input?.createdAt || options.now || new Date().toISOString(),
    "createdAt",
  );
  const status = requireEnum(
    input?.status ?? "queued",
    ANALYSIS_STATUSES,
    "Status analize",
  );
  const completedAt = optionalIsoDate(input?.completedAt, "completedAt");
  const progress = createProgress(input?.progress);

  if (status === "completed" && !completedAt) {
    throw new TypeError("Zavrsena analiza mora imati completedAt.");
  }

  if (status === "completed" && progress.completed !== progress.total) {
    throw new TypeError("Zavrsena analiza mora imati dovrsen sav napredak.");
  }

  if (!Array.isArray(input?.gameIds) || input.gameIds.length === 0) {
    throw new TypeError("Analiza mora sadrzavati barem jednu partiju.");
  }

  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: requireString(
      input?.id || createDomainId("analysis"),
      "ID analize",
    ),
    gameIds: [...new Set(input.gameIds.map((id) => requireString(id, "ID partije")))],
    engine: createEngine(input.engine),
    settings: createAnalysisSettings(input.settings),
    status,
    progress,
    createdAt,
    startedAt: optionalIsoDate(input?.startedAt, "startedAt"),
    completedAt,
    error: optionalString(input?.error, "Greska analize"),
  };
}

function createEvaluation(evaluation, fieldName) {
  requireObject(evaluation, fieldName);

  return {
    type: requireEnum(evaluation.type, EVALUATION_TYPES, `${fieldName}.type`),
    value: requireFiniteNumber(evaluation.value, `${fieldName}.value`),
    perspective: requireEnum(
      evaluation.perspective || "white",
      ["white"],
      `${fieldName}.perspective`,
    ),
  };
}

function createMove(move, fieldName, required = true) {
  if (!required && (move === undefined || move === null)) return null;
  requireObject(move, fieldName);

  return {
    san: requireString(move.san, `${fieldName}.san`),
    uci: optionalString(move.uci, `${fieldName}.uci`),
  };
}

export function createMoveAnalysis(input) {
  const beforeEvaluation = createEvaluation(
    input?.beforeEvaluation,
    "Evaluacija prije poteza",
  );
  const afterEvaluation = createEvaluation(
    input?.afterEvaluation,
    "Evaluacija nakon poteza",
  );

  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: requireString(
      input?.id || createDomainId("move-analysis"),
      "ID rezultata poteza",
    ),
    analysisRunId: requireString(input?.analysisRunId, "ID analize"),
    gameId: requireString(input?.gameId, "ID partije"),
    playerId: optionalString(input?.playerId, "ID igraca"),
    ply: requireInteger(input?.ply, "Ply", 1),
    color: requireEnum(input?.color, PLAYER_COLORS, "Boja igraca"),
    phase: requireEnum(input?.phase, GAME_PHASES, "Faza partije"),
    beforeFen: requireString(input?.beforeFen, "FEN prije poteza"),
    afterFen: requireString(input?.afterFen, "FEN nakon poteza"),
    playedMove: createMove(input?.playedMove, "Odigrani potez"),
    bestMove: createMove(input?.bestMove, "Najbolji potez", false),
    beforeEvaluation,
    afterEvaluation,
    centipawnLoss: requireFiniteNumber(
      input?.centipawnLoss,
      "Gubitak u centipawnovima",
      0,
    ),
    classification: requireEnum(
      input?.classification,
      MOVE_CLASSIFICATIONS,
      "Klasifikacija poteza",
    ),
  };
}

function createCachedLine(line, index) {
  requireObject(line, `Cache linija ${index}`);

  if (!Array.isArray(line.pv)) {
    throw new TypeError(`Cache linija ${index}.pv mora biti polje.`);
  }

  return {
    multiPv: requireInteger(line.multiPv ?? index + 1, "MultiPV", 1),
    depth: requireInteger(line.depth, "Dubina cache linije", 1),
    score: createEvaluation(line.score, "Cache evaluacija"),
    bestMove: optionalString(line.bestMove, "Najbolji UCI potez"),
    pv: line.pv.map((move) => requireString(move, "UCI potez u PV-u")),
  };
}

export function createPositionEvaluation(input, options = {}) {
  if (!Array.isArray(input?.lines) || input.lines.length === 0) {
    throw new TypeError("Cache evaluacija mora imati barem jednu liniju.");
  }

  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: requireString(
      input?.id || createDomainId("position-evaluation"),
      "ID cache evaluacije",
    ),
    cacheKey: requireString(input?.cacheKey, "Cache kljuc"),
    fen: requireString(input?.fen, "FEN cache evaluacije"),
    engine: createEngine(input?.engine),
    settings: createAnalysisSettings(input?.settings),
    lines: input.lines.map(createCachedLine),
    createdAt: requireIsoDate(
      input?.createdAt || options.now || new Date().toISOString(),
      "createdAt",
    ),
  };
}
