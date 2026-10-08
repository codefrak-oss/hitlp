# HITLP SDKs

SDKs for HITLP, the human-in-the-loop-protocol. Each implements
**HITLP v1.0 (draft)**, [spec/hitlp.md](../spec/hitlp.md), on the client side: the
Ask and Approve primitives, the request envelope, the decision record, and the MCP
Tasks lifecycle (call, poll, cancel, resume).

| SDK | Directory | Build and test |
| --- | --- | --- |
| TypeScript (`@codefrak/hitlp`) | [typescript/](typescript/README.md) | `cd sdks/typescript && npm ci && npm run build && npm test` |
| Python (`hitlp`) | [python/](python/README.md) | `cd sdks/python && pip install -e '.[test]' && pytest` |

TypeScript and Python are the two languages most agent tooling, and the MCP SDKs
themselves, are written in.

## Shared schemas

Both SDKs validate against the spec's own JSON schemas, vendored from `spec/schemas`
(and `spec/examples`, for tests) by:

```sh
node sdks/scripts/sync-schemas.mjs          # copy spec/ into the SDKs
node sdks/scripts/sync-schemas.mjs --check  # fail on drift (CI runs this)
```

Edit the spec, never the vendored copies. CI is `.github/workflows/sdks.yml`.
