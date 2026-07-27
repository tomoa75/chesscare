function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }

  return value;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto API nije dostupan za SHA-256.");
  }

  const bytes = new TextEncoder().encode(String(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

