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

/** One entry of a --surfaces file: a surface credential issued to one human (spec 7.7, 7.8). */
export interface SurfaceEntry {
  credential: string;
  /** The surface's id, e.g. `alice-iphone`. */
  id: string;
  /** The approver id of the human the surface decides for. */
  human: string;
  /** What the surface is, e.g. `page`, `desktop`, `phone`: the records' `channel`. */
  kind: string;
}

/** The surface a credential names, with its human resolved afresh. */
export interface SurfaceCaller {
  surfaceId: string;
  kind: string;
  human: HumanProfile;
}

/**
 * Authenticates surfaces (spec 7.8) on every request: a credential resolves to
 * its surface and to its human's current profile, so revoking the surface or the
 * human ends access at once.
 */
export interface SurfaceAuthenticator {
  /** The surface and its human, or undefined when the credential (or its human) is not, or no longer, valid. */
  resolve(credential: string | undefined): SurfaceCaller | undefined;
  /** The surface with this id and its human, when it is still issued. */
  surface(id: string): SurfaceCaller | undefined;
  credentials?(): Iterable<string>;
}

/** Surface credentials from a static list (the --surfaces file); humans' roles and capabilities come from the approvers. */
export class StaticSurfaceAuthenticator implements SurfaceAuthenticator {
  private readonly surfaces = new Map<string, SurfaceEntry>();

  constructor(
    private readonly humans: HumanAuthenticator & { profile(id: string): HumanProfile | undefined },
    entries: SurfaceEntry[] = [],
  ) {
    for (const e of entries) this.grant(e);
  }

  grant(entry: SurfaceEntry): void {
    const { credential, id, human, kind } = entry;
    if (!credential || !id || !human || !kind) throw new Error("a surface needs a credential, an id, a human and a kind");
    for (const e of this.surfaces.values()) if (e.id === id && e.credential !== credential) throw new Error(`two surfaces are called ${id}`);
    this.surfaces.set(credential, { credential, id, human, kind });
  }

  revoke(credential: string): void {
    this.surfaces.delete(credential);
  }

  private caller(e: SurfaceEntry | undefined): SurfaceCaller | undefined {
    const human = e && this.humans.profile(e.human);
    return human && { surfaceId: e.id, kind: e.kind, human };
  }

  resolve(credential: string | undefined): SurfaceCaller | undefined {
    return credential === undefined ? undefined : this.caller(this.surfaces.get(credential));
  }

  surface(id: string): SurfaceCaller | undefined {
    for (const e of this.surfaces.values()) if (e.id === id) return this.caller(e);
    return undefined;
  }

  credentials(): Iterable<string> {
    return this.surfaces.keys();
  }
}

/**
 * A surface credential is never a requester token, an approver credential or an
 * admin credential: each opens one door (spec 7.8). Throws when one is shared.
 */
export function assertSurfaceCredentialsDisjoint(surfaces: SurfaceAuthenticator, agents: Authenticator, humans?: HumanAuthenticator, admins?: AdminAuthenticator): void {
  const others: [string, Iterable<string>][] = [
    ["a requester token", agents.credentials?.() ?? []],
    ["an approver credential", humans?.credentials?.() ?? []],
    ["an admin credential", admins?.credentials?.() ?? []],
  ];
  const mine = new Set(surfaces.credentials?.() ?? []);
  for (const [what, creds] of others) {
    for (const c of creds) if (mine.has(c)) throw new Error(`refusing to start: a credential is both a surface credential and ${what}`);
  }
}

export function tokenOf(authInfo: AuthInfo | undefined, fallback?: string): string | undefined {
  return authInfo?.token ?? fallback;
}
