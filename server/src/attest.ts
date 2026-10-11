// Rule R8 and spec 5.1: the server owns `attested`. It is filled from the
// authenticated caller after authentication and before anything else reads the
// request; an `attested` block the requester sent is dropped, never merged.
import type { Attested } from "@codefrak/hitlp";

/** Who the authenticator says is calling: the client id and, when the credential carries one, its principal. */
export interface Caller {
  clientId: string;
  onBehalfOf?: Attested["onBehalfOf"];
}

/** The `by` the reference server attests with. */
export const ATTESTED_BY = "hitlp-server";

/** The request with any sent `attested` removed, and whether one was there. */
export function dropAttested(args: Record<string, unknown>): { request: Record<string, unknown>; dropped: boolean } {
  if (!Object.prototype.hasOwnProperty.call(args, "attested")) return { request: args, dropped: false };
  const { attested: _sent, ...request } = args;
  return { request, dropped: true };
}

/** The server's own `attested` for a caller: nothing in it comes from the request. */
export function attestedFor(caller: Caller): Attested {
  const attested: Attested = { requester: caller.clientId, by: ATTESTED_BY };
  if (caller.onBehalfOf !== undefined) attested.onBehalfOf = structuredClone(caller.onBehalfOf);
  return attested;
}
