# Tandempoint

One-page marketing site for [tandempoint.io](https://tandempoint.io).

Astro 7 (static output), Tailwind CSS 4, TypeScript. No CMS, no framework islands: a single small
vanilla script drives the contact form, and one small Worker route receives it.

## Requirements

- Node 24 (pinned via `.node-version`; Astro 7's floor is 22.12.0, but 24 is the current Active LTS)
- pnpm 11 (pinned via `packageManager`)

## Local development

```sh
pnpm install
pnpm dev
```

`pnpm dev` serves the site but **not** `/api/contact`, which only exists in the Worker. Use
`pnpm dev:worker` when touching the form (see [Contact form](#contact-form)).

`pnpm install` needs to run esbuild's postinstall script, which pnpm 11 blocks by default. That one
package is allowed explicitly in `pnpm-workspace.yaml`. `workerd` (wrangler's runtime) is listed
there too, but **declined** rather than allowed (see the deploy section).

| Script | What it does |
| --- | --- |
| `pnpm dev` | Dev server on <http://localhost:4321>; no `/api/contact` |
| `pnpm dev:worker` | `astro build` then `wrangler dev`: the whole site *and* the contact endpoint |
| `pnpm build` | Static build to `dist/` |
| `pnpm preview` | Serve `dist/` locally |
| `pnpm fonts` | Re-copy the two woff2 files from `node_modules` into `public/fonts` |
| `pnpm og` | Regenerate `public/og.png`, `wordmark.svg`, `favicon.svg` |
| `pnpm headshot` | Re-crop the founder photo into `src/assets/timur.jpg` (see below) |
| `pnpm lh` | Lighthouse against `pnpm preview`, mobile (the stricter form factor) |
| `pnpm lh:desktop` | The same run with `--preset=desktop` |
| `pnpm deploy` | `wrangler deploy`: publishes `dist/` to the live Worker |

## Founder photo

`src/assets/timur.jpg` is a 512x512 crop, committed. It lives in `src/` rather than `public/`
deliberately: Astro copies `public/` byte-for-byte with no processing, so a file there is never
resized or converted, while `src/` assets go through `astro:assets` and ship as WebP (about 1.5 KB
at 1x, 3.7 KB at 2x). No JPEG is ever served.

`pnpm headshot` regenerates that crop from the original camera file, which is **gitignored**. It is
~4 MB, so unlike `pnpm og` this is not reproducible from a fresh clone. The committed output is what
matters; the script is a record of the measured crop box. Point it at a new original with:

```
pnpm headshot -- path/to/original.jpg
```

It fails loudly rather than mis-cropping if the new file is too small for the stored crop box.

## Contact form

The form POSTs JSON to `/api/contact` with `fetch` and stays on the page: inline success and error
states, no redirect. That route is handled by `src/worker.ts`, which relays the message to
[Resend](https://resend.com). There is no third-party form service and no build-time configuration
— the endpoint is a fixed same-origin path, so nothing about the form depends on the environment
it was built in.

`src/worker.ts` is the only dynamic code on the site. It answers `POST /api/contact` and 404s
everything else; every real page is a static asset served before the Worker runs. In order, a
submission is checked for:

- **Origin.** A wrong `Origin` is a 403. A *missing* one falls back to `Sec-Fetch-Site`, and a
  request with neither header is allowed through. That is deliberate: privacy extensions and
  corporate proxies strip `Origin`, and rejecting a real enquiry costs more than the spam a strict
  check would stop. Treat this as spam shaping, not a security control.
- **Size.** Bodies over 32 KB get a 413 before being parsed. The ceiling sits above the worst-case
  valid submission (a 5,000-character message is at most 20,000 bytes in UTF-8), so an over-long
  message always fails validation with a 400 rather than tripping this.
- **Rate limit.** Five per IP per ten minutes, held in a module-scope `Map`. **This is weak by
  construction**: Workers isolates are ephemeral and there are many per location, so a determined
  sender lands on a fresh isolate with an empty map. It catches a resubmit loop and nothing more.
  A Cache API counter or a Durable Object are the real upgrades; Cloudflare's native `ratelimits`
  binding is not one, because its `period` accepts only 10 or 60 seconds and cannot express a
  ten-minute window.
- **Honeypot.** A visually hidden, `aria-hidden`, untabbable `website` field. If it is filled in,
  the Worker returns an ordinary 200 and sends nothing, so a bot has nothing to tune against. This
  does most of the actual spam work.
- **Validation.** Name 1–100, message 1–5,000, a pragmatic email pattern, company optional. A
  failure returns 400 and a short message, which the form displays as-is; a rate limit or an
  upstream failure returns the same generic copy the client falls back to, so the page reads the
  same however it fails.

The Resend key never reaches the browser, and neither does Resend's response body — a failed send
is logged for `wrangler tail` and answered with a 502.

### Running it locally

`wrangler dev` serves `dist/` and the Worker together, so the form only works end to end after a
build:

```sh
pnpm dev:worker
```

Secrets come from `.dev.vars`, which is gitignored:

```
RESEND_API_KEY=re_xxxxxxxx
ALLOW_LOCAL_ORIGIN=true
```

`ALLOW_LOCAL_ORIGIN` exists only for this: it widens the origin check to `http://localhost:…` and
`http://127.0.0.1:…`. Never set it in production.

## Generated assets

`public/og.png`, `public/wordmark.svg` and `public/favicon.svg` are generated by `scripts/og.mjs`
and committed. Run `pnpm og` after changing the wordmark, tagline or brand colours.

satori lays the assets out and emits glyph **outlines**, so the SVGs need no font installed to
render. It accepts TTF/OTF/WOFF but not WOFF2, which is why the script reads `.woff` files from the
static `@fontsource` packages while the site serves the WOFF2 variable fonts.

Fonts are copied into `public/fonts` instead of imported from `@fontsource` so their URLs stay
stable and can be named in `<link rel="preload">`; a content-hashed bundle URL cannot be.

## Cache headers

Cloudflare serves every static asset with `public, max-age=0, must-revalidate`. That is right for
`index.html` and the sitemaps, and wasteful for files that cannot change meaning, so `public/_headers`
overrides exactly two paths with a year-long immutable cache:

- `/_astro/*` carries a content hash in the filename, so a new build produces a new URL.
  Safe unconditionally.
- `/fonts/*` is **not** hash-named, per the note above. If a font is ever replaced, **rename the
  file**, or browsers holding a year-long entry will keep serving the old face. That rename is
  already required to update the `<link rel="preload">` in `src/layouts/Base.astro`, so it is one
  coordinated edit rather than a trap, but it is the reason this rule is worth knowing about.

`og.png`, `favicon.svg`, `wordmark.svg` and `robots.txt` get no rule on purpose: they are unhashed
and regenerated by `pnpm og`, so a long cache would strand a rebrand behind stale copies.

Two things about the `_headers` format, both confirmed against wrangler's parser rather than the
docs. A malformed line is skipped individually rather than failing the build, so a typo silently
means "no caching". Verify with `curl -I` against the deployed site, not with a green build. And a
line is treated as a new path rule purely by starting with `/`, so a header whose *value* begins
with a slash would be reparsed as a path and swallow the rules under it.

## Analytics

`src/layouts/Base.astro` carries the Cloudflare Web Analytics beacon, commented out. Paste the site
token from the Cloudflare dashboard (Web Analytics → Manage site) in place of `TOKEN` and uncomment.

Do **not** also enable any auto-injection toggle in the project settings. Enabling both injects the
beacon twice and double-counts every pageview.

## Deploying to Cloudflare Workers

Deployed as a **static-assets Worker**, not Cloudflare Pages: the dashboard labels the Pages
workflow legacy, and Cloudflare's own Astro guide now documents this path. `wrangler.jsonc` uploads
`dist/` and serves it from the edge, plus one Worker script (`main`) for `POST /api/contact`. There
is no `@astrojs/cloudflare` adapter, because no *page* is rendered on demand.

Asset serving takes precedence by default, so a request only reaches the Worker when no file in
`dist/` matches it. `run_worker_first` is deliberately not set — turning it on would route every
page view through the Worker for no benefit.

1. Push this repository to GitHub or GitLab.
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Continue with GitHub**, and pick the
   repo.
3. Build settings:
   - **Build command:** `pnpm build`
   - **Deploy command:** `pnpm deploy`
   - Leave the **non-production branch deploy command** at its `npx wrangler versions upload`
     default. Overriding it to `wrangler deploy` would make every branch push publish to the live
     site instead of producing a preview version.
4. **Settings → Variables and Secrets**, for the Production and Preview environments:
   - `PNPM_VERSION` = `11.17.0`. Not optional: the build image ships pnpm 10.11.1, which does not
     understand the `allowBuilds` key, so it blocks esbuild's postinstall and the install fails.
     The image does not read `packageManager` from `package.json`.
   - `RESEND_API_KEY` = your Resend API key, added as a **Secret**, not a plain variable. Either
     `pnpm exec wrangler secret put RESEND_API_KEY`, or Settings → Variables and Secrets → add →
     type **Secret**. It is the only credential the site has.
   - Do **not** add `CONTACT_FROM` or `CONTACT_TO` here. They live in `wrangler.jsonc` under
     `vars`, and that file is the source of truth: `wrangler deploy` deletes any var it does not
     find there, so a dashboard edit to either address would silently revert on the next deploy.
     (Secrets are exempt from that deletion, which is why the API key is one.) Changing the sender
     after verifying the domain in Resend is a one-line edit to `wrangler.jsonc` plus a redeploy.
   - Node needs no variable: `.node-version` covers it, and the docs do not say which wins if a
     version file and `NODE_VERSION` disagree, so only one of them is set.
5. Deploy. Every push to the default branch rebuilds and redeploys.
6. **Custom domains** → add `tandempoint.io` (and `www` if you want it redirected). Cloudflare
   issues the certificate.

### Why `workerd`'s build script is declined

`pnpm-workspace.yaml` sets `workerd: false`. pnpm needs the decision declared either way — an
undeclared build script fails the install — and declining skips `workerd`'s postinstall.

**This does not avoid the download**, despite what this section used to claim. `workerd` ships its
runtime through `optionalDependencies` (`@cloudflare/workerd-darwin-arm64` and siblings), not
through the postinstall, so pnpm installs the ~142 MB binary regardless of the `allowBuilds`
setting. Declining skips a validation script, nothing more. Verified by running the binary with the
script still declined:

```
$ node_modules/.pnpm/workerd@*/node_modules/workerd/bin/workerd --version
workerd 2026-08-25
```

That is a good thing here, because `pnpm dev:worker` needs that runtime. The cost was always being
paid; now it is being used.

`wrangler` itself is pinned as a devDependency rather than run through `npx`, so the version is
reviewed in git rather than buried in a dashboard field. It is held one release behind latest when
necessary: pnpm 11 refuses packages published within its minimum release age, and forcing a
same-week release through that gate is not worth doing to skip a patch version.

Telemetry is off via `send_metrics: false` in `wrangler.jsonc`. Confirm with
`pnpm exec wrangler telemetry status`.

After the first deploy, update `site` in `astro.config.mjs` if the canonical host ever changes. It
is what generates the canonical URL, the absolute OG image URL, and `sitemap-index.xml`.

## Structure

```
scripts/          fonts.mjs (copy woff2), og.mjs (satori + sharp)
src/styles/       global.css (every design token lives in the @theme block)
src/layouts/      Base.astro (head, meta, OG/Twitter, font preloads, analytics)
src/components/   Nav, Hero, HowItWorks, WhoWeWorkWith, FounderNote, Contact, Footer
src/pages/        index.astro
src/worker.ts     POST /api/contact -> Resend (the only non-static code)
public/           fonts, og.png, wordmark.svg, favicon.svg, robots.txt
```

Colours, type scale and spacing are defined once in the `@theme` block in
`src/styles/global.css`. Each colour carries its measured contrast ratio in a comment; `--color-border`
is for decorative rules only, `--color-control-border` is the one that meets WCAG 1.4.11 for form
controls.
