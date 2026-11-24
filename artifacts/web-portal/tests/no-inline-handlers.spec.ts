import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

test('portal sources contain no inline HTML event handlers', () => {
  const files = [
    ...filesUnder(path.join(root, 'public')),
    ...filesUnder(path.join(root, 'templates')),
    path.join(root, 'src/server.ts'),
  ];
  const violations: string[] = [];
  // Scan the raw sources too: generated attribute fragments must not escape
  // the guard merely because they are outside a complete HTML tag.
  // No allowlist is needed. JS onSuccess comparisons do not match assignments.
  const handler = /\son[a-z]+\s*=\s*["'$]/ig;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(handler)) {
      const line = source.slice(0, match.index).split('\n').length;
      violations.push(`${path.relative(root, file)}:${line}: ${match[0].trim()}`);
    }
  }
  expect(violations, 'Use script listeners/delegation instead of HTML handlers').toEqual([]);
});
