// Rule R5: the caller is resolved from its credential on every request, never
// from the session or the task id.
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export interface Authenticator {
  /** The client id the credential names, or undefined when it is not (or no longer) valid. */
  resolve(token: string | undefined): string | undefined;
  /** Every credential it accepts, when it can list them (for the R7 disjointness check). */
  credentials?(): Iterable<string>;
  /**
   * The principal the credential acts for, when it carries one: it becomes
   * `attested.onBehalfOf` (spec 5.1, R8). The static token map carries none.
   */
  onBehalfOf?(token: string | undefined): { kind?: string; id?: string; [k: string]: unknown } | undefined;
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

  credentials(): Iterable<string> {
    return this.tokens.keys();
  }
}

/** A human as the decision page knows them (spec section 3). */
export interface HumanProfile {
  id: string;
  roles: string[];
  capabilities: string[];
}

/**
 * Authenticates humans on the decision page (spec 7.6). The page asks it on every
 * request, so a revoked credential stops working at once. Replace the static
 * implementation with an OIDC- or MFA-backed one without changing the page.
 */
export interface HumanAuthenticator {
  /** The human the credential names, or undefined when it is not (or no longer) valid. */
  resolve(credential: string | undefined): HumanProfile | undefined;
  credentials?(): Iterable<string>;
  /** The human with this id, when known: standing rules decide only for a human who meets the task's `requires`. */
  profile?(id: string): HumanProfile | undefined;
}

/** One entry of an --approvers file. */
export interface ApproverEntry extends HumanProfile {
  credential: string;
}

/** Approver credentials from a static list (the --approvers file). */
export class StaticApproverAuthenticator implements HumanAuthenticator {
  private readonly approvers = new Map<string, HumanProfile>();

  constructor(entries: ApproverEntry[] = []) {
    for (const e of entries) this.grant(e);
  }

  grant({ credential, id, roles = [], capabilities = [] }: ApproverEntry): void {
    if (!credential || !id) throw new Error("an approver needs a credential and an id");
    this.approvers.set(credential, { id, roles: [...roles], capabilities: [...capabilities] });
  }

  revoke(credential: string): void {
    this.approvers.delete(credential);
  }

  resolve(credential: string | undefined): HumanProfile | undefined {
    return credential === undefined ? undefined : this.approvers.get(credential);
  }

  credentials(): Iterable<string> {
    return this.approvers.keys();
  }

  profile(id: string): HumanProfile | undefined {
    for (const h of this.approvers.values()) if (h.id === id) return h;
    return undefined;
  }
}

/**
 * Authenticates administrators of the rules surface: they may manage any
 * human's standing rules. Never an agent token and never an approver credential.
 */
export interface AdminAuthenticator {
  /** The admin's id, or undefined when the credential is not (or no longer) valid. */
  resolve(credential: string | undefined): string | undefined;
  credentials?(): Iterable<string>;
}

/** One entry of an --admins file. */
export interface AdminEntry {
  credential: string;
  id: string;
}

/** Admin credentials from a static list (the --admins file). */
export class StaticAdminAuthenticator implements AdminAuthenticator {
  private readonly admins = new Map<string, string>();

  constructor(entries: AdminEntry[] = []) {
    for (const e of entries) this.grant(e);
  }

  grant({ credential, id }: AdminEntry): void {
    if (!credential || !id) throw new Error("an admin needs a credential and an id");
    this.admins.set(credential, id);
  }

  revoke(credential: string): void {
    this.admins.delete(credential);
  }

  resolve(credential: string | undefined): string | undefined {
    return credential === undefined ? undefined : this.admins.get(credential);
  }

  credentials(): Iterable<string> {
    return this.admins.keys();
  }
}

/**
 * R7: the agent must not reach the human surface, so no credential may be both an
 * agent token and an approver credential. Throws when one is.
 */
export function assertDisjointCredentials(agents: Authenticator, humans: HumanAuthenticator, admins?: AdminAuthenticator): void {
  const agentTokens = new Set(agents.credentials?.() ?? []);
  const humanCreds = new Set(humans.credentials?.() ?? []);
  for (const c of humanCreds) {
    if (agentTokens.has(c)) throw new Error("refusing to start: a credential is both an agent token and an approver credential (R7)");
  }
  for (const c of admins?.credentials?.() ?? []) {
    if (agentTokens.has(c)) throw new Error("refusing to start: a credential is both an agent token and an admin credential (R7)");
    if (humanCreds.has(c)) throw new Error("refusing to start: a credential is both an approver and an admin credential");
  }
}

export function tokenOf(authInfo: AuthInfo | undefined, fallback?: string): string | undefined {
  return authInfo?.token ?? fallback;
}
