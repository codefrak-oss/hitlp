# Codefrak.Hitlp (.NET)

.NET SDK for HITLP, the human-in-the-loop-protocol.

**Implements HITLP v1.0 (draft)**: [spec/hitlp.md](../../spec/hitlp.md).

It is a client-side SDK: it builds and validates `human.ask` and `human.approve`
requests, calls them over MCP Tasks, polls or cancels the task, and interprets the
decision record. It does not implement a HITLP server. It mirrors the
[Java SDK](../java/README.md) and the [TypeScript SDK](../typescript/README.md)
module for module.

## Install

Not yet published. From a checkout, add a project reference to
`sdks/dotnet/src/Codefrak.Hitlp/Codefrak.Hitlp.csproj`, as
[demos/dotnet](../../demos/dotnet/README.md) does, or `dotnet pack` it into a local feed.

- .NET 8 (`net8.0`).
- JSON: `System.Text.Json`; requests and decision records are `JsonNode` values
  (`JsonObject`, `JsonArray`, `JsonValue`).
- Validation: [JsonSchema.Net](https://github.com/json-everything/json-everything)
  (JSON Schema 2020-12, with `format` asserted: `date-time` and `uri`, the only
  formats the spec's schemas use, are both checked).

## Use

```csharp
using System.Text.Json.Nodes;
using Codefrak.Hitlp;

var client = new HitlpClient(myTransport); // your MCP client, adapted to TaskTransport

var request = Approve.BuildApprove(new Approve.Input
{
    Deadline = "2026-10-15T12:00:00Z", // DefaultOnTimeout defaults to "reject"
    Requires = new JsonObject { ["roles"] = new JsonArray("approver.production-deploy") },
    Action = "Deploy release 4.21 to production",
    Payload = new JsonObject { ["service"] = "billing", ["version"] = "4.21.0" },
    PayloadDigest = "sha256:9f2c1e0a",
});

var task = await client.ApproveAsync(request); // returns the handle at once (R1)
Save(Checkpoint.ForTask(task, request, Primitive.Approve).Serialize()); // before yielding (R3)

// ...later, perhaps in another process:
var cp = Checkpoint.Parse(Load());
var result = await client.ResumeAsync(cp, cancellationToken: ct); // polls tasks/get at pollInterval
if (result.Kind == ResolutionKind.Decided && Decisions.IsApproved(result.Record, cp)) Deploy();
// Anything else (rejected, timed_out, cancelled, failed, digest mismatch) is not approval (R2).
```

`Ask.BuildAsk(new Ask.Input { Question = ..., ResponseSchema = ..., Deadline = ..., DefaultOnTimeout = ... })`
works the same way; `Decisions.AnswerOf<string>(record)` gives the validated answer.
`Hitlp.FormatDateTime(DateTimeOffset)` formats a deadline as RFC 3339.

### What the SDK covers

| Spec | SDK |
| --- | --- |
| Envelope (§5) | `Envelope.BuildEnvelope`; every builder input (`EnvelopeInput`) takes its fields |
| Ask (§4.1), Approve (§4.2) | `Ask.BuildAsk`, `Approve.BuildApprove` (to `AskRequest`, `ApproveRequest`) |
| Decision record (§6) | `DecisionRecord`, `Decisions.Resolve`, `Decisions.IsApproved`, `Decisions.AnswerOf`, `Decisions.VerifyPayloadDigest` |
| Tools, Task lifecycle (§7.1–7.4) | `HitlpClient`: `AskAsync`, `ApproveAsync`, `GetAsync`, `CancelAsync`, `WaitForTerminalAsync` (with a `CancellationToken`), `ResumeAsync` |
| R1 handle, R2 no approval from silence | handles return at once; only `approved` with a matching digest is approval |
| R3 resumable agents | `Checkpoint.ForTask`, `Checkpoint.Serialize`, `Checkpoint.Parse` |
| R4 idempotency | `Idempotency.NewIdempotencyKey`; client retries resend the same key |
| Reserved primitives (§4) | `human.do` / `human.inform` / `human.escalate` throw `ReservedToolException` |
| Schemas | `Validation.Validate(name, value)`; the spec's schemas are vendored in `src/Codefrak.Hitlp/Schemas/` as embedded resources |

The transport is an abstract class with three methods (`CallToolAsync`,
`GetTaskAsync`, `CancelTaskAsync`), so the SDK does not depend on a particular MCP
SDK. `Codefrak.Hitlp.Testing.FakeTransport` is an in-memory transport for unit tests
only; an in-memory task store is not a conforming server.

The client is async, as .NET I/O is, so its methods carry the `Async` suffix. The
task handle is `HitlpTask` and its status `HitlpTaskStatus`, so neither clashes
with `System.Threading.Tasks`. `WaitForTerminalAsync` and `ResumeAsync` throw
`OperationCanceledException` once their `CancellationToken` is cancelled (which
wakes a sleeping poll at once). Cancelling the token stops the wait, not the task:
call `CancelAsync(taskId)` for that. Transport exceptions propagate unchanged.

## Build and test

```sh
cd sdks/dotnet
dotnet test
```

The vendored schemas (`src/Codefrak.Hitlp/Schemas/`) and examples
(`tests/Codefrak.Hitlp.Tests/Examples/`) come from `spec/` through
`node sdks/scripts/sync-schemas.mjs`; do not edit them by hand.
