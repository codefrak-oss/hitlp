#!/usr/bin/env node
// Vendors the HITLP spec's JSON schemas and examples into each SDK.
//
//   node sdks/scripts/sync-schemas.mjs          copy spec/ into the SDKs
//   node sdks/scripts/sync-schemas.mjs --check  fail if any SDK copy has drifted
//
// spec/ is the source of truth; never edit the vendored copies by hand.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const check = process.argv.includes("--check");

const targets = [
  { from: "spec/schemas", to: "sdks/typescript/src/schemas" },
  { from: "spec/examples", to: "sdks/typescript/test/examples" },
  { from: "spec/schemas", to: "sdks/python/src/hitlp/schemas" },
  { from: "spec/examples", to: "sdks/python/tests/examples" },
];

let drift = 0;
for (const { from, to } of targets) {
  const src = join(root, from);
  const dst = join(root, to);
  const want = readdirSync(src).filter((f) => f.endsWith(".json")).sort();
  const have = existsSync(dst) ? readdirSync(dst).filter((f) => f.endsWith(".json")).sort() : [];
  for (const extra of have.filter((f) => !want.includes(f))) {
    console.error(`drift: ${to}/${extra} is not in ${from}`);
    drift++;
  }
  if (!check) mkdirSync(dst, { recursive: true });
  for (const file of want) {
    const body = readFileSync(join(src, file));
    const target = join(dst, file);
    const same = existsSync(target) && readFileSync(target).equals(body);
    if (same) continue;
    if (check) {
      console.error(`drift: ${to}/${file} differs from ${from}/${file}`);
      drift++;
    } else {
      writeFileSync(target, body);
      console.log(`synced ${to}/${file}`);
    }
  }
}
if (check && drift > 0) {
  console.error(`${drift} vendored file(s) out of date; run: node sdks/scripts/sync-schemas.mjs`);
  process.exit(1);
}
if (check) console.log("vendored schemas and examples match spec/");
