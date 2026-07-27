import {
  DOMAIN_SCHEMA_VERSION,
  MOVE_CLASSIFICATIONS,
  PLAYER_COLORS,
  TRAINING_ATTEMPT_OUTCOMES,
  TRAINING_TASK_STATUSES,
} from "./constants.js";
import {
  createDomainId,
  optionalString,
  requireEnum,
  requireFiniteNumber,
  requireInteger,
  requireIsoDate,
  requireObject,
  requireString,
} from "./validation.js";

function createTrainingMove(move, fieldName, required = true) {
  if (!required && (move === null || move === undefined)) return null;
  requireObject(move, fieldName);

  return {
    san: requireString(move.san, `${fieldName}.san`),
    uci: optionalString(move.uci, `${fieldName}.uci`),
  };
}

function createSource(source) {
  requireObject(source, "Izvor trening zadatka");

  return {
    moveAnalysisId: requireString(
      source.moveAnalysisId,
      "ID analize poteza",
    ),
    analysisRunId: requireString(source.analysisRunId, "ID analize"),
    gameId: requireString(source.gameId, "ID partije"),
    gameTitle: requireString(source.gameTitle, "Naslov partije"),
    ply: requireInteger(source.ply, "Ply izvornog poteza", 1),
    moveNumber: requireInteger(source.moveNumber, "Broj poteza", 1),
  };
}

function createSchedule(schedule) {
  requireObject(schedule, "Raspored treninga");
  const easeFactor = requireFiniteNumber(
    schedule.easeFactor,
    "Ease factor",
    1.3,
  );

  return {
    status: requireEnum(
      schedule.status,
      TRAINING_TASK_STATUSES,
      "Status trening zadatka",
    ),
    dueAt: requireIsoDate(schedule.dueAt, "Datum sljedeceg treninga"),
    intervalDays: requireInteger(
      schedule.intervalDays,
      "Interval treninga",
    ),
    easeFactor,
    repetitions: requireInteger(
      schedule.repetitions,
      "Broj uspjesnih ponavljanja",
    ),
    lapses: requireInteger(schedule.lapses, "Broj padova"),
  };
}

export function createTrainingTask(input, options = {}) {
  if (!Array.isArray(input?.tags)) {
    throw new TypeError("Tagovi trening zadatka moraju biti polje.");
  }

  const priority = requireFiniteNumber(
    input.priority,
    "Prioritet trening zadatka",
    0,
  );
  if (priority > 100) {
    throw new TypeError("Prioritet trening zadatka ne moze biti veci od 100.");
  }

  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: requireString(
      input?.id || createDomainId("training-task"),
      "ID trening zadatka",
    ),
    playerId: requireString(input?.playerId, "ID igraca"),
    source: createSource(input?.source),
    fen: requireString(input?.fen, "FEN trening zadatka"),
    color: requireEnum(input?.color, PLAYER_COLORS, "Boja igraca"),
    phase: requireString(input?.phase, "Faza partije"),
    playedMove: createTrainingMove(input?.playedMove, "Odigrani potez"),
    bestMove: createTrainingMove(input?.bestMove, "Najbolji potez"),
    alternatives: (input?.alternatives || []).map((move) =>
      createTrainingMove(move, "Alternativni potez"),
    ),
    centipawnLoss: requireFiniteNumber(
      input?.centipawnLoss,
      "Gubitak poteza",
      0,
    ),
    classification: requireEnum(
      input?.classification,
      MOVE_CLASSIFICATIONS,
      "Klasifikacija poteza",
    ),
    weaknessKey: requireString(input?.weaknessKey, "Kljuc slabosti"),
    priority,
    tags: [...new Set(input.tags.map((tag) => requireString(tag, "Tag")))],
    schedule: createSchedule(input?.schedule),
    createdAt: requireIsoDate(
      input?.createdAt || options.now || new Date().toISOString(),
      "createdAt",
    ),
    updatedAt: requireIsoDate(
      input?.updatedAt ||
        input?.createdAt ||
        options.now ||
        new Date().toISOString(),
      "updatedAt",
    ),
  };
}

export function createTrainingAttempt(input, options = {}) {
  if (typeof input?.correct !== "boolean") {
    throw new TypeError("Tocnost trening pokusaja mora biti boolean.");
  }

  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    id: requireString(
      input?.id || createDomainId("training-attempt"),
      "ID trening pokusaja",
    ),
    taskId: requireString(input?.taskId, "ID trening zadatka"),
    playerId: requireString(input?.playerId, "ID igraca"),
    outcome: requireEnum(
      input?.outcome,
      TRAINING_ATTEMPT_OUTCOMES,
      "Ishod trening pokusaja",
    ),
    correct: input.correct,
    attemptedMove: createTrainingMove(
      input?.attemptedMove,
      "Pokusani potez",
      false,
    ),
    attemptedAt: requireIsoDate(
      input?.attemptedAt || options.now || new Date().toISOString(),
      "attemptedAt",
    ),
    previousDueAt: requireIsoDate(
      input?.previousDueAt,
      "Prethodni datum treninga",
    ),
    nextDueAt: requireIsoDate(input?.nextDueAt, "Sljedeci datum treninga"),
  };
}

