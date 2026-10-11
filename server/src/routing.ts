// Who may decide a task, and how a human's decision is checked before it is
// recorded. The decision page (spec 7.6) and the surface API (spec 7.8) share
// these, so a decision means the same thing whichever surface it came from.
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { HumanProfile } from "./auth";
import { requestHash } from "./idempotency";
import type { StoredTask } from "./store";

/** What the human lacks of the task's `requires`, empty when they may decide. */
export function missingRequirements(task: StoredTask, human: HumanProfile): string[] {
  const requires = (task.request.requires ?? {}) as { roles?: string[]; capabilities?: string[] };
  return [
    ...(requires.roles ?? []).filter((r) => !human.roles.includes(r)).map((r) => `role ${r}`),
    ...(requires.capabilities ?? []).filter((c) => !human.capabilities.includes(c)).map((c) => `capability ${c}`),
  ];
}

/** A task is routed to the humans whose roles and capabilities satisfy its `requires`. */
export function routedTo(task: StoredTask, human: HumanProfile): boolean {
  return missingRequirements(task, human).length === 0;
}

/** The digest a decision is bound to: the request's own, or one over the payload shown. */
export function displayedDigest(task: StoredTask): string {
  return (task.request.payloadDigest as string | undefined) ?? requestHash(task.request.payload);
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

/** Errors of an Ask answer against the Ask's `responseSchema`, empty when it is valid. */
export function answerErrors(task: StoredTask, answer: unknown): string[] {
  const schema = task.request.responseSchema as Record<string, unknown> | boolean | undefined;
  if (schema === undefined || schema === true) return [];
  if (schema === false) return ["the responseSchema accepts no answer"];
  let check;
  try {
    // Without its $id, so the same schema compiles again for the next answer.
    const { $id: _id, ...anonymous } = schema;
    check = ajv.compile(anonymous);
  } catch (e) {
    return [`the responseSchema does not compile: ${(e as Error).message}`];
  }
  return check(answer) ? [] : (check.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`);
}
