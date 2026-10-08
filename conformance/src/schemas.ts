// The spec's JSON Schemas (spec/schemas), loaded into ajv: every request the
// suite sends and every decision record a server returns is checked against them.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

const BASE = "https://github.com/codefrak-oss/hitlp/spec/schemas/";

export class Schemas {
  private readonly ajv = new Ajv2020({ allErrors: true, strict: false });

  constructor(dir: string) {
    addFormats(this.ajv);
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".schema.json"))) {
      this.ajv.addSchema(JSON.parse(readFileSync(join(dir, f), "utf8")));
    }
  }

  /** Errors of `value` against e.g. "ask.request", empty when it is valid. */
  errors(name: string, value: unknown): string[] {
    const validate = this.ajv.getSchema(`${BASE}${name}.schema.json`);
    if (!validate) throw new Error(`no schema ${name}`);
    return validate(value) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`);
  }

  /** Throws when `value` does not match. */
  assert(name: string, value: unknown, what = name): void {
    const errors = this.errors(name, value);
    if (errors.length > 0) throw new Error(`${what} does not match ${name}.schema.json: ${errors.join("; ")}`);
  }
}
