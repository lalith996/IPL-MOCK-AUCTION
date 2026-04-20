#!/usr/bin/env node
/**
 * Generates TypeScript types from all JSON Schemas in src/.
 * Run via: pnpm --filter @ipl/schemas generate
 */

import { compile } from 'json-schema-to-typescript';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dir, '..', 'src');
const outDir = join(__dir, '..', 'ts');

mkdirSync(outDir, { recursive: true });

const schemaFiles = readdirSync(srcDir).filter((f) => f.endsWith('.schema.json'));

const bannerLines = [
  '// AUTO-GENERATED — do not edit manually.',
  '// Run `make schemas` to regenerate.',
  '',
];

const indexLines = [...bannerLines];

for (const file of schemaFiles) {
  const schema = JSON.parse(readFileSync(join(srcDir, file), 'utf-8'));
  const typeName = basename(file, '.schema.json');
  const outFile = join(outDir, `${typeName}.ts`);

  const ts = await compile(schema, typeName, {
    bannerComment: bannerLines.join('\n'),
    additionalProperties: false,
    strictIndexSignatures: true,
    unknownAny: false,
  });

  writeFileSync(outFile, ts);
  console.log(`Generated ${outFile}`);

  indexLines.push(`export * from './${typeName}.js';`);
}

writeFileSync(join(outDir, 'index.ts'), indexLines.join('\n') + '\n');
console.log('Generated ts/index.ts');
