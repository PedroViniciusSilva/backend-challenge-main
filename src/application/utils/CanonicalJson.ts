import { createHash } from "node:crypto";

export function canonicalize(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(canonicalize);
  }

  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const result: Record<string, unknown> = {};

  for (const key of sortedKeys) {
    result[key] = canonicalize((obj as Record<string, unknown>)[key]);
  }

  return result;
}

export function canonicalJsonStringify(obj: unknown): string {
  return JSON.stringify(canonicalize(obj));
}

export function calculatePayloadHash(payload: unknown): string {
  const canonicalString = canonicalJsonStringify(payload);
  return createHash("sha256").update(canonicalString).digest("hex");
}
