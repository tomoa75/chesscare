export function requireObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} mora biti objekt.`);
  }

  return value;
}

export function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} mora biti neprazan string.`);
  }

  return value.trim();
}

export function optionalString(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  return requireString(value, fieldName);
}

export function requireInteger(value, fieldName, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new TypeError(
      `${fieldName} mora biti cijeli broj veci ili jednak ${minimum}.`,
    );
  }

  return value;
}

export function requireFiniteNumber(value, fieldName, minimum = -Infinity) {
  if (!Number.isFinite(value) || value < minimum) {
    throw new TypeError(
      `${fieldName} mora biti konacan broj veci ili jednak ${minimum}.`,
    );
  }

  return value;
}

export function requireEnum(value, allowedValues, fieldName) {
  if (!allowedValues.includes(value)) {
    throw new TypeError(
      `${fieldName} mora biti jedna od vrijednosti: ${allowedValues.join(", ")}.`,
    );
  }

  return value;
}

export function requireIsoDate(value, fieldName) {
  const date = requireString(value, fieldName);

  if (Number.isNaN(Date.parse(date))) {
    throw new TypeError(`${fieldName} mora biti valjani ISO datum.`);
  }

  return date;
}

export function optionalIsoDate(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  return requireIsoDate(value, fieldName);
}

export function createDomainId(prefix) {
  const suffix =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${prefix}-${suffix}`;
}

