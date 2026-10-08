# HITLP SDKs

SDKs for HITLP, the human-in-the-loop-protocol. Each implements
**HITLP v1.0 (draft)**, [spec/hitlp.md](../spec/hitlp.md), on the client side: the
Ask and Approve primitives, the request envelope, the decision record, and the MCP
Tasks lifecycle (call, poll, cancel, resume).

| SDK | Directory | Build and test |
| --- | --- | --- |
| TypeScript (`@codefrak/hitlp`) | [typescript/](typescript/README.md) | `cd sdks/typescript && npm ci && npm run build && npm test` |
| Python (`hitlp`) | [python/](python/README.md) | `cd sdks/python && pip install -e '.[test]' && pytest` |
| Java (`org.codefrak:hitlp`) | [java/](java/README.md) | `cd sdks/java && ./gradlew test` |
| .NET (`Codefrak.Hitlp`) | [dotnet/](dotnet/README.md) | `cd sdks/dotnet && dotnet test` |

TypeScript and Python are the two languages most agent tooling, and the MCP SDKs
themselves, are written in; Java serves agents on the JVM, and .NET agents on .NET.

## Shared schemas

Every SDK validates against the spec's own JSON schemas, vendored from `spec/schemas`
(and `spec/examples`, for tests) by:

```sh
node sdks/scripts/sync-schemas.mjs          # copy spec/ into the SDKs
node sdks/scripts/sync-schemas.mjs --check  # fail on drift (CI runs this)
```

Edit the spec, never the vendored copies. CI is `.github/workflows/sdks.yml`.
