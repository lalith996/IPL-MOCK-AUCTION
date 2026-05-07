/**
 * Schema validation for LLM responses.
 *
 * Validates the raw text response against agent_output.schema.json using AJV.
 * On failure, surfaces structured error messages for the repair prompt.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

// AJV 8 ships CJS only; use createRequire to load it correctly under Node16 ESM.
const _require = createRequire(import.meta.url);

// Narrow types for what we actually use from AJV.
type ErrorObject = { instancePath: string; message?: string };
type ValidateFn = ((data: unknown) => boolean) & { errors?: ErrorObject[] | null };
type AjvCtor = new (opts: object) => { compile: (schema: object) => ValidateFn };
type AddFormatsFn = (ajv: object) => void;


const AjvClass: AjvCtor = _require("ajv");

const addFormats: AddFormatsFn = _require("ajv-formats");

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(
  __dirname,
  "../../../packages/schemas/src/agent_output.schema.json",
);

const _ajv = new AjvClass({ allErrors: true, strict: false });
addFormats(_ajv);

// Load and compile schema once at module init.
const _schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as object;
const _validate = _ajv.compile(_schema);

export interface ValidationResult {
  valid: true;
  data: unknown;
}

export interface ValidationFailure {
  valid: false;
  errors: string[];
  raw: string;
}

export type ValidationOutcome = ValidationResult | ValidationFailure;

/**
 * Parse `raw` as JSON and validate against agent_output.schema.json.
 */
export function validateAgentOutput(raw: string): ValidationOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      valid: false,
      errors: [`Response is not valid JSON: ${raw.slice(0, 200)}`],
      raw,
    };
  }

  const ok = _validate(parsed);
  if (ok) {
    return { valid: true, data: parsed };
  }

  const errors = (_validate.errors ?? []).map(
    (e) => `${e.instancePath || "root"} — ${e.message ?? "unknown error"}`,
  );
  return { valid: false, errors, raw };
}
