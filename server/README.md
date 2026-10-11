# HITLP reference server

A TypeScript MCP server that offers `human.ask` and `human.approve` as task
tools (spec section 7), with a durable SQLite task store. It implements:

- **R1**: a call returns its task handle at once; tasks live in SQLite
  (`SqliteTaskStore`) and survive a restart. `tasks/result` never blocks on a
  human: poll `tasks/get`.
- **R4**: requests are deduplicated on `idempotencyKey` per authenticated
  client. A repeat with the same content returns the existing task and notifies
  no one; a repeat with different content is rejected.
- **R5**: every `tools/call`, `tasks/get`, `tasks/result`, `tasks/list` and
  `tasks/cancel` resolves the caller from its bearer token (`authInfo.token`)
  and only shows a task to the client that created it.

- **R2**: a task's effective deadline is the earliest of its `deadline`, the
  MCP task `ttl` the client asked for, and the cap. When it passes, the server
  applies `defaultOnTimeout` and writes a decision record with
  `decidedBy.type: policy`: `reject` ends `completed` (`rejected` for Approve,
  `timed_out` for Ask), `cancel` ends `cancelled`, `fail` ends `failed`, and
  `escalate` calls `onEscalate` and keeps waiting `escalationGraceMs` (24h by
  default) before it rejects. Expiry runs on start, on a timer
  (`expirySweepMs`, 30s) and on every read. Store updates are compare-and-set,
  so an expiry and a late decision cannot both win. Terminal tasks are kept
  (the retention period of spec 7.5 is unbounded).
- **R6**: TTLs are capped per primitive (Approve 24h, Ask 7 days; `caps`,
  `--approve-cap-hours`, `--ask-cap-hours`); a longer deadline is shortened
  and the effective deadline reported in `ttl`. An Approve whose `scope` has
  no `notAfter` or no `maxUses` is refused unless `allowBlanketScope`
  (`--allow-blanket-scope`) is set.
- **R7 / spec 7.6**: with a decision page configured, `human.approve` moves the
  task to `input_required` with `statusMessage` `Decision required: <url>` and
  `_meta["io.hitlp/decisionUrl"]`. The task stays there until the human decides
  or the TTL passes, then goes straight to terminal; the client never submits
  anything. The page (`DecisionPage`, `src/decision-page.ts`):
  - authenticates humans through the `HumanAuthenticator` interface; the
    static implementation reads `--approvers`, a list of human profiles
    (`{"credential", "id", "roles", "capabilities"}`, spec section 3). The
    server refuses to start if a credential is also an agent token;
  - takes a login form that sets a `SameSite=Strict`, `HttpOnly` session
    cookie, and refuses any request with an `Authorization` header; the URL
    alone grants nothing;
  - checks the task's `requires.roles` and `requires.capabilities` when the
    page loads and on submit, and protects the form with a per-session,
    per-task CSRF token;
  - shows the action and payload exactly as received and records one
    decision: `decidedBy` carries the approver's id and roles, `channel` is
    `url`, and `payloadDigest` is the request's digest (or a sha256 over the
    canonical payload when it has none). A second submit is refused.
  - answers an Ask the same way, at `/decide/<id>` behind the same login,
    `requires` and CSRF checks: the human sees the question as received and
    submits one answer, free text or one of the request's `options` (text is
    parsed as JSON when `responseSchema` is not a string). The record has
    outcome `answered`, the human's `decidedBy` and `channel` `url`. An Ask's
    status and `_meta` do not change; `hitlp-server` logs its page URL when
    the task is created.

  MFA is not built in: deployments SHOULD add it for Approve (spec 7.6) by
  plugging in an OIDC- or MFA-backed `HumanAuthenticator`. Page sessions live
  in memory, so a restart asks approvers to sign in again.

HITLP 0.2 (spec 3.1, 5.1–5.4, 6):

- **R8 / spec 5.1**: on every `human.ask` and `human.approve`, right after the
  bearer token is resolved and before the request is validated, deduplicated or
  stored, the server drops any `attested` block the request carries and fills
  its own: `{"requester": <client id>, "by": "hitlp-server"}`, plus
  `onBehalfOf` when the `Authenticator` returns one for the token
  (`Authenticator.onBehalfOf`; the flat `tokens.json` map carries none). Nothing
  under `asserted` is ever copied into it. The R4 hash is taken over the request
  without the sent `attested`, so a repeat that differs only there returns the
  existing task, and one that differs in `asserted` is rejected; neither
  notifies anyone.
