#!/usr/bin/env node
/**
 * Validates all golden fixtures against their JSON Schemas.
 * Run via: pnpm --filter @ipl/schemas validate
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync, readdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dir, '..', 'src');
const fixturesDir = join(__dir, '..', 'fixtures');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Load all schemas
const schemaMap = {};
const schemaFiles = readdirSync(srcDir).filter((f) => f.endsWith('.schema.json'));
for (const file of schemaFiles) {
  const schema = JSON.parse(readFileSync(join(srcDir, file), 'utf-8'));
  const key = basename(file, '.schema.json');
  ajv.addSchema(schema, key);
  schemaMap[key] = schema;
}

// Validate fixtures
const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith('.fixture.json'));
let failures = 0;

for (const file of fixtureFiles) {
  const schemaKey = basename(file, '.fixture.json');
  if (!schemaMap[schemaKey]) {
    console.warn(`No schema found for fixture: ${file}`);
    continue;
  }
  const fixture = JSON.parse(readFileSync(join(fixturesDir, file), 'utf-8'));
  const valid = ajv.validate(schemaKey, fixture);
  if (valid) {
    console.log(`✓ ${file}`);
  } else {
    console.error(`✗ ${file}`);
    console.error(ajv.errorsText());
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} fixture(s) failed validation.`);
  process.exit(1);
} else {
  console.log(`\nAll ${fixtureFiles.length} fixtures valid.`);
}
