/**
 * Generate the brand assets: the 1200x630 OG image, the wordmark SVG, and the favicon.
 *
 * satori lays out the nodes and emits glyph outlines (embedFont defaults to true), so the SVGs
 * carry <path> data and render correctly on a machine with no fonts installed. sharp rasterises
 * the OG SVG to PNG; its prebuilt libvips bundles librsvg, so no extra native dependency.
 *
 * satori accepts TTF, OTF and WOFF but NOT WOFF2, which is why this reads the .woff files from
 * the static @fontsource packages rather than the variable ones we actually serve.
 *
 * Nodes are written as plain { type, props } objects so the script needs no JSX transform.
 *
 * Output is committed. Run: pnpm og
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public');

const BG = '#0A0A0B';
const BORDER = '#1E1E22';
const TEXT = '#EDEDEF';
const MUTED = '#9A9AA4';
const ACCENT = '#3FB6A8';

const WORDMARK = 'Tandempoint';
const TAGLINE = 'Influencer Marketing for Developer Tools.';

const display = await readFile(
  resolve(root, 'node_modules/@fontsource/instrument-sans/files/instrument-sans-latin-600-normal.woff'),
);
const body = await readFile(
  resolve(root, 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff'),
);

const fonts = [
  { name: 'Instrument Sans', data: display, weight: 600, style: 'normal' },
  { name: 'Inter', data: body, weight: 400, style: 'normal' },
];

/** Wordmark text with the full stop in the accent colour. */
const wordmark = (fontSize) => ({
  type: 'div',
  props: {
    style: {
      display: 'flex',
      fontFamily: 'Instrument Sans',
      fontWeight: 600,
      fontSize,
      letterSpacing: `${(-0.02 * fontSize).toFixed(2)}px`,
      color: TEXT,
    },
    children: [
      { type: 'span', props: { children: WORDMARK } },
      { type: 'span', props: { style: { color: ACCENT }, children: '.' } },
    ],
  },
});

await mkdir(out, { recursive: true });

// 1. Open Graph image ------------------------------------------------------------------------
const ogSvg = await satori(
  {
    type: 'div',
    props: {
      style: {
        width: '1200px',
        height: '630px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '0 96px',
        backgroundColor: BG,
        position: 'relative',
      },
      children: [
        // Hairline inset frame, the same border colour the site uses.
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              top: '40px',
              left: '40px',
              right: '40px',
              bottom: '40px',
              border: `1px solid ${BORDER}`,
              borderRadius: '10px',
            },
          },
        },
        wordmark(104),
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              marginTop: '28px',
              fontFamily: 'Inter',
              fontWeight: 400,
              fontSize: '34px',
              color: MUTED,
            },
            children: TAGLINE,
          },
        },
      ],
    },
  },
  { width: 1200, height: 630, fonts },
);

const png = await sharp(Buffer.from(ogSvg)).png({ compressionLevel: 9 }).toBuffer();
await writeFile(resolve(out, 'og.png'), png);
const meta = await sharp(png).metadata();
console.log(`og.png       ${meta.width}x${meta.height}, ${(png.length / 1024).toFixed(1)} KB`);

// 2. Wordmark SVG ----------------------------------------------------------------------------
const markSvg = await satori(
  {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        alignItems: 'center',
        height: '80px',
        padding: '0 4px',
      },
      children: [wordmark(64)],
    },
  },
  { width: 420, height: 80, fonts },
);
await writeFile(resolve(out, 'wordmark.svg'), markSvg);
console.log(`wordmark.svg ${(markSvg.length / 1024).toFixed(1)} KB`);

// 3. Favicon: the "T" alone, its own pass, because satori merges a text run into one path -----
const faviconSvg = await satori(
  {
    type: 'div',
    props: {
      style: {
        width: '64px',
        height: '64px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: BG,
        fontFamily: 'Instrument Sans',
        fontWeight: 600,
        fontSize: '46px',
        color: ACCENT,
      },
      children: 'T',
    },
  },
  { width: 64, height: 64, fonts },
);
await writeFile(resolve(out, 'favicon.svg'), faviconSvg);
console.log(`favicon.svg  ${(faviconSvg.length / 1024).toFixed(1)} KB`);