- **R10 / spec 5.1–5.3**: `asserted` (`why`, `onBehalfOf`, `recommendation`,
  `lineage`, `asOf`) and `requiresHuman` are stored exactly as received, in the
  task's `request`, which stays with the record. Nothing reads them to decide
  but `asserted.recommendation` for the rules below. The decision page shows,
  for an Approve and an Ask, a **Who is asking (attested by the server)** block
  and a separate **The requester's account (asserted, unverified)** block with
  the why, the recommendation (verdict, confidence, by, reasons) and the
  lineage newest first, each link's kind and claim.
- **R9 / spec 3.1, proxy layer 1**: per-human standing rules. A rule is
  `{"human", "conditions": [{"path", "op", "value"}], "outcome", "answer"?}`;
  `op` is `eq`, `in` (value is a list) or `gte` (a number, e.g. on
  `asserted.recommendation.confidence`); `outcome` is `approve` or `reject`
  (decides an Approve) or `answer` with an `answer` (decides an Ask). A path
  must lie under `attested.` or `asserted.recommendation.`; any other path
  (`payload`, `context`, `asserted.why`, `asserted.lineage`, `asserted.asOf`,
  `asserted.onBehalfOf`, …) is refused when the rule is saved, with an error
  naming it, and evaluation only ever sees those two parts of the request.
  Rules run after dedup (R4) and the caps (R6), before the task is routed to a
  human: the first match, oldest rule first, among rules whose human meets the
  task's `requires`, completes the task with `decidedBy: {"type": "rule", "id":
  <rule id>}` and no `channel`, and `notify` is not called. `requiresHuman:
  true` skips every rule. Rules are stored in the same SQLite file (`RuleStore`,
  `src/rules.ts`) and are active when the decision page is configured.

  Rules are managed on the decision page's origin, as JSON with an
  `Authorization: Bearer <credential>` header: `GET /rules`, `POST /rules`,
  `GET /rules/<id>`, `DELETE /rules/<id>` (change a rule by deleting it and
  saving a new one). An approver's credential manages that human's own rules
  (`human` defaults to them); an admin credential from `--admins` (a list of
  `{"credential", "id"}`) manages any approver's. An agent token is refused with
  403, and the server refuses to start if an admin credential is also an agent
  token or an approver credential.
- **R11 / spec 6**: every decision record (human on the page, rule, policy at
  the deadline) carries `attested` as the server filled it and, when the
  request had one, `recommendation` equal to `asserted.recommendation`.
  `decidedBy.type` is `human`, `rule` or `policy`; `model` (proxy layer 2,
  prose rules) is reserved by the schema and not implemented. Human records
  name the surface in `channel`: `url` from the decision page, the surface's
  `kind` from the surface API. Records are not signed.
- **Surfaces / spec 7.8**: every human decision, from the page or the surface
  API, goes through one path, `HitlpServer.decideAsHuman(taskId, human,
  channel, decision)`: the human must satisfy the task's `requires`, the task
  must be open, an Approve's decision is bound to its `payloadDigest` and an
  Ask's answer must match its `responseSchema` (and be one of its `options`).

## Surface API

With `--surfaces surfaces.json` the server answers a REST + JSON API at
`/surface/v1`, on the MCP listener (`--http-port`) and on the decision page's
origin, for the surfaces a human decides on: the hosted page, a desktop app, a
phone app (spec 7.8). The surfaces file is a list of
`{"credential", "id", "human", "kind"}`: `human` is an approver id from
`--approvers` (its roles and capabilities route tasks), `kind` (`page`,
`desktop`, `phone`, ...) becomes the records' `channel`. Revoke a surface by
removing it from the file and restarting.

Every call sends `Authorization: Bearer <surface credential>` and is resolved
afresh (R5). A requester token, an approver credential or no credential gets
401 here; a surface credential on `/mcp` gets 401; the server refuses to start
when a surface credential is also a requester token, approver or admin
credential. A task is routed to the humans whose roles and capabilities
satisfy its `requires`; to anyone else it is not listed and answers 404.

| Call | Answer |
| --- | --- |
| `GET /surface/v1/tasks` | `{"tasks": [view, ...]}`: open tasks routed to the human, and those decided in the last `--surface-recent-hours` (24), newest first. |
| `GET /surface/v1/tasks/{id}` | The task view: `id`, `primitive`, `status`, `createdAt`, `deadline` (effective), `requiresHuman`, `attested` (`source: "server"`), `asserted` (`source: "requester"`: `why`, `recommendation`, `lineage` newest first), for an Approve `action`, `payload` as received and `payloadDigest`, for an Ask `question`, `responseSchema`, `options`; `context`, `requires`, and `result` once decided. |
| `POST /surface/v1/tasks/{id}/decision` | Body `{"outcome": "approve" \| "reject", "reason"?, "payloadDigest"?}` for an Approve, `{"answer", "reason"?}` for an Ask. 200 with the decision record; 400 for a malformed decision or an answer the schema refuses; 404 when not routed; 409 when already decided or the digest is stale. |
| `PUT /surface/v1/devices/{id}` | Body `{"platform": "apns", "token", "environment"?: "production" \| "sandbox", "name"?}`; 200 with the device. |
| `DELETE /surface/v1/devices/{id}` | 204, or 404 when this surface has no such device. |
| `GET /surface/v1/events` | `text/event-stream`: one `event: task` (`id` the task id, `data` the view) per task routed to the human created after the stream opened; keep-alive comments every 25 s. |

Errors are JSON, `{"error": "..."}`. Devices live in the `SurfaceStore`
(`src/store.ts`; SQLite in `src/sqlite-store.ts`).

Push: with `--apns-key <AuthKey.p8> --apns-key-id <id> --apns-team-id <id>
--apns-bundle-id <id>` (and `--apns-sandbox` for devices that name no
environment) each new task is pushed once to every device of every human it is
routed to, never for an R4 repeat or a rule's decision. The alert carries a
title and the task id, never the request's content; the app fetches the task
with its own credential. A device APNs answers 410 for is dropped. Without
the flags the server logs once and pushes nothing. Other push services plug in
as a `PushSender` (`src/push.ts`).

R3 is the agent's (the SDKs' checkpoints). Without a decision page,
`HitlpServer.decide` is how a decision is recorded.

The store sits behind the `TaskStore` interface (`src/store.ts`) so another
backend can replace SQLite.

## Build and test

The server uses the TypeScript SDK from `../sdks/typescript`, so build it first:

```sh
(cd ../sdks/typescript && npm ci && npm run build)
npm ci
npm test
```

The tests drive the server through the SDK's `McpTaskTransport`.

## Run

```sh
npm run build
node dist/src/main.js --db hitlp.db --tokens tokens.json
```

Without `--http-port` it serves one client over stdio. With it, it serves MCP
Streamable HTTP at `/mcp`; each request's `Authorization: Bearer` token names
its client, and a request without one is refused. The conformance suite
(`../conformance`) runs against that URL. Over HTTP nothing defaults: the
server refuses to start without `--tokens`, and without `--page-url` when
`--approvers` is set, naming the missing setting.

### Settings

Every setting is a command-line flag, read under that one name; files hold the
secrets.

| Setting | Required | Meaning |
| --- | --- | --- |
| `--db <file>` | no (`hitlp.db`) | The SQLite task store. |
| `--http-port <n>` | no | Serve MCP over HTTP at `/mcp` (and the surface API) instead of stdio. |
| `--http-host <h>` | no (`127.0.0.1`) | The MCP listener's address. |
| `--tokens <file>` | over HTTP | Bearer tokens to client ids, `{"secret": "agent-1"}`. Over stdio without it one client, `local`, is allowed. |
| `HITLP_TOKEN` (env) | no | Over stdio only: the stdio client's token (default `local`). Not read over HTTP. |
| `--approvers <file>` | no | Human profiles `[{"credential", "id", "roles", "capabilities"}]`; turns on the decision page. |
| `--page-url <url>` | over HTTP with `--approvers` | The page's public base URL; an `https:` one marks the cookie `Secure`. Serve it behind TLS. |
| `--page-port <n>` | no (`8080`) | The decision page's port. |
| `--page-host <h>` | no (`127.0.0.1`) | The decision page's address. |
| `--admins <file>` | no | Rule administrators `[{"credential", "id"}]`; needs `--approvers`. |
| `--surfaces <file>` | no | Surfaces `[{"credential", "id", "human", "kind"}]`; turns on the surface API; needs `--approvers`. |
| `--surface-recent-hours <h>` | no (`24`) | How long decided tasks stay listed. |
| `--approve-cap-hours <h>` | no (`24`) | Approve TTL cap (R6). |
| `--ask-cap-hours <h>` | no (`168`) | Ask TTL cap (R6). |
| `--allow-blanket-scope` | no | Accept an Approve scope without `notAfter` or `maxUses`. |
| `--apns-key <file.p8>` | for push | APNs signing key. |
| `--apns-key-id`, `--apns-team-id`, `--apns-bundle-id` | for push | APNs key id, team id and app bundle id. |
| `--apns-sandbox` | no | Devices that name no environment use the APNs sandbox. |

### Container

`Dockerfile` builds from the repo root (it builds `sdks/typescript` first) and
runs the server with every setting as a flag: MCP and the surface API on 8080,
the decision page on 8081, the settings files read from `/etc/hitlp`
(`tokens.json`, `approvers.json`, `admins.json`, `surfaces.json`; `admins.json`
may be `[]`) and the SQLite store at `/var/lib/hitlp/tasks.db`. `--page-url`
has no default: pass it (and any other flag) after the image name.

```sh
docker build -f server/Dockerfile -t hitlp-server .
docker run -p 8080:8080 -p 8081:8081 \
  -v "$PWD/config:/etc/hitlp:ro" -v hitlp-data:/var/lib/hitlp \
  hitlp-server --page-url https://hitlp.example.com
