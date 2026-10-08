// Rule R6: a long TTL is standing authority. Each primitive has a maximum TTL;
// a longer requested deadline is shortened to it and the effective deadline is
// reported in the task's `ttl`. Blanket Approve scopes are refused by default.
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { Primitive } from "./store";

export type TtlCaps = Record<Primitive, number>;

export const HOUR = 3_600_000;
/** Approve is capped at a day, Ask at a week. */
export const DEFAULT_CAPS: TtlCaps = { approve: 24 * HOUR, ask: 7 * 24 * HOUR };

/**
 * The effective deadline in epoch ms: the earliest of the request's `deadline`,
 * `now + requestedTtl` (the MCP task ttl, when the client sent one) and the cap.
 */
export function effectiveDeadline(primitive: Primitive, deadline: string, now: number, caps: TtlCaps, requestedTtl?: number): number {
  const candidates = [Date.parse(deadline), now + caps[primitive]];
  if (requestedTtl !== undefined) candidates.push(now + requestedTtl);
  return Math.min(...candidates.filter((n) => !Number.isNaN(n)));
}

/**
 * R6: refuses an Approve whose `scope` asks for blanket or permanent approval
 * (no `notAfter`, or no bound on `maxUses`) unless `allowBlanket` is set. An
 * Approve without a scope is single-use (spec 4.2) and passes.
 */
export function checkScope(primitive: Primitive, args: Record<string, unknown>, allowBlanket: boolean): void {
  if (primitive !== "approve" || allowBlanket) return;
  const scope = args.scope as { notAfter?: unknown; maxUses?: unknown } | undefined;
  if (scope === undefined) return;
  const missing = [scope.notAfter === undefined && "notAfter", scope.maxUses === undefined && "maxUses"].filter(Boolean);
  if (missing.length > 0) {
    throw new McpError(ErrorCode.InvalidParams, `blanket approval refused (R6): scope has no ${missing.join(" and no ")}`);
  }
}
