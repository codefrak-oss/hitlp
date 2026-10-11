// The spec's JSON Schemas (spec/schemas), loaded into ajv: every request the
// suite sends and every decision record a server returns is checked against them.
// The surface API's schemas (spec 7.8) sit in spec/schemas/surface, its examples
// in spec/examples/surface; every example is checked against its schema.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

const BASE = "https://github.com/codefrak-oss/hitlp/spec/schemas/";

export class Schemas {
  private readonly ajv = new Ajv2020({ allErrors: true, strict: false });

  constructor(readonly dir: string) {
    addFormats(this.ajv);
    for (const sub of ["", "surface"]) {
      const d = join(dir, sub);
      if (!existsSync(d)) continue;
      for (const f of readdirSync(d).filter((f) => f.endsWith(".schema.json"))) {
        this.ajv.addSchema(JSON.parse(readFileSync(join(d, f), "utf8")));
      }
    }
  }

  /**
   * Checks every example in `dir` (spec/examples) and its surface/ subdirectory
   * against the schema of the same name; returns the errors, empty when all match.
   */
  exampleErrors(dir: string): string[] {
    const errors: string[] = [];
    let checked = 0;
    for (const sub of ["", "surface/"]) {
      const d = join(dir, sub);
      if (!existsSync(d)) continue;
      for (const f of readdirSync(d).filter((f) => f.endsWith(".json"))) {
        const name = `${sub}${f.replace(/\.json$/, "")}`;
        checked++;
        for (const e of this.errors(name, JSON.parse(readFileSync(join(d, f), "utf8")))) errors.push(`${sub}${f}: ${e}`);
      }
    }
    if (checked === 0) errors.push(`no examples in ${dir}`);
    return errors;
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