```

The store is SQLite on the mounted volume, so **run a single replica**: two
servers on one database file would each sweep expiries and hold page sessions
of their own. On Kubernetes that is `replicas: 1` with `strategy: Recreate`, a
`ReadWriteOnce` PersistentVolumeClaim mounted at `/var/lib/hitlp`, and the
settings files from a Secret mounted read-only at `/etc/hitlp`. The image runs
as the `node` user (uid 1000); give the volume `fsGroup: 1000`. CI builds the
image on `server/**` changes and pushes nowhere.

#### Kubernetes (Kustomize base)

`deploy/k8s/base` is a Kustomize base of that shape: a Deployment
(`replicas: 1`, `Recreate`, `fsGroup: 1000`), a Service with ports `http`
(8080: MCP and the surface API) and `page` (8081: the decision page), a 1Gi
`ReadWriteOnce` PVC `hitlp-data` at `/var/lib/hitlp`, and an Ingress for the
placeholder host `hitlp.example.com`. It sets no namespace and carries no
secrets, registry, tag or real host. The readiness probe is `GET /login` on the
page port, which answers 200 without a token once the server listens.

The Secret `hitlp-settings` is mounted read-only at `/etc/hitlp` and must hold
`tokens.json`, `approvers.json`, `admins.json` and `surfaces.json`. The base
only names it: the overlay (or the cluster) creates it, and it is never
committed. The overlay supplies the namespace, the image name and tag, the
`--page-url` (the base's `https://hitlp.example.com` is a placeholder: patch
it), the Ingress host and its TLS, and the Secret:

```yaml
# kustomization.yaml in the site overlay
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: hitlp
resources:
  - https://github.com/codefrak-oss/hitlp//deploy/k8s/base?ref=main
images:
  - name: hitlp-server
    newName: registry.example:5000/hitlp-server
    newTag: "1.0.0"
patches:
  - target: {kind: Deployment, name: hitlp-server}
    patch: |
      - op: replace
        path: /spec/template/spec/containers/0/args
        value: ["--page-url", "https://hitlp.home.example"]
  - target: {kind: Ingress, name: hitlp-server}
    patch: |
      - op: replace
        path: /spec/rules/0/host
        value: hitlp.home.example
      - op: add
        path: /spec/tls
        value: [{hosts: [hitlp.home.example], secretName: hitlp-tls}]
```

For push, put the APNs key (the `.p8` file) in the same Secret, so it appears
under `/etc/hitlp`, and add `--apns-key /etc/hitlp/<key>.p8` and its ids
(`--apns-key-id`, `--apns-team-id`, `--apns-bundle-id`; see the flags table above) to the `args` value the overlay
already replaces.

### Mac (LaunchDaemon)

```sh
(cd sdks/typescript && npm ci && npm run build)
(cd server && npm ci && npm run build)
sudo server/packaging/install.sh --page-url https://hitlp.example.com
```

`packaging/install.sh` creates the hidden `_hitlp` service user, copies the
server to `/usr/local/lib/hitlp`, creates `/usr/local/etc/hitlp/` with
`tokens.json`, `approvers.json`, `admins.json` and `surfaces.json` (mode 0600,
owned by `_hitlp`, empty until you fill them in; never overwritten) and
`/var/db/hitlp/` for the SQLite store, writes
`/Library/LaunchDaemons/org.hitlp.server.plist` from `packaging/org.hitlp.server.plist`
and loads it. Both listeners bind `127.0.0.1` (MCP 8080, page 8081); put TLS in
front of the page. Logs go to `/var/log/hitlp.log`. After editing the settings:
`sudo launchctl kickstart -k system/org.hitlp.server`.
`sudo server/packaging/install.sh --uninstall` unloads the daemon and removes
it and the code; add `--purge` to remove settings, data, the log and the user.
