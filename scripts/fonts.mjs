/**
 * Copy the exact font files we serve out of node_modules and into public/fonts.
 *
 * We deliberately do not import the @fontsource CSS. Astro would bundle those files under a
 * content-hashed URL, and a hashed URL cannot be named in a <link rel="preload">. Copying gives
 * us stable paths, so global.css can declare its own @font-face and Base.astro can preload both
 * files on the critical path. It also means we ship two files instead of the whole family.
 *
 * The @fontsource packages stay devDependencies: they are the source of the bytes, not a runtime.
 *
 * Run: pnpm fonts
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public/fonts');

const files = [
  // Inter variable (weight axis), latin subset: body text.
  [
    'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
    'inter-latin-wght-normal.woff2',
  ],
  // Instrument Sans 600, latin subset: wordmark and headings.
  [
    'node_modules/@fontsource/instrument-sans/files/instrument-sans-latin-600-normal.woff2',
    'instrument-sans-600.woff2',
  ],
];

await mkdir(out, { recursive: true });

for (const [from, to] of files) {
  await copyFile(resolve(root, from), resolve(out, to));
  console.log(`fonts: ${to}`);
}
