import { createHash } from "node:crypto";

/** JSON with object keys sorted, so equal requests serialize equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value as object)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The request hash rule R4 compares a repeated key against. */
export function requestHash(request: unknown): string {
  return "sha256:" + createHash("sha256").update(canonicalJson(request)).digest("hex");
}
