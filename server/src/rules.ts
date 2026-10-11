// Proxy layer 1 (spec 3.1, rule R9): a human's standing rules. A rule belongs to
// one human, matches on `attested.*` and `asserted.recommendation.*` only, and
// decides an Approve (approve or reject) or an Ask (an answer) before any human
// is reached. A rule naming any other field is refused when it is saved.
// `requiresHuman: true` skips every rule (spec 5.4).
import { randomUUID } from "node:crypto";
import type { HumanProfile } from "./auth";
import { canonicalJson } from "./idempotency";
import type { Primitive, StoredTask } from "./store";

export type RuleOp = "eq" | "in" | "gte";

export interface RuleCondition {
  /** A dotted path under `attested` or `asserted.recommendation`. */
  path: string;
  op: RuleOp;
  value: unknown;
}

export type RuleOutcome = "approve" | "reject" | "answer";

export interface Rule {
  id: string;
  /** The human the rule belongs to and decides for. */
  human: string;
  conditions: RuleCondition[];
  /** approve or reject decide an Approve; answer decides an Ask with `answer`. */
  outcome: RuleOutcome;
  answer?: unknown;
  createdAt: string;
}

export type NewRule = Omit<Rule, "id" | "createdAt">;

/** Where rules live; first match wins, in `list()` order (oldest first). */
export interface RuleStore {
  saveRule(rule: Rule): Rule;
  getRule(id: string): Rule | undefined;
  deleteRule(id: string): boolean;
  /** Every rule, or one human's, oldest first. */
  listRules(human?: string): Rule[];
}

/** Thrown when a rule is refused at save; the message names the offending field. */
export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

const ROOTS = ["attested", "asserted.recommendation"];
const SEGMENT = /^[A-Za-z0-9_-]+$/;
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_CONDITIONS = 32;

/** Whether a rule may read `path` (R9): only `attested.*` and `asserted.recommendation.*`. */
export function readablePath(path: string): boolean {
  const segments = path.split(".");
  if (!segments.every((s) => SEGMENT.test(s) && !FORBIDDEN_SEGMENTS.has(s))) return false;
  return ROOTS.some((root) => path === root || path.startsWith(`${root}.`));
}

/** Checks a rule as submitted and returns it normalized; throws RuleError naming what is wrong. */
export function validateRule(input: unknown): NewRule {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new RuleError("a rule is a JSON object");
  const r = input as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    if (!["human", "conditions", "outcome", "answer"].includes(k)) throw new RuleError(`unknown rule field ${k}`);
  }
  if (typeof r.human !== "string" || r.human === "") throw new RuleError("a rule needs a human");
  if (!Array.isArray(r.conditions) || r.conditions.length === 0) throw new RuleError("a rule needs at least one condition");
  if (r.conditions.length > MAX_CONDITIONS) throw new RuleError(`a rule has at most ${MAX_CONDITIONS} conditions`);
  const conditions = r.conditions.map((c, i): RuleCondition => {
    if (c === null || typeof c !== "object" || Array.isArray(c)) throw new RuleError(`condition ${i} is not an object`);
    const { path, op, value, ...rest } = c as Record<string, unknown>;
    if (Object.keys(rest).length > 0) throw new RuleError(`condition ${i} has unknown field ${Object.keys(rest)[0]}`);
    if (typeof path !== "string") throw new RuleError(`condition ${i} needs a path`);
    if (!readablePath(path)) throw new RuleError(`a rule may not read ${path}: only attested.* and asserted.recommendation.* (R9)`);
    if (op !== "eq" && op !== "in" && op !== "gte") throw new RuleError(`condition on ${path}: op must be eq, in or gte`);
    if (value === undefined) throw new RuleError(`condition on ${path} needs a value`);
    if (op === "in" && !Array.isArray(value)) throw new RuleError(`condition on ${path}: in takes an array`);
    if (op === "gte" && (typeof value !== "number" || !Number.isFinite(value))) throw new RuleError(`condition on ${path}: gte takes a number`);
    return { path, op, value: structuredClone(value) };
  });
  if (r.outcome !== "approve" && r.outcome !== "reject" && r.outcome !== "answer") throw new RuleError("outcome must be approve, reject or answer");
  if (r.outcome === "answer" && r.answer === undefined) throw new RuleError("an answer rule needs an answer");
  if (r.outcome !== "answer" && r.answer !== undefined) throw new RuleError("only an answer rule takes an answer");
  const rule: NewRule = { human: r.human, conditions, outcome: r.outcome };
  if (r.outcome === "answer") rule.answer = structuredClone(r.answer);
  return rule;
}

