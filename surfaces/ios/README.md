# HITLP iPhone surface

An iPhone app that is a HITLP surface (spec/hitlp.md 7.7) for one human: the
reference client of the surface API (7.8). It talks only to a HITLP server's
surface API, over HTTPS and JSON under a base URL ending `/surface/v1`, with a
Bearer surface credential.

- Lists your open and recently decided tasks (`GET /tasks`), newest first, and
  keeps the list current from `GET /events` while it is on screen.
- Shows one task (`GET /tasks/{id}`): what is asked and the requester's
  recommendation first, then **Verified by the server** (`attested`: who asked,
  green) and **Claimed by the requester, not verified** (`asserted`: why, the
  recommendation's verdict, confidence, judge and reasons, and the lineage,
  collapsed, newest first; amber). An Approve's payload is shown exactly as the
  server sent it.
- Decides with deliberate taps (no swipe): Approve offers a reason, Reject
  requires one, and both send the `payloadDigest` of the view on screen. An Ask
  gets a picker over its `options`, or an input matched to its
  `responseSchema` (string, number, integer, boolean, enum; anything else as
  JSON).
- Registers for push and opens the task a notification names; the
  notification carries only a title and the task id.
- Holds two servers (say, the cluster instance and the laptop instance), each
  with its own credential, in the Keychain, and uses the first, in order, whose
  `GET /tasks` answers 200.

## Layout

| Path | What |
| --- | --- |
| `Package.swift`, `Sources/HITLPSurfaceKit/` | The client package, Foundation only: the surface API types, `SurfaceClient` (the six routes), `SurfaceError` (400, 401, 404, 409), `SSEParser`, `ServerPicker`, `PushPayload`. |
| `Tests/HITLPSurfaceKitTests/` | Package tests: every file in `spec/examples/surface/`, the encodings against `spec/schemas/surface/`, the routes and errors against a stubbed `URLSession`, the event stream. |
| `App/HITLPSurface.xcodeproj`, `App/HITLPSurface/` | The SwiftUI app; it depends on the package by relative path. |

Run the package tests on a Mac (Xcode 15.3 or later) from this directory:

```sh
swift test
```

## Install on your phone over USB

You need a Mac with Xcode 16 or later and an Apple ID; push needs a paid Apple
Developer Program team (a free personal team installs the app, but cannot use
push).

1. Open `App/HITLPSurface.xcodeproj` in Xcode.
2. Select the **HITLPSurface** target, **Signing & Capabilities**:
   - **Team**: your team.
   - **Bundle Identifier**: change `org.hitlp.surface` to one of yours, e.g.
     `com.<you>.hitlp`. It must be unique to your team; the server's
     `--apns-bundle-id` must be the same.
   - **Push Notifications**: the capability is already declared
     (`HITLPSurface.entitlements`); if Xcode lists it as missing, add it with
     **+ Capability → Push Notifications**. Also keep **Background Modes →
     Remote notifications**.
3. Connect the iPhone by USB, unlock it and trust the Mac. On iOS 16 and later
   turn on **Settings → Privacy & Security → Developer Mode** and restart when
   asked.
4. Pick the phone as the run destination and press **Run** (⌘R). On the first
   run with a personal team, trust the developer under **Settings → General →
   VPN & Device Management**.
5. In the app, allow notifications, open **Settings** (the gear) and enter one
   or both servers: a name, the base URL ending `/surface/v1`, and the surface
   credential the server's `--surfaces` file gives your phone. **Save**. The
   credentials stay in the phone's Keychain; nothing is written to the repo.

### Push

1. In the Apple Developer portal, **Certificates, Identifiers & Profiles →
   Keys**, create a key with **Apple Push Notifications service (APNs)** and
   download `AuthKey_<KEYID>.p8` (once only). Note the key id and your team id.
2. A build run from Xcode is a **development** build (Debug configuration): its
   device token belongs to the APNs **sandbox**, and the app registers it with
   `"environment": "sandbox"`. A Release (TestFlight, App Store) build registers
   `"production"`.
3. Start the server with the key (see [server/README.md](../../server/README.md),
   "Surface API"):

   ```sh
   --apns-key AuthKey_<KEYID>.p8 --apns-key-id <KEYID> \
   --apns-team-id <TEAMID> --apns-bundle-id <your bundle id> --apns-sandbox
   ```

   The app names its environment on every device, so the server sends a
   development build's pushes to the sandbox; `--apns-sandbox` is the default
   for devices that name none.

On launch, and whenever you save Settings, the app puts the phone on every
configured server with `PUT /devices/{deviceId}` (`platform` `apns`, the
token, the environment and the phone's name). Tapping a notification opens its
task, fetched with the app's credential.

## Test against a local server

Run `server/` on your Mac with a surfaces file, and point the phone at the
Mac over HTTPS. The app refuses any base URL that is not `https://`: the
surface credential is a bearer token, and anyone who sees it on the network can
decide tasks as you. Put TLS in front of the server, for example a reverse
proxy (Caddy, nginx) with a certificate from `mkcert` whose root CA you install
and trust on the phone (Settings > General > About > Certificate Trust
Settings), or a tunnel that terminates HTTPS (Tailscale Serve, cloudflared).
Do not add an App Transport Security exception to get around this: with one,
the credential and every decision would cross the network unencrypted. Even
for testing, make the `--surfaces` credential a throwaway.

`surfaces.json`, one entry per surface; `human` is an approver id from
`--approvers`, `kind` becomes the decision records' `channel`:

```json
[
  { "credential": "<a long random string>", "id": "alice-phone", "human": "alice", "kind": "phone" }
]
```

Then, from `server/` (see its README for the other flags; `--http-host 0.0.0.0` lets the phone reach it, the default `127.0.0.1` does not):

```sh
npm install && npm run build
node dist/src/main.js --db hitlp.db --tokens tokens.json \
  --http-port 8080 --http-host 0.0.0.0 \
  --approvers approvers.json --surfaces surfaces.json
```

Point the TLS proxy or tunnel at port 8080. In the app, set the base URL to
`https://<your-proxy-or-tunnel-host>/surface/v1` and
the credential to the one in `surfaces.json`. Create a task with any SDK or
demo (`demos/`) and it appears in the list; decide it on the phone.

## Not in this app (yet)

- Entering a server by QR code (with the server packaging in hitlp#48).
- CI: no self-hosted macOS runner serves this repo, so there is no workflow;
  run `swift test` and build in Xcode on a Mac.
