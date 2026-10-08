import { randomUUID } from "node:crypto";

/**
 * A fresh idempotency key for a new logical request (rule R4). Reuse the key
 * you got here on every retry of that request; never mint a new one to retry.
 */
export function newIdempotencyKey(prefix?: string): string {
  const id = randomUUID();
  return prefix ? `${prefix}-${id}` : id;
}
