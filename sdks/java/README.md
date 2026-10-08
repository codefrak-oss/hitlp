# org.codefrak:hitlp (Java)

Java SDK for HITLP, the human-in-the-loop-protocol.

**Implements HITLP v1.0 (draft)**: [spec/hitlp.md](../../spec/hitlp.md).

It is a client-side SDK: it builds and validates `human.ask` and `human.approve`
requests, calls them over MCP Tasks, polls or cancels the task, and interprets the
decision record. It does not implement a HITLP server. It mirrors the
[TypeScript SDK](../typescript/README.md) module for module.

## Install

Not yet published. From a checkout, use it as a Gradle included build
(`includeBuild("path/to/sdks/java")`, then `implementation("org.codefrak:hitlp")`),
as [demos/java](../../demos/java/README.md) does, or `./gradlew publishToMavenLocal`
after adding `maven-publish`.

- Java 17 or later; the build compiles with `--release 17`.
- Gradle, through the checked-in wrapper (`./gradlew`): CI needs only a JDK.
- JSON: Jackson (`jackson-databind`); requests and decision records are plain JSON
  values (`Map`, `List`, `String`, `Number`, `Boolean`, `null`).
- Validation: [networknt json-schema-validator](https://github.com/networknt/json-schema-validator)
  (JSON Schema 2020-12, with `format` asserted). It logs through SLF4J; add a
  binding (or `slf4j-nop`) to your application if you want its warnings gone.

## Use

```java
import org.codefrak.hitlp.*;

HitlpClient client = new HitlpClient(myTransport); // your MCP client, adapted to TaskTransport

ApproveRequest request = Approve.buildApprove(Approve.input()
        .deadline("2026-10-15T12:00:00Z") // defaultOnTimeout defaults to "reject"
        .requires(Map.of("roles", List.of("approver.production-deploy")))
        .action("Deploy release 4.21 to production")
        .payload(Map.of("service", "billing", "version", "4.21.0"))
        .payloadDigest("sha256:9f2c1e0a"));

Task task = client.approve(request); // returns the handle at once (R1)
save(Checkpoint.forTask(task, request, Primitive.APPROVE).serialize()); // before yielding (R3)

// ...later, perhaps in another process:
Checkpoint cp = Checkpoint.parse(load());
Resolution result = client.resume(cp); // polls tasks/get at pollInterval
if (result.kind() == Resolution.Kind.DECIDED && Decisions.isApproved(result.record(), cp)) deploy();
// Anything else (rejected, timed_out, cancelled, failed, digest mismatch) is not approval (R2).
```

`Ask.buildAsk(Ask.input().question(...).responseSchema(...).deadline(...).defaultOnTimeout(...))`
works the same way; `Decisions.answerOf(record, String.class)` gives the validated answer.

### URL-mode decisions and `input_required`

A task carries the server's `_meta` object as `task.meta()` (a `Map<String, Object>`), `null` when the server sent
none. When a URL-mode Approve puts the task into `input_required`, the server puts
the decision page's URL in `_meta` under `io.hitlp/decisionUrl`; `task.decisionUrl()` returns it
when it is a string, else `null`. For compatibility the server also sends the
URL in `statusMessage`, so fall back to that.

`WaitOptions.onInputRequired` is called once per entry into `input_required`, not on every poll: when
the wait starts on an `input_required` task, and each time a poll sees
`input_required` after another status (`input_required` -> `working` ->
`input_required` calls it twice). Its task argument carries that poll's meta and
decision URL, so opening the URL there opens it once.

```java
Task done = client.waitForTerminal(task, new HitlpClient.WaitOptions()
        .onInputRequired(t -> openInBrowser(t.decisionUrl() != null ? t.decisionUrl() : t.statusMessage())));
```

### What the SDK covers

| Spec | SDK |
| --- | --- |
| Envelope (§5) | `Envelope.buildEnvelope`; every builder input (`EnvelopeInput`) takes its fields |
| Ask (§4.1), Approve (§4.2) | `Ask.buildAsk`, `Approve.buildApprove` (to `AskRequest`, `ApproveRequest`) |
| Decision record (§6) | `DecisionRecord`, `Decisions.resolve`, `Decisions.isApproved`, `Decisions.answerOf`, `Decisions.verifyPayloadDigest` |
| Tools, Task lifecycle (§7.1–7.4) | `HitlpClient`: `ask`, `approve`, `get`, `cancel`, `waitForTerminal` (with `CancelSignal`), `resume` |
| R1 handle, R2 no approval from silence | handles return at once; only `approved` with a matching digest is approval |
| R3 resumable agents | `Checkpoint.forTask`, `Checkpoint.serialize`, `Checkpoint.parse` |
| R4 idempotency | `Idempotency.newIdempotencyKey`; client retries resend the same key |
| Reserved primitives (§4) | `human.do` / `human.inform` / `human.escalate` throw `ReservedToolException` |
| Schemas | `Validation.validate(name, value)`; the spec's schemas are vendored in `src/main/resources/hitlp/schemas/` |

The transport is three methods (`callTool`, `getTask`, `cancelTask`), so the SDK
does not depend on a particular MCP SDK. `org.codefrak.hitlp.testing.FakeTransport`
is an in-memory transport for unit tests only; an in-memory task store is not a
conforming server.

`waitForTerminal` and `resume` throw `java.util.concurrent.CancellationException`
once their `CancelSignal` is cancelled (which wakes a sleeping poll at once), and
`InterruptedException` if the thread is interrupted. Cancelling the signal stops
the wait, not the task: call `cancel(taskId)` for that.

## Build and test

```sh
cd sdks/java
./gradlew test
```

The vendored schemas and examples come from `spec/` through
`node sdks/scripts/sync-schemas.mjs`; do not edit them by hand.
