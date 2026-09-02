/**
 * The only dynamic route on the site: POST /api/contact, which relays the contact form to Resend.
 *
 * Everything else is a static asset. Assets are matched before this script runs (see the comment
 * in wrangler.jsonc), so the Worker is only invoked for paths that are not files in dist/.
 */

const SITE_ORIGIN = 'https://tandempoint.io';

/** Falls back to the shared Resend sender, which may only deliver to the account's own address. */
const DEFAULT_FROM = 'Tandempoint <onboarding@resend.dev>';
const DEFAULT_TO = 'hello@tandempoint.io';

const MAX_BODY_BYTES = 32_768;
const MAX_NAME = 100;
const MAX_COMPANY = 100;
const MAX_EMAIL = 254;
const MAX_MESSAGE = 5_000;

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Shown for every failure the submitter cannot act on (rate limit, upstream error). Byte-identical
 * to the fallback in the form's client script, so the page reads the same however it fails.
 */
const GENERIC_ERROR =
  'Something went wrong sending that. Email hello@tandempoint.io and we will pick it up there.';

interface Env {
  RESEND_API_KEY?: string;
  CONTACT_FROM?: string;
  CONTACT_TO?: string;
  /** "true" in .dev.vars only: lets the origin check accept http://localhost:… under wrangler dev. */
  ALLOW_LOCAL_ORIGIN?: string;
}

interface ContactPayload {
  name?: unknown;
  company?: unknown;
  email?: unknown;
  message?: unknown;
  website?: unknown;
}

/**
 * Requests per key within the window.
 *
 * This is deliberately weak, and worth being honest about: Workers isolates are ephemeral and
 * there are many of them per Cloudflare location, so a determined sender simply lands on a fresh
 * isolate with an empty Map. It stops a naive resubmit loop from one client and nothing more —
 * the honeypot does the real spam work here.
 *
 * The two upgrades that would actually hold are a Cache API counter (survives isolate churn,
 * still per-location) or a Durable Object (globally consistent, costs a binding). Cloudflare's
 * native `ratelimits` binding is not one of them: its `period` accepts only 10 or 60 seconds, so
 * a ten-minute window cannot be expressed with it.
 */
const hits = new Map<string, number[]>();

const json = (body: unknown, status: number, headers?: HeadersInit): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });

const fail = (error: string, status: number): Response => json({ error }, status);

/**
 * Rejects a request whose Origin is present and wrong, and allows one that carries no origin
 * information at all.
 *
 * Fail-open is the point. Privacy extensions and corporate proxies strip Origin from otherwise
 * ordinary requests, and silently 403ing a real enquiry costs far more than the marginal spam a
 * strict check would catch. Sec-Fetch-Site is the second-best signal (Baseline since March 2023);
 * when neither header survives, the honeypot and the rate limit are still in front of us.
 */
function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin');

  if (origin !== null) {
    if (origin === SITE_ORIGIN) return true;
    if (env.ALLOW_LOCAL_ORIGIN !== 'true') return false;
    return origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
  }

  const site = request.headers.get('Sec-Fetch-Site');
  if (site !== null) return site === 'same-origin';

  return true;
}

function rateLimited(request: Request): boolean {
  // CF-Connecting-IP is absent under `wrangler dev`; the shared "local" key keeps the 429 branch
  // reachable there instead of silently never firing.
  const key = request.headers.get('CF-Connecting-IP') ?? 'local';
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((at) => now - at < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX) {
    hits.set(key, recent);
    return true;
  }

  recent.push(now);
  hits.set(key, recent);
  return false;
}

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Pragmatic rather than RFC-complete: one @, no whitespace, a dot in the domain. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Fields {
  name: string;
  company: string;
  email: string;
  message: string;
}

function validate(payload: ContactPayload): { fields: Fields } | { error: string } {
  const name = asTrimmedString(payload.name);
  const company = asTrimmedString(payload.company);
  const email = asTrimmedString(payload.email);
  const message = asTrimmedString(payload.message);

  if (name.length < 1 || name.length > MAX_NAME) return { error: 'Enter a name.' };
  if (company.length > MAX_COMPANY) return { error: 'That company name is too long.' };
  if (email.length > MAX_EMAIL || !EMAIL.test(email)) return { error: 'Enter a valid email address.' };
  if (message.length < 1 || message.length > MAX_MESSAGE) return { error: 'Enter a message.' };

  return { fields: { name, company, email, message } };
}

async function handleContact(request: Request, env: Env): Promise<Response> {
  if (!originAllowed(request, env)) return fail('Request blocked.', 403);

  // Checked before reading so an oversized body is rejected without buffering it. Content-Length
  // can be absent on a chunked request, hence the second check against the bytes actually read.
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return fail('That message is too large.', 413);

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return fail('That message is too large.', 413);
  }

  if (rateLimited(request)) return fail(GENERIC_ERROR, 429);

  let payload: ContactPayload;
  try {
    payload = JSON.parse(raw) as ContactPayload;
  } catch {
    return fail('Malformed request.', 400);
  }

  // Honeypot: a real browser never fills this in, and a bot that does gets an ordinary success
  // response so it has nothing to tune against.
  if (asTrimmedString(payload.website).length > 0) return json({ ok: true }, 200);

  const result = validate(payload);
  if ('error' in result) return fail(result.error, 400);
  const { name, company, email, message } = result.fields;

  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set; contact form submission dropped');
    return fail(GENERIC_ERROR, 502);
  }

  const subject = company ? `Contact: ${name} — ${company}` : `Contact: ${name}`;
  const text = [
    `Name: ${name}`,
    `Company: ${company || '—'}`,
    `Email: ${email}`,
    '',
    message,
  ].join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.CONTACT_FROM ?? DEFAULT_FROM,
      to: env.CONTACT_TO ?? DEFAULT_TO,
      reply_to: email,
      subject,
      text,
    }),
  });

  if (!response.ok) {
    // Logged for `wrangler tail`, never returned: the body can quote the request and the key must
    // not reach the browser under any failure mode.
    console.error('Resend rejected the send', response.status, await response.text());
    return fail(GENERIC_ERROR, 502);
  }

  return json({ ok: true }, 200);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // Assets are served before this runs, so anything arriving here is genuinely not a file.
    // The site builds no 404.html, so a plain response matches what the asset router used to send.
    if (pathname !== '/api/contact') return new Response('Not found', { status: 404 });

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    }

    return handleContact(request, env);
  },
} satisfies ExportedHandler<Env>;
