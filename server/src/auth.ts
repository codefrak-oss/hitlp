// Rule R5: the caller is resolved from its credential on every request, never
// from the session or the task id.
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export interface Authenticator {
  /** The client id the credential names, or undefined when it is not (or no longer) valid. */
  resolve(token: string | undefined): string | undefined;
}

/** Bearer tokens mapped to client ids; `revoke` takes effect on the next request. */
export class StaticTokenAuthenticator implements Authenticator {
  private readonly tokens: Map<string, string>;

  constructor(tokens: Record<string, string> = {}) {
    this.tokens = new Map(Object.entries(tokens));
  }

  grant(token: string, clientId: string): void {
    this.tokens.set(token, clientId);
  }

  revoke(token: string): void {
    this.tokens.delete(token);
  }

  resolve(token: string | undefined): string | undefined {
    return token === undefined ? undefined : this.tokens.get(token);
  }
}

export function tokenOf(authInfo: AuthInfo | undefined, fallback?: string): string | undefined {
  return authInfo?.token ?? fallback;
}
