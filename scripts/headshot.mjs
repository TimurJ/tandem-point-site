/**
 * Crop the founder headshot to the square used by the founder note.
 *
 * The original is a 6240x4160 *landscape* greyscale frame, ~4 MB, with EXIF and an ICC profile.
 * None of that can go in public/ — Astro copies public/ byte-for-byte with no processing, so a file
 * there is never resized, converted or hashed. The cropped output goes to src/assets/ instead, where
 * astro:assets can transform it at build time.
 *
 * The crop box is measured, not eyeballed: the image was thresholded at 1/20 scale and scanned row
 * by row for the subject's horizontal extent, which put the head centre at x=3040 (stable across 20
 * rows), the top of the hair at y=280 and the chin at y=2360. The box below centres that head and
 * leaves ~10% headroom above the hair, so the head fills roughly three quarters of the circle — the
 * framing that still reads at 64px.
 *
 * `orientation: 1` on the source, so there is no EXIF rotation to compensate for and the crop box is
 * the pixel box.
 *
 * Output is committed, so this only needs re-running if the source photo changes. Note that the
 * original is gitignored (it is 4 MB), so unlike `pnpm og` this is not reproducible from a fresh
 * clone — it is a record of the crop numbers.
 *
 * Run: pnpm headshot
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Overridable so a re-shoot does not need an edit: pnpm headshot -- path/to/new.jpg
const src = resolve(root, process.argv[2] ?? 'IMG_5277 retouched bw.jpg');
const out = resolve(root, 'src/assets/timur.jpg');

// Measured crop box. See the header comment.
const CROP = { left: 1653, top: 3, width: 2773, height: 2773 };

// 512 rather than the 128 the 2x circle needs: it costs ~18 KB in the repo, drops the EXIF/ICC
// baggage, and leaves headroom if the photo is ever used larger. Astro downscales from it.
const SIZE = 512;

await mkdir(dirname(out), { recursive: true });

const meta = await sharp(src).metadata();
if (
  CROP.left + CROP.width > meta.width ||
  CROP.top + CROP.height > meta.height
) {
  throw new Error(
    `Crop box ${CROP.width}x${CROP.height} at (${CROP.left},${CROP.top}) does not fit in ` +
      `${meta.width}x${meta.height}. The source changed — re-measure before trusting these numbers.`,
  );
}

const info = await sharp(src)
  .extract(CROP)
  .resize(SIZE, SIZE)
  .jpeg({ quality: 82, mozjpeg: true })
  .toFile(out);

console.log(
  `timur.jpg    ${info.width}x${info.height}, ${(info.size / 1024).toFixed(1)} KB ` +
    `(from ${meta.width}x${meta.height})`,
);
