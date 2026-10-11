// Device push for new tasks (spec 7.8): one push per registered device of each
// human a new task is routed to. A push carries the task id and a title, never
// the payload: the surface fetches the task over its own credential. APNs is
// spoken over node:http2 with an ES256 provider token signed by node:crypto.
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";
import type { SurfaceAuthenticator } from "./auth";
import { routedTo } from "./routing";
import type { HitlpServer } from "./server";
import type { Device, StoredTask, SurfaceStore } from "./store";

/** What became of one push: delivered, the device is gone (drop it), or it failed. */
export type PushResult = "sent" | "gone" | "failed";

export interface PushSender {
  send(device: Device, task: StoredTask): Promise<PushResult>;
}

/** The alert a push shows: a title by primitive and the task id, no request content. */
export function pushContent(task: StoredTask): { title: string; body: string; taskId: string } {
  return {
    title: task.primitive === "approve" ? "Approval requested" : "Question",
    body: "A request is waiting for your decision.",
    taskId: task.id,
  };
}

/** Sends nothing; says so once, the first time a push would have gone out. */
export class NoopPushSender implements PushSender {
  private logged = false;

  constructor(private readonly log: (msg: string) => void = (m) => console.error(m)) {}

  async send(): Promise<PushResult> {
    if (!this.logged) {
      this.logged = true;
      this.log("hitlp: push is not configured (--apns-key, --apns-key-id, --apns-team-id, --apns-bundle-id); devices get no push");
    }
    return "failed";
  }
}

export interface ApnsConfig {
  /** The .p8 signing key, PEM. */
  key: string;
  keyId: string;
  teamId: string;
  /** The app's bundle id: the apns-topic. */
  bundleId: string;
  /** Send to api.sandbox.push.apple.com when the device names no environment. */
  sandbox?: boolean;
}

const APNS_HOST = { production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" };
/** APNs accepts a provider token for up to an hour; refresh well before. */
const TOKEN_TTL_MS = 50 * 60_000;

/** An ES256 JWT (RFC 7515/7519) as APNs wants it: kid in the header, iss and iat in the claims. */
export function apnsJwt(key: KeyObject, keyId: string, teamId: string, nowMs: number): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const input = `${b64({ alg: "ES256", kid: keyId })}.${b64({ iss: teamId, iat: Math.floor(nowMs / 1000) })}`;
  const signature = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `${input}.${signature.toString("base64url")}`;
}

export class ApnsPushSender implements PushSender {
  private readonly key: KeyObject;
  private token?: { jwt: string; at: number };
  private readonly sessions = new Map<string, ClientHttp2Session>();

  constructor(
    private readonly config: ApnsConfig,
    private readonly now: () => number = Date.now,
  ) {
    this.key = createPrivateKey(config.key);
  }

  private jwt(): string {
    const now = this.now();
    if (!this.token || now - this.token.at > TOKEN_TTL_MS) this.token = { jwt: apnsJwt(this.key, this.config.keyId, this.config.teamId, now), at: now };
    return this.token.jwt;
  }

  private session(host: string): ClientHttp2Session {
    let s = this.sessions.get(host);
    if (!s || s.closed || s.destroyed) {
      s = connect(host);
      s.on("error", () => this.sessions.delete(host));
      s.on("close", () => this.sessions.delete(host));
      s.unref();
      this.sessions.set(host, s);
    }
    return s;
  }

  async send(device: Device, task: StoredTask): Promise<PushResult> {
    if (device.platform !== "apns") return "failed";
    const env = device.environment ?? (this.config.sandbox ? "sandbox" : "production");
    const host = env === "sandbox" ? APNS_HOST.sandbox : APNS_HOST.production;
    const { title, body, taskId } = pushContent(task);
    const payload = JSON.stringify({ aps: { alert: { title, body }, sound: "default", "thread-id": "hitlp" }, taskId });
    return new Promise<PushResult>((resolve) => {
      try {
        const req = this.session(host).request({
          ":method": "POST",
          ":path": `/3/device/${encodeURIComponent(device.token)}`,
          authorization: `bearer ${this.jwt()}`,
          "apns-topic": this.config.bundleId,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-collapse-id": taskId.slice(0, 64),
          "content-type": "application/json",
        });
        let status = 0;
        req.on("response", (h) => (status = Number(h[":status"])));
        req.on("error", () => resolve("failed"));
        req.on("end", () => resolve(status === 200 ? "sent" : status === 410 ? "gone" : "failed"));
        req.resume();
        req.end(payload);
      } catch {
        resolve("failed");
      }
    });
  }

  close(): void {
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
  }
}

/** The sender the flags configure: APNs when all four are set, else one that logs once and sends nothing. */
export function pushSenderFor(config: Partial<ApnsConfig>): PushSender {
  const { key, keyId, teamId, bundleId } = config;
  return key && keyId && teamId && bundleId ? new ApnsPushSender({ key, keyId, teamId, bundleId, sandbox: config.sandbox }) : new NoopPushSender();
}

/**
 * Pushes each new task to every device of every human it is routed to, once:
 * the server announces only fresh tasks, never an R4 repeat. A device whose
 * surface was revoked gets nothing; one APNs reports gone is dropped.
 */
export function wirePush(server: HitlpServer, surfaces: SurfaceAuthenticator, store: SurfaceStore, sender: PushSender): () => void {
  return server.onNewTask((task) => {
    for (const device of store.listDevices()) {
      const surface = surfaces.surface(device.surfaceId);
      if (!surface || surface.human.id !== device.human || !routedTo(task, surface.human)) continue;
      void sender.send(device, task).then(
        (r) => void (r === "gone" && store.deleteDevice(device.surfaceId, device.id)),
        () => {},
      );
    }
  });
}