export function newRule(rule: NewRule, now: number): Rule {
  return { id: `rule-${randomUUID()}`, createdAt: new Date(now).toISOString(), ...rule };
}

/** The primitive a rule's outcome decides. */
export function primitiveOf(rule: Pick<Rule, "outcome">): Primitive {
  return rule.outcome === "answer" ? "ask" : "approve";
}

/** Reads `path` from the request through own properties only. */
function read(request: Record<string, unknown>, path: string): unknown {
  let v: unknown = request;
  for (const segment of path.split(".")) {
    if (v === null || typeof v !== "object" || !Object.prototype.hasOwnProperty.call(v, segment)) return undefined;
    v = (v as Record<string, unknown>)[segment];
  }
  return v;
}

function holds(request: Record<string, unknown>, c: RuleCondition): boolean {
  // Defence in depth: a stored rule that somehow names another field never matches.
  if (!readablePath(c.path)) return false;
  const actual = read(request, c.path);
  if (actual === undefined) return false;
  switch (c.op) {
    case "eq":
      return canonicalJson(actual) === canonicalJson(c.value);
    case "in":
      return Array.isArray(c.value) && c.value.some((v) => canonicalJson(v) === canonicalJson(actual));
    case "gte":
      return typeof actual === "number" && typeof c.value === "number" && actual >= c.value;
  }
}

/**
 * The view of a request a rule sees: `attested` and `asserted.recommendation`,
 * nothing else (R9), so no condition can reach the payload or the lineage.
 */
export function ruleView(request: Record<string, unknown>): Record<string, unknown> {
  const view: Record<string, unknown> = {};
  if (request.attested !== undefined) view.attested = request.attested;
  const recommendation = (request.asserted as { recommendation?: unknown } | undefined)?.recommendation;
  if (recommendation !== undefined) view.asserted = { recommendation };
  return view;
}

/** Whether the rule's human meets the task's `requires`. */
function qualified(task: StoredTask, human: HumanProfile | undefined, known: boolean): boolean {
  // A rule decides only for a human the server still knows: a revoked
  // approver's rules go silent, as their decision-page sessions do.
  if (known && !human) return false;
  const requires = (task.request.requires ?? {}) as { roles?: string[]; capabilities?: string[] };
  if (!requires.roles?.length && !requires.capabilities?.length) return true;
  if (!human) return false;
  return (requires.roles ?? []).every((r) => human.roles.includes(r)) && (requires.capabilities ?? []).every((c) => human.capabilities.includes(c));
}

/**
 * The first rule that decides `task`, or undefined when a human must. Skipped
 * entirely when the request sets `requiresHuman`. A rule only decides for a
 * human who meets the task's `requires`; `profile` resolves the rule's human.
 */
export function matchRule(task: StoredTask, rules: Rule[], profile?: (id: string) => HumanProfile | undefined): Rule | undefined {
  if (task.request.requiresHuman === true) return undefined;
  const view = ruleView(task.request);
  return rules.find(
    (rule) => primitiveOf(rule) === task.primitive && qualified(task, profile?.(rule.human), profile !== undefined) && rule.conditions.every((c) => holds(view, c)),
  );
}
