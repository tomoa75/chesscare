export const DOMAIN_SCHEMA_VERSION = 1;

export const PLAYER_COLORS = Object.freeze(["white", "black"]);
export const GAME_RESULTS = Object.freeze(["1-0", "0-1", "1/2-1/2", "*"]);
export const GAME_PHASES = Object.freeze([
  "opening",
  "middlegame",
  "endgame",
]);
export const ANALYSIS_STATUSES = Object.freeze([
  "queued",
  "running",
  "cancelled",
  "completed",
  "failed",
]);
export const EVALUATION_TYPES = Object.freeze(["cp", "mate"]);
export const MOVE_CLASSIFICATIONS = Object.freeze([
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
]);
export const TRAINING_TASK_STATUSES = Object.freeze([
  "new",
  "learning",
  "review",
  "mastered",
  "suspended",
]);
export const TRAINING_ATTEMPT_OUTCOMES = Object.freeze([
  "again",
  "hard",
  "good",
  "easy",
]);
