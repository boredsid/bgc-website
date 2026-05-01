# BGC Admin Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `admin.boardgamecompany.in` — a Cloudflare Access-gated admin SPA for managing events, games, registrations, and guild memberships, plus a dashboard summary.

**Architecture:** Vite + React 19 + Tailwind 4 + shadcn/ui SPA in `admin/` deployed as a separate Cloudflare Pages project. Existing Cloudflare Worker gains a JWT-verified `/api/admin/*` namespace. Auth is Cloudflare Access (1-month session, 4-email allowlist).

**Tech Stack:** TypeScript, Vite 5, React 19, React Router 7, Tailwind 4, shadcn/ui, vitest, Cloudflare Workers, Cloudflare Pages, Cloudflare Access, Supabase.

**Spec:** `docs/superpowers/specs/2026-05-01-admin-tool-design.md`

---

## Phase 0 — Worker test infrastructure & Access JWT verification

### Task 0.1: Add vitest to the Worker package

**Files:**
- Modify: `worker/package.json`
- Create: `worker/vitest.config.ts`
- Create: `worker/tsconfig.json` (only if it doesn't already cover test files)

- [ ] **Step 1: Add vitest dev dependencies**

```bash
cd worker
npm install --save-dev vitest@^2.1.0 @vitest/coverage-v8@^2.1.0
```

- [ ] **Step 2: Add a test script to `worker/package.json`**

In the `scripts` block, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `worker/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Verify config**

Run: `cd worker && npm test`
Expected: "No test files found" (exit 0 — that's correct, we haven't added tests yet).

- [ ] **Step 5: Commit**

```bash
git add worker/package.json worker/package-lock.json worker/vitest.config.ts
git commit -m "chore(worker): add vitest for unit testing"
```

---

### Task 0.2: Access JWT verifier — write failing tests

**Files:**
- Create: `worker/src/access-auth.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyAccessJwt, type AccessAuthEnv } from './access-auth';

// Helper: build an Env shape for tests
const baseEnv = (): AccessAuthEnv => ({
  CF_ACCESS_TEAM_DOMAIN: 'boardgamecompany.cloudflareaccess.com',
  CF_ACCESS_AUD: 'test-aud-tag',
  ADMIN_EMAILS: 'a@x.com,b@x.com',
  ENVIRONMENT: 'production',
});

// We'll mock fetch to return the Cloudflare JWKS endpoint.
// For tests we use a static JWK pair generated via crypto.subtle.

async function generateTestKey() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  return { keyPair, jwk: { ...jwk, kid: 'test-kid', alg: 'RS256', use: 'sig' } };
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function signJwt(privateKey: CryptoKey, payload: Record<string, unknown>) {
  const header = { alg: 'RS256', typ: 'JWT', kid: 'test-kid' };
  const enc = new TextEncoder();
  const headerB64 = b64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = b64url(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

describe('verifyAccessJwt', () => {
  let keyPair: CryptoKeyPair;
  let jwk: JsonWebKey & { kid: string };

  beforeEach(async () => {
    const k = await generateTestKey();
    keyPair = k.keyPair;
    jwk = k.jwk as JsonWebKey & { kid: string };

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/cdn-cgi/access/certs')) {
        return new Response(JSON.stringify({ keys: [jwk] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));
  });

  it('accepts a valid JWT and returns the email', async () => {
    const token = await signJwt(keyPair.privateKey, {
      iss: 'https://boardgamecompany.cloudflareaccess.com',
      aud: 'test-aud-tag',
      email: 'a@x.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await verifyAccessJwt(token, baseEnv());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.email).toBe('a@x.com');
  });

  it('rejects when audience does not match', async () => {
    const token = await signJwt(keyPair.privateKey, {
      iss: 'https://boardgamecompany.cloudflareaccess.com',
      aud: 'wrong-aud',
      email: 'a@x.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await verifyAccessJwt(token, baseEnv());
    expect(result.ok).toBe(false);
  });

  it('rejects when issuer does not match', async () => {
    const token = await signJwt(keyPair.privateKey, {
      iss: 'https://evil.cloudflareaccess.com',
      aud: 'test-aud-tag',
      email: 'a@x.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await verifyAccessJwt(token, baseEnv());
    expect(result.ok).toBe(false);
  });

  it('rejects when expired', async () => {
    const token = await signJwt(keyPair.privateKey, {
      iss: 'https://boardgamecompany.cloudflareaccess.com',
      aud: 'test-aud-tag',
      email: 'a@x.com',
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const result = await verifyAccessJwt(token, baseEnv());
    expect(result.ok).toBe(false);
  });

  it('rejects when email is not in allowlist', async () => {
    const token = await signJwt(keyPair.privateKey, {
      iss: 'https://boardgamecompany.cloudflareaccess.com',
      aud: 'test-aud-tag',
      email: 'stranger@x.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await verifyAccessJwt(token, baseEnv());
    expect(result.ok).toBe(false);
  });

  it('rejects malformed tokens', async () => {
    const result = await verifyAccessJwt('not-a-jwt', baseEnv());
    expect(result.ok).toBe(false);
  });

  it('rejects empty/missing tokens', async () => {
    const result = await verifyAccessJwt('', baseEnv());
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `cd worker && npm test`
Expected: FAIL — `verifyAccessJwt` not exported / module not found.

---

### Task 0.3: Implement the Access JWT verifier

**Files:**
- Create: `worker/src/access-auth.ts`

- [ ] **Step 1: Implement the verifier**

```ts
export interface AccessAuthEnv {
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  ADMIN_EMAILS: string;
  ENVIRONMENT: string;
}

export type VerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: string };

let cachedKeys: { fetchedAt: number; teamDomain: string; keys: Map<string, CryptoKey> } | null = null;
const KEY_TTL_MS = 60 * 60 * 1000; // 1 hour

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function loadKeys(teamDomain: string): Promise<Map<string, CryptoKey>> {
  if (cachedKeys && cachedKeys.teamDomain === teamDomain && Date.now() - cachedKeys.fetchedAt < KEY_TTL_MS) {
    return cachedKeys.keys;
  }
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch JWKS');
  const data = (await res.json()) as { keys: Array<JsonWebKey & { kid: string }> };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of data.keys) {
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    keys.set(jwk.kid, key);
  }
  cachedKeys = { fetchedAt: Date.now(), teamDomain, keys };
  return keys;
}

export async function verifyAccessJwt(token: string, env: AccessAuthEnv): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: 'missing token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };

  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg: string; kid: string };
  let payload: { iss: string; aud: string | string[]; email: string; exp: number };
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerB64)));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (header.alg !== 'RS256') return { ok: false, reason: 'bad alg' };

  const keys = await loadKeys(env.CF_ACCESS_TEAM_DOMAIN);
  let key = keys.get(header.kid);
  if (!key) {
    cachedKeys = null;
    const refreshed = await loadKeys(env.CF_ACCESS_TEAM_DOMAIN);
    key = refreshed.get(header.kid);
    if (!key) return { ok: false, reason: 'unknown kid' };
  }

  const sigValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!sigValid) return { ok: false, reason: 'bad signature' };

  const expectedIss = `https://${env.CF_ACCESS_TEAM_DOMAIN}`;
  if (payload.iss !== expectedIss) return { ok: false, reason: 'bad iss' };

  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(env.CF_ACCESS_AUD)) return { ok: false, reason: 'bad aud' };

  if (typeof payload.exp !== 'number' || Math.floor(Date.now() / 1000) >= payload.exp) {
    return { ok: false, reason: 'expired' };
  }

  const email = (payload.email || '').toLowerCase();
  const allowed = env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(email)) return { ok: false, reason: 'email not allowed' };

  return { ok: true, email };
}
```

- [ ] **Step 2: Run tests, expect pass**

Run: `cd worker && npm test`
Expected: PASS — 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add worker/src/access-auth.ts worker/src/access-auth.test.ts
git commit -m "feat(worker): add Cloudflare Access JWT verifier"
```

---

### Task 0.4: Wire JWT verification into the Worker router

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `worker/wrangler.toml`

- [ ] **Step 1: Add new vars to `worker/wrangler.toml`**

Append to the `[vars]` block:

```toml
CF_ACCESS_TEAM_DOMAIN = "boardgamecompany.cloudflareaccess.com"
CF_ACCESS_AUD = "REPLACE_WITH_AUD_TAG_FROM_ACCESS_DASHBOARD"
ADMIN_EMAILS = "REPLACE_WITH_COMMA_SEPARATED_EMAILS"
ENVIRONMENT = "production"
```

(These will be filled in for real during Phase 9. Placeholder values let local development run.)

- [ ] **Step 2: Update `Env` interface and add admin gate to `worker/src/index.ts`**

Replace the existing `Env` interface and `fetch` handler. Show the full new file:

```ts
import { handleLookupPhone } from './lookup-phone';
import { handleRegister } from './register';
import { handleEventSpots } from './event-spots';
import { handleGuildPurchase } from './guild-purchase';
import { handleCancelRegistration, handleCancelGuildMembership } from './cancel';
import { verifyAccessJwt } from './access-auth';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  UPI_ID: string;
  APPS_SCRIPT_URL: string;
  APPS_SCRIPT_SECRET: string;
  BGC_SITE_URL: string;
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  ADMIN_EMAILS: string;
  ENVIRONMENT: string;
}

export interface AdminContext {
  email: string;
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cf-Access-Jwt-Assertion',
    'Access-Control-Allow-Credentials': 'true',
  };
}

async function gateAdmin(request: Request, env: Env): Promise<{ ok: true; admin: AdminContext } | { ok: false; response: Response }> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  const result = await verifyAccessJwt(token, env);
  if (!result.ok) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }
  return { ok: true, admin: { email: result.email } };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    try {
      let response: Response;

      if (url.pathname === '/api/lookup-phone' && request.method === 'POST') {
        response = await handleLookupPhone(request, env);
      } else if (url.pathname === '/api/register' && request.method === 'POST') {
        response = await handleRegister(request, env, ctx);
      } else if (url.pathname.startsWith('/api/event-spots/') && request.method === 'GET') {
        const eventId = url.pathname.split('/api/event-spots/')[1];
        response = await handleEventSpots(eventId, env);
      } else if (url.pathname === '/api/guild-purchase' && request.method === 'POST') {
        response = await handleGuildPurchase(request, env, ctx);
      } else if (url.pathname.startsWith('/api/admin/')) {
        // All admin routes are gated.
        const gate = await gateAdmin(request, env);
        if (!gate.ok) {
          response = gate.response;
        } else if (url.pathname === '/api/admin/cancel-registration' && request.method === 'POST') {
          response = await handleCancelRegistration(request, env);
        } else if (url.pathname === '/api/admin/cancel-guild-membership' && request.method === 'POST') {
          response = await handleCancelGuildMembership(request, env);
        } else {
          response = new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
        }
      } else {
        response = new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }

      const newHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(headers)) {
        newHeaders.set(key, value);
      }
      return new Response(response.body, { status: response.status, headers: newHeaders });
    } catch (err) {
      console.error('[worker] error', err);
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }
  },
};
```

- [ ] **Step 3: Verify type-check**

Run: `cd worker && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Verify tests still pass**

Run: `cd worker && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts worker/wrangler.toml
git commit -m "feat(worker): gate /api/admin/* with Access JWT verification

Existing /api/admin/cancel-* endpoints were previously un-authed; they
now require a valid Cloudflare Access JWT (closes existing hole)."
```

---

### Task 0.5: Local dev auth bypass

**Files:**
- Modify: `worker/src/index.ts`

The production Worker requires a valid Access JWT. For local development (Vite at `localhost:5173` calling the Worker at `localhost:8787`), Access isn't in the path — we need a documented bypass that's safe in dev only.

- [ ] **Step 1: Update `gateAdmin` in `worker/src/index.ts`**

Replace the `gateAdmin` function:

```ts
async function gateAdmin(request: Request, env: Env): Promise<{ ok: true; admin: AdminContext } | { ok: false; response: Response }> {
  // Local dev escape hatch: when ENVIRONMENT=development, accept the
  // first email from ADMIN_EMAILS as the acting admin without verifying a JWT.
  // This branch is unreachable in production because wrangler.toml hard-codes
  // ENVIRONMENT="production".
  if (env.ENVIRONMENT === 'development') {
    const fallback = env.ADMIN_EMAILS.split(',')[0]?.trim();
    if (fallback) return { ok: true, admin: { email: fallback } };
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  const result = await verifyAccessJwt(token, env);
  if (!result.ok) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }
  return { ok: true, admin: { email: result.email } };
}
```

- [ ] **Step 2: Document local dev workflow**

Add a `worker/.dev.vars` file (gitignored) for `wrangler dev`:

```
SUPABASE_SERVICE_KEY=<local or staging service key>
ENVIRONMENT=development
ADMIN_EMAILS=you@example.com
CF_ACCESS_TEAM_DOMAIN=unused-in-dev
CF_ACCESS_AUD=unused-in-dev
```

Confirm `worker/.gitignore` ignores `.dev.vars`:

```bash
grep -q "^.dev.vars$" worker/.gitignore || echo ".dev.vars" >> worker/.gitignore
```

- [ ] **Step 3: Verify local round-trip**

Terminal 1: `cd worker && npm run dev`
Terminal 2: `cd admin && VITE_API_BASE=http://localhost:8787 npm run dev`

Open `http://localhost:5173`. Expected: dashboard loads (with whatever events exist in the configured Supabase project) — no 401.

- [ ] **Step 4: Commit**

```bash
git add worker/src/index.ts worker/.gitignore
git commit -m "feat(worker): local dev auth bypass when ENVIRONMENT=development"
```

---

## Phase 1 — Admin frontend scaffolding

### Task 1.1: Create the `admin/` Vite + React + TS project

**Files:**
- Create: `admin/package.json`
- Create: `admin/vite.config.ts`
- Create: `admin/tsconfig.json`
- Create: `admin/tsconfig.node.json`
- Create: `admin/index.html`
- Create: `admin/src/main.tsx`
- Create: `admin/src/App.tsx`
- Create: `admin/.gitignore`

- [ ] **Step 1: Bootstrap Vite project**

```bash
cd /Users/siddhantnarula/Projects/bgc-website
npm create vite@latest admin -- --template react-ts
cd admin
npm install
```

(If `npm create vite` prompts interactively, accept defaults.)

- [ ] **Step 2: Install runtime deps**

```bash
cd admin
npm install react-router-dom@^7 zod@^3
npm install -D vitest@^2 @testing-library/react@^16 @testing-library/jest-dom@^6 jsdom@^25 @types/node
```

- [ ] **Step 3: Replace `admin/vite.config.ts` with this**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

- [ ] **Step 4: Create `admin/src/test-setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Update `admin/tsconfig.json` to add path alias and include vitest globals**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 6: Add scripts to `admin/package.json`**

In `scripts`:

```json
"dev": "vite",
"build": "tsc -b && vite build",
"preview": "vite preview",
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 7: Verify build**

Run: `cd admin && npm run build`
Expected: clean Vite build, output in `admin/dist`.

- [ ] **Step 8: Commit**

```bash
git add admin/ -- ':!admin/node_modules' ':!admin/dist'
git commit -m "chore(admin): scaffold Vite + React + TS app"
```

---

### Task 1.2: Set up Tailwind 4 + shadcn/ui

**Files:**
- Modify: `admin/package.json`
- Create: `admin/src/index.css`
- Modify: `admin/vite.config.ts`
- Create: `admin/components.json`
- Create: `admin/src/lib/utils.ts`

- [ ] **Step 1: Install Tailwind 4 + shadcn deps**

```bash
cd admin
npm install tailwindcss@^4 @tailwindcss/vite@^4
npm install class-variance-authority clsx tailwind-merge lucide-react
npm install @radix-ui/react-slot @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-select @radix-ui/react-checkbox @radix-ui/react-radio-group @radix-ui/react-toast
```

- [ ] **Step 2: Update `admin/vite.config.ts` to add Tailwind plugin**

Replace the `plugins` array:

```ts
import tailwindcss from '@tailwindcss/vite';
// ...
plugins: [react(), tailwindcss()],
```

- [ ] **Step 3: Replace `admin/src/index.css` with Tailwind 4 + shadcn theme**

```css
@import "tailwindcss";

@theme {
  --color-background: hsl(0 0% 100%);
  --color-foreground: hsl(240 10% 3.9%);
  --color-muted: hsl(240 4.8% 95.9%);
  --color-muted-foreground: hsl(240 3.8% 46.1%);
  --color-border: hsl(240 5.9% 90%);
  --color-input: hsl(240 5.9% 90%);
  --color-ring: hsl(240 5.9% 10%);
  --color-primary: hsl(240 5.9% 10%);
  --color-primary-foreground: hsl(0 0% 98%);
  --color-secondary: hsl(240 4.8% 95.9%);
  --color-secondary-foreground: hsl(240 5.9% 10%);
  --color-destructive: hsl(0 84.2% 60.2%);
  --color-destructive-foreground: hsl(0 0% 98%);
  --color-accent: hsl(240 4.8% 95.9%);
  --color-accent-foreground: hsl(240 5.9% 10%);
  --color-popover: hsl(0 0% 100%);
  --color-popover-foreground: hsl(240 10% 3.9%);
  --color-card: hsl(0 0% 100%);
  --color-card-foreground: hsl(240 10% 3.9%);
  --radius: 0.5rem;
}

html, body, #root { height: 100%; }
body { font-family: system-ui, -apple-system, sans-serif; }
```

- [ ] **Step 4: Create `admin/src/lib/utils.ts` (shadcn cn helper)**

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: Create `admin/components.json` for shadcn CLI**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui"
  }
}
```

- [ ] **Step 6: Add base shadcn components**

```bash
cd admin
npx shadcn@latest add button input label dialog drawer sheet dropdown-menu select checkbox switch table textarea toast sonner card
```

Accept any prompts. The CLI writes files to `admin/src/components/ui/`.

- [ ] **Step 7: Verify build still works**

Run: `cd admin && npm run build`
Expected: clean build.

- [ ] **Step 8: Commit**

```bash
git add admin/
git commit -m "chore(admin): set up Tailwind 4 + shadcn/ui"
```

---

### Task 1.3: Routing skeleton, layout shell, sign-out wiring

**Files:**
- Create: `admin/src/App.tsx` (overwrite the bootstrapped one)
- Create: `admin/src/components/Layout.tsx`
- Create: `admin/src/components/Sidebar.tsx`
- Create: `admin/src/components/TopBar.tsx`
- Create: `admin/src/pages/Dashboard.tsx` (placeholder)
- Create: `admin/src/pages/EventsList.tsx` (placeholder)
- Create: `admin/src/pages/GamesList.tsx` (placeholder)
- Create: `admin/src/pages/RegistrationsList.tsx` (placeholder)
- Create: `admin/src/pages/GuildList.tsx` (placeholder)
- Modify: `admin/src/main.tsx`

- [ ] **Step 1: Overwrite `admin/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 2: Create `admin/src/App.tsx`**

```tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import EventsList from './pages/EventsList';
import GamesList from './pages/GamesList';
import RegistrationsList from './pages/RegistrationsList';
import GuildList from './pages/GuildList';
import { Toaster } from '@/components/ui/sonner';

export default function App() {
  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/events" element={<EventsList />} />
          <Route path="/events/new" element={<EventsList />} />
          <Route path="/events/:id" element={<EventsList />} />
          <Route path="/games" element={<GamesList />} />
          <Route path="/games/new" element={<GamesList />} />
          <Route path="/games/:id" element={<GamesList />} />
          <Route path="/registrations" element={<RegistrationsList />} />
          <Route path="/registrations/new" element={<RegistrationsList />} />
          <Route path="/registrations/:id" element={<RegistrationsList />} />
          <Route path="/guild" element={<GuildList />} />
          <Route path="/guild/:id" element={<GuildList />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster />
    </>
  );
}
```

- [ ] **Step 3: Create `admin/src/components/Layout.tsx`**

```tsx
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

export default function Layout() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 overflow-auto bg-muted/30 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `admin/src/components/Sidebar.tsx`**

```tsx
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Calendar, Library, Users, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/events', label: 'Events', icon: Calendar },
  { to: '/games', label: 'Games', icon: Library },
  { to: '/registrations', label: 'Registrations', icon: Users },
  { to: '/guild', label: 'Guild', icon: ShieldCheck },
];

export default function Sidebar() {
  return (
    <aside className="w-56 shrink-0 bg-background border-r flex flex-col">
      <div className="p-4 font-semibold text-lg">BGC Admin</div>
      <nav className="flex-1 p-2 space-y-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 px-3 py-2 rounded-md text-sm',
                isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 5: Create `admin/src/components/TopBar.tsx`**

```tsx
import { useEffect, useState } from 'react';

function readAdminEmailFromCookie(): string | null {
  // Cloudflare Access sets CF_Authorization cookie containing the JWT.
  // We can't read it from JS (HttpOnly), so we hit a meta endpoint that the
  // app sets at build/runtime — for now, fall back to "Signed in".
  const meta = document.querySelector('meta[name="admin-email"]');
  return meta?.getAttribute('content') || null;
}

export default function TopBar() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    setEmail(readAdminEmailFromCookie());
  }, []);

  return (
    <header className="h-14 bg-background border-b flex items-center justify-between px-6">
      <div className="font-medium">Admin</div>
      <div className="flex items-center gap-3 text-sm">
        {email && <span className="text-muted-foreground">{email}</span>}
        <a
          href="/cdn-cgi/access/logout"
          className="text-sm hover:underline"
        >
          Sign out
        </a>
      </div>
    </header>
  );
}
```

(Note: admin email display gets wired properly in Task 8.2 via a `/api/admin/whoami` endpoint. For now it's a placeholder.)

- [ ] **Step 6: Create five placeholder pages**

`admin/src/pages/Dashboard.tsx`:
```tsx
export default function Dashboard() {
  return <div><h1 className="text-2xl font-semibold mb-4">Dashboard</h1></div>;
}
```

`admin/src/pages/EventsList.tsx`:
```tsx
export default function EventsList() {
  return <div><h1 className="text-2xl font-semibold mb-4">Events</h1></div>;
}
```

`admin/src/pages/GamesList.tsx`:
```tsx
export default function GamesList() {
  return <div><h1 className="text-2xl font-semibold mb-4">Games</h1></div>;
}
```

`admin/src/pages/RegistrationsList.tsx`:
```tsx
export default function RegistrationsList() {
  return <div><h1 className="text-2xl font-semibold mb-4">Registrations</h1></div>;
}
```

`admin/src/pages/GuildList.tsx`:
```tsx
export default function GuildList() {
  return <div><h1 className="text-2xl font-semibold mb-4">Guild</h1></div>;
}
```

- [ ] **Step 7: Verify build and dev server**

```bash
cd admin && npm run build
cd admin && npm run dev
```

Open `http://localhost:5173`. Expected: layout shell with sidebar + topbar, navigating between sections highlights the active link.

- [ ] **Step 8: Commit**

```bash
git add admin/
git commit -m "feat(admin): routing skeleton and layout shell"
```

---

### Task 1.4: API client wrapper with error handling

**Files:**
- Create: `admin/src/lib/api.ts`
- Create: `admin/src/lib/api.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAdmin, ApiError } from './api';

describe('fetchAdmin', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns parsed JSON on 2xx', async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, value: 42 }), { status: 200 }),
    );
    const data = await fetchAdmin<{ value: number }>('/api/admin/x');
    expect(data.value).toBe(42);
  });

  it('throws ApiError with server message on 4xx', async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Invalid input' }), { status: 400 }),
    );
    await expect(fetchAdmin('/api/admin/x')).rejects.toMatchObject({
      status: 400,
      message: 'Invalid input',
    });
  });

  it('throws ApiError on 5xx', async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response('boom', { status: 500 }),
    );
    await expect(fetchAdmin('/api/admin/x')).rejects.toMatchObject({ status: 500 });
  });

  it('triggers reload on 401', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload, origin: 'http://localhost' });
    (globalThis.fetch as any).mockResolvedValue(new Response('', { status: 401 }));
    await expect(fetchAdmin('/api/admin/x')).rejects.toBeInstanceOf(ApiError);
    expect(reload).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `cd admin && npm test`
Expected: FAIL — `./api` not found.

- [ ] **Step 3: Create `admin/src/lib/api.ts`**

```ts
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || 'https://bgc-api.boredsid.workers.dev';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

export async function fetchAdmin<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (res.status === 401) {
    location.reload();
    throw new ApiError(401, 'Unauthorized');
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && 'error' in body && typeof (body as Record<string, unknown>).error === 'string'
        ? ((body as Record<string, string>).error)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }

  return body as T;
}

export function showApiError(err: unknown, fallback = 'Something went wrong, try again.') {
  // Plays into the toast system; centralised so callers don't repeat.
  // Imported lazily to avoid circular module issues with components.
  import('sonner').then(({ toast }) => {
    if (err instanceof ApiError) {
      toast.error(err.message);
    } else {
      toast.error(fallback);
    }
  });
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `cd admin && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/api.ts admin/src/lib/api.test.ts
git commit -m "feat(admin): api client wrapper with error handling"
```

---

## Phase 2 — Events CRUD (Worker + Frontend)

### Task 2.1: Worker — admin events list/get/create/update endpoints

**Files:**
- Create: `worker/src/admin/events.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Create `worker/src/admin/events.ts`**

```ts
import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';

export async function handleListEvents(env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('date', { ascending: false });
  if (error) return jsonResponse({ error: 'Failed to load events' }, 500);
  return jsonResponse({ events: data || [] });
}

export async function handleGetEvent(id: string, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to load event' }, 500);
  if (!data) return jsonResponse({ error: 'Event not found' }, 404);
  return jsonResponse({ event: data });
}

const EVENT_FIELDS = [
  'name', 'description', 'date', 'venue_name', 'venue_area',
  'price', 'capacity', 'custom_questions', 'price_includes', 'is_published',
] as const;

type EventField = (typeof EVENT_FIELDS)[number];

function pickEventFields(body: Record<string, unknown>): Partial<Record<EventField, unknown>> {
  const out: Partial<Record<EventField, unknown>> = {};
  for (const f of EVENT_FIELDS) if (f in body) out[f] = body[f];
  return out;
}

function validateEventPayload(payload: Partial<Record<EventField, unknown>>, requireAll: boolean): string | null {
  if (requireAll || 'name' in payload) {
    if (typeof payload.name !== 'string' || payload.name.trim().length === 0) return 'Name is required';
  }
  if (requireAll || 'date' in payload) {
    if (typeof payload.date !== 'string' || isNaN(Date.parse(payload.date as string))) return 'Date is required and must be a valid date';
  }
  if ('price' in payload && (typeof payload.price !== 'number' || payload.price < 0)) return 'Price must be a non-negative number';
  if ('capacity' in payload && (typeof payload.capacity !== 'number' || payload.capacity < 0)) return 'Capacity must be a non-negative number';
  if ('custom_questions' in payload && payload.custom_questions !== null && !Array.isArray(payload.custom_questions)) return 'Custom questions must be a list';
  return null;
}

export async function handleCreateEvent(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickEventFields(body);
  const err = validateEventPayload(payload, true);
  if (err) return jsonResponse({ error: err }, 400);

  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('events')
    .insert(payload)
    .select('*')
    .single();
  if (error || !data) return jsonResponse({ error: 'Failed to create event' }, 500);
  return jsonResponse({ event: data }, 201);
}

export async function handleUpdateEvent(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickEventFields(body);
  if (Object.keys(payload).length === 0) return jsonResponse({ error: 'No fields to update' }, 400);
  const err = validateEventPayload(payload, false);
  if (err) return jsonResponse({ error: err }, 400);

  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('events')
    .update(payload)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to update event' }, 500);
  if (!data) return jsonResponse({ error: 'Event not found' }, 404);
  return jsonResponse({ event: data });
}
```

- [ ] **Step 2: Wire into `worker/src/index.ts`**

Add import at the top:

```ts
import { handleListEvents, handleGetEvent, handleCreateEvent, handleUpdateEvent } from './admin/events';
```

Inside the `if (url.pathname.startsWith('/api/admin/'))` block (after the gate, before the existing cancel routes), add:

```ts
const adminMatch = url.pathname.match(/^\/api\/admin\/events(?:\/([^/]+))?$/);
if (adminMatch) {
  const eventId = adminMatch[1];
  if (!eventId && request.method === 'GET') response = await handleListEvents(env);
  else if (!eventId && request.method === 'POST') response = await handleCreateEvent(request, env);
  else if (eventId && request.method === 'GET') response = await handleGetEvent(eventId, env);
  else if (eventId && request.method === 'PATCH') response = await handleUpdateEvent(eventId, request, env);
  else response = new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}
```

Refactor the chain so this and the existing cancel branches are an `else if` chain — when none match, return 404.

- [ ] **Step 3: Type-check**

Run: `cd worker && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add worker/src/admin/events.ts worker/src/index.ts
git commit -m "feat(worker): admin events CRUD endpoints"
```

---

### Task 2.2: Frontend — events list page and types

**Files:**
- Modify: `admin/src/lib/types.ts` (create if missing)
- Modify: `admin/src/pages/EventsList.tsx`
- Create: `admin/src/components/DataTable.tsx`

- [ ] **Step 1: Create `admin/src/lib/types.ts`**

```ts
export interface CustomQuestionOption {
  value: string;
  capacity?: number;
}

export interface CustomQuestion {
  id: string;
  label: string;
  type: 'select' | 'radio' | 'text' | 'checkbox';
  required: boolean;
  options?: CustomQuestionOption[];
}

export interface Event {
  id: string;
  name: string;
  description: string | null;
  date: string;
  venue_name: string | null;
  venue_area: string | null;
  price: number;
  capacity: number;
  custom_questions: CustomQuestion[] | null;
  price_includes: string | null;
  is_published: boolean;
  created_at: string;
}

export interface Game {
  id: string;
  title: string;
  player_count: string | null;
  max_players: number | null;
  avg_rating: number | null;
  weight: number | null;
  complexity: string | null;
  play_time: string | null;
  max_play_time: number | null;
  length: string | null;
  owned_by: string | null;
  currently_with: string | null;
}

export interface Registration {
  id: string;
  event_id: string;
  user_id: string | null;
  name: string;
  phone: string;
  email: string | null;
  seats: number;
  total_amount: number;
  discount_applied: string | null;
  custom_answers: Record<string, string | boolean> | null;
  payment_status: 'pending' | 'confirmed' | 'cancelled';
  plus_ones_consumed: number;
  source: string | null;
  created_at: string;
}

export interface GuildMember {
  id: string;
  user_id: string;
  tier: 'initiate' | 'adventurer' | 'guildmaster';
  amount: number;
  status: 'pending' | 'paid' | 'cancelled';
  starts_at: string;
  expires_at: string;
  plus_ones_used: number;
  source: string | null;
  // Joined from users:
  user_name: string | null;
  user_phone: string;
  user_email: string | null;
}

export interface User {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  first_registered_at: string;
  last_registered_at: string;
  source: string | null;
}
```

- [ ] **Step 2: Create `admin/src/components/DataTable.tsx`**

```tsx
import { ReactNode } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}

export default function DataTable<T>({ rows, columns, rowKey, onRowClick, emptyMessage }: Props<T>) {
  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground p-4">{emptyMessage || 'Nothing to show.'}</div>;
  }
  return (
    <div className="rounded-md border bg-background overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => <TableHead key={c.key} className={c.className}>{c.header}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'cursor-pointer hover:bg-muted/50' : undefined}
            >
              {columns.map((c) => <TableCell key={c.key} className={c.className}>{c.render(row)}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 3: Replace `admin/src/pages/EventsList.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import DataTable, { Column } from '@/components/DataTable';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { Event } from '@/lib/types';

export default function EventsList() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAdmin<{ events: Event[] }>('/api/admin/events')
      .then((r) => setEvents(r.events))
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, []);

  const columns: Column<Event>[] = [
    { key: 'name', header: 'Name', render: (e) => e.name },
    { key: 'date', header: 'Date', render: (e) => new Date(e.date).toLocaleString() },
    { key: 'venue', header: 'Venue', render: (e) => e.venue_name || '—' },
    { key: 'capacity', header: 'Capacity', render: (e) => e.capacity },
    { key: 'published', header: 'Status', render: (e) => (e.is_published ? 'Published' : 'Draft') },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Events</h1>
        <Button asChild>
          <Link to="/events/new">New event</Link>
        </Button>
      </div>
      {loading ? <p>Loading…</p> : (
        <DataTable
          rows={events}
          columns={columns}
          rowKey={(e) => e.id}
          onRowClick={(e) => navigate(`/events/${e.id}`)}
          emptyMessage="No events yet."
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `cd admin && npm run build`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/types.ts admin/src/components/DataTable.tsx admin/src/pages/EventsList.tsx
git commit -m "feat(admin): events list page"
```

---

### Task 2.3: CustomQuestionsEditor component (TDD)

**Files:**
- Create: `admin/src/components/CustomQuestionsEditor.tsx`
- Create: `admin/src/components/CustomQuestionsEditor.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CustomQuestionsEditor from './CustomQuestionsEditor';
import type { CustomQuestion } from '@/lib/types';

describe('CustomQuestionsEditor', () => {
  it('renders existing questions', () => {
    const value: CustomQuestion[] = [
      { id: 'pizza', label: 'Pizza?', type: 'checkbox', required: false },
    ];
    render(<CustomQuestionsEditor value={value} onChange={() => {}} />);
    expect(screen.getByDisplayValue('Pizza?')).toBeInTheDocument();
  });

  it('adds a question with auto-generated id', () => {
    const calls: CustomQuestion[][] = [];
    render(<CustomQuestionsEditor value={[]} onChange={(v) => calls.push(v)} />);
    fireEvent.click(screen.getByRole('button', { name: /add question/i }));
    expect(calls.length).toBe(1);
    expect(calls[0].length).toBe(1);
    expect(calls[0][0].id).toMatch(/^question-/);
    expect(calls[0][0].type).toBe('text');
  });

  it('preserves id when label is renamed', () => {
    const initial: CustomQuestion[] = [
      { id: 'pizza', label: 'Pizza?', type: 'checkbox', required: false },
    ];
    let last: CustomQuestion[] = initial;
    const { rerender } = render(<CustomQuestionsEditor value={initial} onChange={(v) => { last = v; }} />);
    fireEvent.change(screen.getByDisplayValue('Pizza?'), { target: { value: 'Pizza preference?' } });
    rerender(<CustomQuestionsEditor value={last} onChange={(v) => { last = v; }} />);
    expect(last[0].id).toBe('pizza');
    expect(last[0].label).toBe('Pizza preference?');
  });

  it('shows option editor for select type', () => {
    const value: CustomQuestion[] = [
      { id: 'meal', label: 'Meal', type: 'select', required: false, options: [{ value: 'Veg' }] },
    ];
    render(<CustomQuestionsEditor value={value} onChange={() => {}} />);
    expect(screen.getByDisplayValue('Veg')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `cd admin && npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `CustomQuestionsEditor.tsx`**

```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Trash2, Plus } from 'lucide-react';
import type { CustomQuestion, CustomQuestionOption } from '@/lib/types';

const TYPE_LABELS: Record<CustomQuestion['type'], string> = {
  text: 'Short text',
  checkbox: 'Yes/no',
  select: 'Pick one (dropdown)',
  radio: 'Pick one (radio)',
};

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'question';
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

interface Props {
  value: CustomQuestion[];
  onChange: (next: CustomQuestion[]) => void;
  hasRegistrations?: boolean;
}

export default function CustomQuestionsEditor({ value, onChange, hasRegistrations }: Props) {
  function update(idx: number, patch: Partial<CustomQuestion>) {
    const next = value.map((q, i) => (i === idx ? { ...q, ...patch } : q));
    onChange(next);
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function addQuestion() {
    const taken = new Set(value.map((q) => q.id));
    const id = uniqueId(`question-${value.length + 1}`, taken);
    onChange([...value, { id, label: '', type: 'text', required: false }]);
  }

  return (
    <div className="space-y-3">
      {hasRegistrations && value.length > 0 && (
        <div className="text-xs rounded-md bg-amber-50 text-amber-900 p-2">
          This event already has registrations. Renaming options can break stored answers — change with care.
        </div>
      )}
      {value.map((q, idx) => (
        <div key={idx} className="rounded-md border p-3 space-y-2 bg-muted/20">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-xs">Question</Label>
              <Input value={q.label} onChange={(e) => update(idx, { label: e.target.value })} placeholder="What do you want to ask?" />
            </div>
            <div className="w-44">
              <Label className="text-xs">Answer type</Label>
              <Select value={q.type} onValueChange={(t) => {
                const next: Partial<CustomQuestion> = { type: t as CustomQuestion['type'] };
                if ((t === 'select' || t === 'radio') && !q.options) next.options = [];
                if (t !== 'select' && t !== 'radio') next.options = undefined;
                update(idx, next);
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['text','checkbox','select','radio'] as const).map((t) => (
                    <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pb-2">
              <Switch checked={q.required} onCheckedChange={(c) => update(idx, { required: c })} />
              <Label className="text-xs">Required</Label>
            </div>
            <Button variant="ghost" size="icon" onClick={() => remove(idx)} aria-label="Remove question">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {(q.type === 'select' || q.type === 'radio') && (
            <OptionsEditor
              options={q.options || []}
              onChange={(opts) => update(idx, { options: opts })}
            />
          )}
        </div>
      ))}
      <Button variant="outline" onClick={addQuestion}>
        <Plus className="h-4 w-4 mr-1" /> Add question
      </Button>
    </div>
  );
}

function OptionsEditor({ options, onChange }: { options: CustomQuestionOption[]; onChange: (next: CustomQuestionOption[]) => void }) {
  function update(idx: number, patch: Partial<CustomQuestionOption>) {
    onChange(options.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }
  function remove(idx: number) {
    onChange(options.filter((_, i) => i !== idx));
  }
  return (
    <div className="pl-2 space-y-2">
      <Label className="text-xs">Options</Label>
      {options.map((o, idx) => (
        <div key={idx} className="flex gap-2">
          <Input value={o.value} placeholder="Option label" onChange={(e) => update(idx, { value: e.target.value })} />
          <Input
            type="number"
            placeholder="Capacity (optional)"
            className="w-40"
            value={o.capacity ?? ''}
            onChange={(e) => update(idx, { capacity: e.target.value ? Number(e.target.value) : undefined })}
          />
          <Button variant="ghost" size="icon" onClick={() => remove(idx)} aria-label="Remove option">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...options, { value: '' }])}>
        <Plus className="h-4 w-4 mr-1" /> Add option
      </Button>
    </div>
  );
}

// Note: id preservation on label rename is implicit because we only mutate
// the label field via update(); the id field is never touched here. That
// satisfies the test "preserves id when label is renamed".
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd admin && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/CustomQuestionsEditor.tsx admin/src/components/CustomQuestionsEditor.test.tsx
git commit -m "feat(admin): custom questions editor"
```

---

### Task 2.4: EventDrawer (create + edit)

**Files:**
- Create: `admin/src/pages/EventDrawer.tsx`
- Modify: `admin/src/App.tsx`
- Modify: `admin/src/pages/EventsList.tsx`

- [ ] **Step 1: Create `admin/src/pages/EventDrawer.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import CustomQuestionsEditor from '@/components/CustomQuestionsEditor';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { Event, CustomQuestion } from '@/lib/types';

interface Props { mode: 'create' | 'edit' }

const empty: Partial<Event> = {
  name: '', description: '', date: '', venue_name: '', venue_area: '',
  price: 0, capacity: 0, custom_questions: [], price_includes: '', is_published: false,
};

export default function EventDrawer({ mode }: Props) {
  const navigate = useNavigate();
  const { id } = useParams();
  const [form, setForm] = useState<Partial<Event>>(empty);
  const [initial, setInitial] = useState<Partial<Event>>(empty);
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode !== 'edit' || !id) return;
    fetchAdmin<{ event: Event }>(`/api/admin/events/${id}`)
      .then((r) => {
        setForm(r.event);
        setInitial(r.event);
      })
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, [mode, id]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

  function close() {
    if (dirty && !confirm('Discard changes?')) return;
    navigate('/events');
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        ...form,
        date: form.date ? new Date(form.date).toISOString() : '',
        custom_questions: form.custom_questions || [],
      };
      if (mode === 'create') {
        await fetchAdmin('/api/admin/events', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Event created');
      } else {
        await fetchAdmin(`/api/admin/events/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        toast.success('Event updated');
      }
      navigate('/events');
    } catch (err) {
      showApiError(err);
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof Event>(key: K, value: Event[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{mode === 'create' ? 'New event' : 'Edit event'}</SheetTitle>
        </SheetHeader>
        {loading ? <p className="p-4">Loading…</p> : (
          <div className="space-y-4 p-4">
            <div>
              <Label>Name</Label>
              <Input value={form.name || ''} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description || ''} onChange={(e) => set('description', e.target.value)} rows={4} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date & time</Label>
                <Input
                  type="datetime-local"
                  value={form.date ? toLocalInput(form.date) : ''}
                  onChange={(e) => set('date', new Date(e.target.value).toISOString())}
                />
              </div>
              <div>
                <Label>Capacity</Label>
                <Input type="number" value={form.capacity ?? 0} onChange={(e) => set('capacity', Number(e.target.value))} />
              </div>
              <div>
                <Label>Venue name</Label>
                <Input value={form.venue_name || ''} onChange={(e) => set('venue_name', e.target.value)} />
              </div>
              <div>
                <Label>Venue area</Label>
                <Input value={form.venue_area || ''} onChange={(e) => set('venue_area', e.target.value)} />
              </div>
              <div>
                <Label>Price (₹)</Label>
                <Input type="number" value={form.price ?? 0} onChange={(e) => set('price', Number(e.target.value))} />
              </div>
              <div>
                <Label>Price includes</Label>
                <Input value={form.price_includes || ''} onChange={(e) => set('price_includes', e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={!!form.is_published} onCheckedChange={(c) => set('is_published', c)} />
              <Label>Published</Label>
            </div>
            <div>
              <Label className="block mb-2">Custom questions</Label>
              <CustomQuestionsEditor
                value={form.custom_questions || []}
                onChange={(qs: CustomQuestion[]) => set('custom_questions', qs)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

(`Sheet` was added to the shadcn install in Task 1.2. If missing, run `npx shadcn@latest add sheet` from `admin/`.)

- [ ] **Step 2: Update `admin/src/App.tsx` to render the drawer alongside the list**

Replace the events routes:

```tsx
import EventDrawer from './pages/EventDrawer';
// ...
<Route path="/events" element={<EventsList />} />
<Route path="/events/new" element={<><EventsList /><EventDrawer mode="create" /></>} />
<Route path="/events/:id" element={<><EventsList /><EventDrawer mode="edit" /></>} />
```

- [ ] **Step 3: Verify build and click-through**

Run: `cd admin && npm run build && npm run dev`
Open `http://localhost:5173/events`. Click "New event" → drawer opens. Click a row → drawer opens with values. Confirm dirty-state cancel asks before discarding.

(The list is empty in dev because the local Worker isn't seeded — covered by Phase 9 dev-auth setup.)

- [ ] **Step 4: Commit**

```bash
git add admin/src/pages/EventDrawer.tsx admin/src/App.tsx
git commit -m "feat(admin): event create/edit drawer"
```

---

## Phase 3 — Games CRUD

### Task 3.1: Worker — admin games endpoints

**Files:**
- Create: `worker/src/admin/games.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Create `worker/src/admin/games.ts`**

```ts
import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';

const GAME_FIELDS = [
  'title', 'player_count', 'max_players', 'avg_rating', 'weight',
  'complexity', 'play_time', 'max_play_time', 'length', 'owned_by', 'currently_with',
] as const;

type GameField = (typeof GAME_FIELDS)[number];

function pickGameFields(body: Record<string, unknown>): Partial<Record<GameField, unknown>> {
  const out: Partial<Record<GameField, unknown>> = {};
  for (const f of GAME_FIELDS) if (f in body) out[f] = body[f];
  return out;
}

function validateGamePayload(p: Partial<Record<GameField, unknown>>, requireAll: boolean): string | null {
  if (requireAll || 'title' in p) {
    if (typeof p.title !== 'string' || p.title.trim().length === 0) return 'Title is required';
  }
  if ('max_players' in p && p.max_players !== null && (typeof p.max_players !== 'number' || p.max_players < 0)) return 'Max players must be a non-negative number';
  if ('avg_rating' in p && p.avg_rating !== null && typeof p.avg_rating !== 'number') return 'Average rating must be a number';
  if ('weight' in p && p.weight !== null && typeof p.weight !== 'number') return 'Weight must be a number';
  if ('max_play_time' in p && p.max_play_time !== null && (typeof p.max_play_time !== 'number' || p.max_play_time < 0)) return 'Max play time must be a non-negative number';
  return null;
}

export async function handleListGames(env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('games').select('*').order('title', { ascending: true });
  if (error) return jsonResponse({ error: 'Failed to load games' }, 500);
  return jsonResponse({ games: data || [] });
}

export async function handleGetGame(id: string, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('games').select('*').eq('id', id).maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to load game' }, 500);
  if (!data) return jsonResponse({ error: 'Game not found' }, 404);
  return jsonResponse({ game: data });
}

export async function handleCreateGame(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickGameFields(body);
  const err = validateGamePayload(payload, true);
  if (err) return jsonResponse({ error: err }, 400);
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('games').insert(payload).select('*').single();
  if (error || !data) return jsonResponse({ error: 'Failed to create game' }, 500);
  return jsonResponse({ game: data }, 201);
}

export async function handleUpdateGame(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickGameFields(body);
  if (Object.keys(payload).length === 0) return jsonResponse({ error: 'No fields to update' }, 400);
  const err = validateGamePayload(payload, false);
  if (err) return jsonResponse({ error: err }, 400);
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('games').update(payload).eq('id', id).select('*').maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to update game' }, 500);
  if (!data) return jsonResponse({ error: 'Game not found' }, 404);
  return jsonResponse({ game: data });
}
```

- [ ] **Step 2: Wire into `worker/src/index.ts`**

Add import:

```ts
import { handleListGames, handleGetGame, handleCreateGame, handleUpdateGame } from './admin/games';
```

Inside the admin gate block, add another match:

```ts
const gamesMatch = url.pathname.match(/^\/api\/admin\/games(?:\/([^/]+))?$/);
if (!response && gamesMatch) {
  const gameId = gamesMatch[1];
  if (!gameId && request.method === 'GET') response = await handleListGames(env);
  else if (!gameId && request.method === 'POST') response = await handleCreateGame(request, env);
  else if (gameId && request.method === 'GET') response = await handleGetGame(gameId, env);
  else if (gameId && request.method === 'PATCH') response = await handleUpdateGame(gameId, request, env);
  else response = new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}
```

(Refactor: change the admin block to use successive `if (!response && ...)` checks rather than chained `else if`. Initialise `let response: Response | null = null;` inside the block, then at the end if `response === null` set it to the 404.)

- [ ] **Step 3: Type-check, commit**

```bash
cd worker && npx tsc --noEmit
git add worker/src/admin/games.ts worker/src/index.ts
git commit -m "feat(worker): admin games CRUD endpoints"
```

---

### Task 3.2: Frontend — games list and drawer

**Files:**
- Modify: `admin/src/pages/GamesList.tsx`
- Create: `admin/src/pages/GameDrawer.tsx`
- Modify: `admin/src/App.tsx`

- [ ] **Step 1: Replace `admin/src/pages/GamesList.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import DataTable, { Column } from '@/components/DataTable';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { Game } from '@/lib/types';

export default function GamesList() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [withFilter, setWithFilter] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchAdmin<{ games: Game[] }>('/api/admin/games')
      .then((r) => setGames(r.games))
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const s = search.toLowerCase().trim();
    const w = withFilter.toLowerCase().trim();
    return games.filter((g) =>
      (!s || g.title.toLowerCase().includes(s)) &&
      (!w || (g.currently_with || '').toLowerCase().includes(w)),
    );
  }, [games, search, withFilter]);

  const columns: Column<Game>[] = [
    { key: 'title', header: 'Title', render: (g) => g.title },
    { key: 'players', header: 'Players', render: (g) => g.player_count || '—' },
    { key: 'complexity', header: 'Complexity', render: (g) => g.complexity || '—' },
    { key: 'owned_by', header: 'Owned by', render: (g) => g.owned_by || '—' },
    { key: 'currently_with', header: 'Currently with', render: (g) => g.currently_with || '—' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Games</h1>
        <Button asChild><Link to="/games/new">Add game</Link></Button>
      </div>
      <div className="flex gap-2 mb-3">
        <Input placeholder="Search title…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Input placeholder="Filter by who has it…" value={withFilter} onChange={(e) => setWithFilter(e.target.value)} className="max-w-xs" />
      </div>
      {loading ? <p>Loading…</p> : (
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(g) => g.id}
          onRowClick={(g) => navigate(`/games/${g.id}`)}
          emptyMessage="No games match."
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `admin/src/pages/GameDrawer.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { Game } from '@/lib/types';

interface Props { mode: 'create' | 'edit' }

const empty: Partial<Game> = {
  title: '', player_count: '', max_players: null, avg_rating: null, weight: null,
  complexity: '', play_time: '', max_play_time: null, length: '',
  owned_by: '', currently_with: '',
};

const FIELDS: Array<{ key: keyof Game; label: string; type?: string }> = [
  { key: 'title', label: 'Title' },
  { key: 'player_count', label: 'Player count (display)' },
  { key: 'max_players', label: 'Max players', type: 'number' },
  { key: 'avg_rating', label: 'Avg rating', type: 'number' },
  { key: 'weight', label: 'Weight', type: 'number' },
  { key: 'complexity', label: 'Complexity' },
  { key: 'play_time', label: 'Play time (display)' },
  { key: 'max_play_time', label: 'Max play time (min)', type: 'number' },
  { key: 'length', label: 'Length' },
  { key: 'owned_by', label: 'Owned by' },
  { key: 'currently_with', label: 'Currently with' },
];

export default function GameDrawer({ mode }: Props) {
  const navigate = useNavigate();
  const { id } = useParams();
  const [form, setForm] = useState<Partial<Game>>(empty);
  const [initial, setInitial] = useState<Partial<Game>>(empty);
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode !== 'edit' || !id) return;
    fetchAdmin<{ game: Game }>(`/api/admin/games/${id}`)
      .then((r) => { setForm(r.game); setInitial(r.game); })
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, [mode, id]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

  function close() {
    if (dirty && !confirm('Discard changes?')) return;
    navigate('/games');
  }

  async function save() {
    setSaving(true);
    try {
      if (mode === 'create') {
        await fetchAdmin('/api/admin/games', { method: 'POST', body: JSON.stringify(form) });
        toast.success('Game added');
      } else {
        await fetchAdmin(`/api/admin/games/${id}`, { method: 'PATCH', body: JSON.stringify(form) });
        toast.success('Game updated');
      }
      navigate('/games');
    } catch (err) {
      showApiError(err);
    } finally {
      setSaving(false);
    }
  }

  function set(key: keyof Game, value: string) {
    setForm((f) => ({ ...f, [key]: value === '' ? null : (FIELDS.find(x => x.key === key)?.type === 'number' ? Number(value) : value) }));
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{mode === 'create' ? 'Add game' : 'Edit game'}</SheetTitle>
        </SheetHeader>
        {loading ? <p className="p-4">Loading…</p> : (
          <div className="grid grid-cols-2 gap-3 p-4">
            {FIELDS.map((f) => (
              <div key={f.key as string}>
                <Label>{f.label}</Label>
                <Input
                  type={f.type || 'text'}
                  value={(form[f.key] as string | number | null) ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </div>
            ))}
            <div className="col-span-2 flex justify-end gap-2 pt-4 border-t">
              <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 3: Update `admin/src/App.tsx`**

```tsx
import GameDrawer from './pages/GameDrawer';
// ...
<Route path="/games" element={<GamesList />} />
<Route path="/games/new" element={<><GamesList /><GameDrawer mode="create" /></>} />
<Route path="/games/:id" element={<><GamesList /><GameDrawer mode="edit" /></>} />
```

- [ ] **Step 4: Verify build**

Run: `cd admin && npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add admin/src/pages/GamesList.tsx admin/src/pages/GameDrawer.tsx admin/src/App.tsx
git commit -m "feat(admin): games list and drawer"
```

---

## Phase 4 — Registrations CRUD + manual registration

### Task 4.1: Worker — registrations list/get/patch endpoints

**Files:**
- Create: `worker/src/admin/registrations.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Create `worker/src/admin/registrations.ts`**

```ts
import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';

const REG_FIELDS = [
  'event_id', 'name', 'phone', 'email', 'seats', 'total_amount',
  'discount_applied', 'custom_answers', 'payment_status', 'plus_ones_consumed', 'source',
] as const;

type RegField = (typeof REG_FIELDS)[number];

function pickRegFields(body: Record<string, unknown>): Partial<Record<RegField, unknown>> {
  const out: Partial<Record<RegField, unknown>> = {};
  for (const f of REG_FIELDS) if (f in body) out[f] = body[f];
  return out;
}

function validateRegPayload(p: Partial<Record<RegField, unknown>>): string | null {
  if ('payment_status' in p && !['pending', 'confirmed', 'cancelled'].includes(p.payment_status as string)) {
    return 'Payment status must be pending, confirmed, or cancelled';
  }
  if ('seats' in p && (typeof p.seats !== 'number' || p.seats < 1)) return 'Seats must be at least 1';
  if ('total_amount' in p && (typeof p.total_amount !== 'number' || p.total_amount < 0)) return 'Total amount must be non-negative';
  return null;
}

export async function handleListRegistrations(url: URL, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const eventId = url.searchParams.get('event_id');
  const status = url.searchParams.get('status');

  let q = supabase.from('registrations').select('*').order('created_at', { ascending: false });
  if (eventId) q = q.eq('event_id', eventId);
  if (status) q = q.eq('payment_status', status);

  const { data, error } = await q;
  if (error) return jsonResponse({ error: 'Failed to load registrations' }, 500);
  return jsonResponse({ registrations: data || [] });
}

export async function handleGetRegistration(id: string, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('registrations').select('*').eq('id', id).maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to load registration' }, 500);
  if (!data) return jsonResponse({ error: 'Registration not found' }, 404);
  return jsonResponse({ registration: data });
}

export async function handleUpdateRegistration(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickRegFields(body);
  if (Object.keys(payload).length === 0) return jsonResponse({ error: 'No fields to update' }, 400);
  const err = validateRegPayload(payload);
  if (err) return jsonResponse({ error: err }, 400);
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('registrations').update(payload).eq('id', id).select('*').maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to update registration' }, 500);
  if (!data) return jsonResponse({ error: 'Registration not found' }, 404);
  return jsonResponse({ registration: data });
}
```

- [ ] **Step 2: Wire into `worker/src/index.ts`**

```ts
import { handleListRegistrations, handleGetRegistration, handleUpdateRegistration } from './admin/registrations';
```

Add admin block branch:

```ts
const regsMatch = url.pathname.match(/^\/api\/admin\/registrations(?:\/([^/]+))?$/);
if (!response && regsMatch) {
  const regId = regsMatch[1];
  if (!regId && request.method === 'GET') response = await handleListRegistrations(url, env);
  else if (regId && regId !== 'manual' && request.method === 'GET') response = await handleGetRegistration(regId, env);
  else if (regId && regId !== 'manual' && request.method === 'PATCH') response = await handleUpdateRegistration(regId, request, env);
  else if (regId !== 'manual') response = new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}
```

- [ ] **Step 3: Type-check, commit**

```bash
cd worker && npx tsc --noEmit
git add worker/src/admin/registrations.ts worker/src/index.ts
git commit -m "feat(worker): admin registrations list/get/patch"
```

---

### Task 4.2: Worker — admin lookup-phone endpoint

**Files:**
- Create: `worker/src/admin/lookup-phone.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Create `worker/src/admin/lookup-phone.ts`**

The admin lookup is identical in shape to the public one but doesn't require a strict event_id. We re-export the existing handler.

```ts
import { handleLookupPhone } from '../lookup-phone';
export { handleLookupPhone as handleAdminLookupPhone };
```

- [ ] **Step 2: Wire into `worker/src/index.ts`**

```ts
import { handleAdminLookupPhone } from './admin/lookup-phone';
// inside admin block:
if (!response && url.pathname === '/api/admin/lookup-phone' && request.method === 'POST') {
  response = await handleAdminLookupPhone(request, env);
}
```

- [ ] **Step 3: Commit**

```bash
git add worker/src/admin/lookup-phone.ts worker/src/index.ts
git commit -m "feat(worker): expose lookup-phone under /api/admin"
```

---

### Task 4.3: Worker — manual registration endpoint (TDD on capacity logic)

**Files:**
- Create: `worker/src/admin/register-manual.ts`
- Create: `worker/src/admin/register-manual.test.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Write failing test for capacity check**

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleManualRegister } from './register-manual';

function mockEnv() {
  return {
    SUPABASE_URL: 'x', SUPABASE_SERVICE_KEY: 'x',
    UPI_ID: 'x', APPS_SCRIPT_URL: '', APPS_SCRIPT_SECRET: '', BGC_SITE_URL: '',
    CF_ACCESS_TEAM_DOMAIN: 'x', CF_ACCESS_AUD: 'x', ADMIN_EMAILS: '', ENVIRONMENT: 'production',
  } as any;
}

// We mock getSupabase via module mocking. Each test sets the chain it expects.
vi.mock('../supabase', () => ({
  getSupabase: vi.fn(),
}));

import { getSupabase } from '../supabase';

function buildSupabaseMock(eventRow: any, regs: any[]) {
  return {
    from: (table: string) => {
      if (table === 'events') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: eventRow, error: null }) }) }),
        };
      }
      if (table === 'registrations') {
        return {
          select: () => ({ eq: () => ({ neq: async () => ({ data: regs, error: null }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'new-reg' }, error: null }) }) }),
        };
      }
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'user-1' }, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === 'guild_path_members') {
        return { select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }) };
      }
      return null;
    },
  };
}

describe('handleManualRegister', () => {
  it('rejects when seats exceed remaining capacity', async () => {
    (getSupabase as any).mockReturnValue(buildSupabaseMock(
      { id: 'e1', name: 'Test', date: '2026-06-01T00:00:00Z', price: 500, capacity: 10, custom_questions: null, is_published: true, venue_name: 'X', venue_area: null, price_includes: null },
      [{ seats: 9, payment_status: 'confirmed' }],
    ));
    const req = new Request('http://localhost/api/admin/registrations/manual', {
      method: 'POST',
      body: JSON.stringify({ event_id: 'e1', name: 'A', phone: '9999999999', email: 'a@x.com', seats: 5, payment_status: 'confirmed', custom_answers: {} }),
    });
    const ctx = { waitUntil: () => {} } as any;
    const res = await handleManualRegister(req, mockEnv(), ctx);
    expect(res.status).toBe(400);
  });

  it('sets source to "admin" on success', async () => {
    let inserted: any = null;
    (getSupabase as any).mockReturnValue({
      from: (table: string) => {
        if (table === 'events') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'e1', name: 'T', date: '2026-06-01T00:00:00Z', price: 0, capacity: 10, custom_questions: null, is_published: true, venue_name: 'X', venue_area: null, price_includes: null }, error: null }) }) }) };
        if (table === 'registrations') return {
          select: () => ({ eq: () => ({ neq: async () => ({ data: [], error: null }) }) }),
          insert: (row: any) => { inserted = row; return { select: () => ({ single: async () => ({ data: { id: 'r1' }, error: null }) }) }; },
        };
        if (table === 'users') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u1' }, error: null }) }) }), update: () => ({ eq: async () => ({ error: null }) }) };
        if (table === 'guild_path_members') return { select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }) };
        return null;
      },
    });
    const req = new Request('http://localhost/api/admin/registrations/manual', {
      method: 'POST',
      body: JSON.stringify({ event_id: 'e1', name: 'A', phone: '9999999999', email: 'a@x.com', seats: 1, payment_status: 'confirmed', custom_answers: {} }),
    });
    const ctx = { waitUntil: () => {} } as any;
    const res = await handleManualRegister(req, mockEnv(), ctx);
    expect(res.status).toBe(200);
    expect(inserted.source).toBe('admin');
    expect(inserted.payment_status).toBe('confirmed');
  });
});
```

- [ ] **Step 2: Implement `worker/src/admin/register-manual.ts`**

```ts
import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { sanitizePhone, sanitizeEmail, sanitizeName, jsonResponse } from '../validation';
import { sendEventRegistrationEmail } from '../email';

export async function handleManualRegister(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await request.json<{
    event_id: string;
    name: string;
    phone: string;
    email?: string;
    seats: number;
    custom_answers?: Record<string, string | boolean>;
    payment_status: 'pending' | 'confirmed';
  }>().catch(() => null);

  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);

  const phone = sanitizePhone(body.phone || '');
  if (!phone) return jsonResponse({ error: 'Invalid phone number' }, 400);
  const name = sanitizeName(body.name || '');
  if (!name) return jsonResponse({ error: 'Invalid name' }, 400);
  const email = body.email ? sanitizeEmail(body.email) : null;
  if (body.email && !email) return jsonResponse({ error: 'Invalid email' }, 400);
  const seats = Math.floor(body.seats);
  if (seats < 1 || seats > 20) return jsonResponse({ error: 'Invalid seat count' }, 400);
  if (!body.event_id) return jsonResponse({ error: 'Missing event ID' }, 400);
  if (!['pending', 'confirmed'].includes(body.payment_status)) {
    return jsonResponse({ error: 'Invalid payment status' }, 400);
  }

  const supabase = getSupabase(env);

  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('id', body.event_id)
    .maybeSingle();
  if (!event) return jsonResponse({ error: 'Event not found' }, 404);

  // Capacity check (excludes cancelled).
  const { data: regs } = await supabase
    .from('registrations')
    .select('seats')
    .eq('event_id', body.event_id)
    .neq('payment_status', 'cancelled');
  const taken = (regs || []).reduce((sum: number, r: any) => sum + r.seats, 0);
  if (taken + seats > event.capacity) {
    return jsonResponse({ error: `Only ${event.capacity - taken} spots remaining` }, 400);
  }

  // Upsert user
  const { data: existingUser } = await supabase.from('users').select('id').eq('phone', phone).maybeSingle();
  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    await supabase.from('users').update({ name, email, last_registered_at: new Date().toISOString() }).eq('id', userId);
  } else {
    const { data: newUser, error: userErr } = await supabase
      .from('users')
      .insert({ phone, name, email, source: 'admin' })
      .select('id').single();
    if (userErr || !newUser) return jsonResponse({ error: 'Could not create user' }, 500);
    userId = newUser.id;
  }

  // Compute discount (same shape as register.ts but admin can override total later via PATCH).
  let totalAmount = event.price * seats;
  let discountApplied: string | null = null;
  let plusOnesToConsume = 0;
  let membershipIdToUpdate: string | null = null;
  let membershipNewPlusOnesUsed = 0;

  const { data: member } = await supabase
    .from('guild_path_members')
    .select('id, tier, plus_ones_used')
    .eq('user_id', userId)
    .eq('status', 'paid')
    .gte('expires_at', new Date().toISOString().split('T')[0])
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (member) {
    if (member.tier === 'initiate') {
      totalAmount = Math.round(totalAmount * 0.8);
      discountApplied = 'initiate';
    } else {
      const cap = member.tier === 'adventurer' ? 1 : 5;
      const remainingCap = Math.max(0, cap - member.plus_ones_used);
      const selfSeats = Math.min(1, seats);
      const plusOneCandidates = seats - selfSeats;
      plusOnesToConsume = Math.min(plusOneCandidates, remainingCap);
      const paidSeats = plusOneCandidates - plusOnesToConsume;
      totalAmount = paidSeats * event.price;
      discountApplied = member.tier;
      membershipIdToUpdate = member.id;
      membershipNewPlusOnesUsed = member.plus_ones_used + plusOnesToConsume;
    }
  }

  const { data: reg, error: regErr } = await supabase
    .from('registrations')
    .insert({
      event_id: body.event_id,
      user_id: userId,
      name, phone, email,
      seats,
      total_amount: totalAmount,
      discount_applied: discountApplied,
      custom_answers: body.custom_answers || {},
      payment_status: body.payment_status,
      plus_ones_consumed: plusOnesToConsume,
      source: 'admin',
    })
    .select('id')
    .single();

  if (regErr || !reg) return jsonResponse({ error: 'Registration failed' }, 500);

  if (membershipIdToUpdate && plusOnesToConsume > 0) {
    await supabase
      .from('guild_path_members')
      .update({ plus_ones_used: membershipNewPlusOnesUsed })
      .eq('id', membershipIdToUpdate);
  }

  if (email) {
    const customQuestions = (event.custom_questions || []) as Array<{ id: string; label: string }>;
    const customForEmail = customQuestions
      .map((q) => ({ id: q.id, label: q.label, answer: (body.custom_answers || {})[q.id] }))
      .filter((q) => q.answer !== undefined && q.answer !== null && q.answer !== '' && q.answer !== false);

    const payment_url = env.BGC_SITE_URL
      ? `${env.BGC_SITE_URL}/pay?amount=${totalAmount}&for=${encodeURIComponent(event.name)}`
      : '';

    ctx.waitUntil(
      sendEventRegistrationEmail(
        {
          to: email, name,
          event: {
            name: event.name, date: event.date, venue_name: event.venue_name,
            venue_area: event.venue_area ?? null, price_includes: event.price_includes ?? null,
          },
          seats, total_amount: totalAmount, discount_applied: discountApplied,
          custom_questions: customForEmail as any,
          upi: { id: env.UPI_ID, payee_name: 'Board Game Company' },
          payment_url,
        },
        env,
      ).catch((err) => console.error('[email] send error', err))
    );
  }

  return jsonResponse({ success: true, registration_id: reg.id });
}
```

- [ ] **Step 3: Run tests, expect pass**

Run: `cd worker && npm test`
Expected: PASS for both manual-register tests + existing access-auth tests.

- [ ] **Step 4: Wire into `worker/src/index.ts`**

```ts
import { handleManualRegister } from './admin/register-manual';
// inside admin block:
if (!response && url.pathname === '/api/admin/registrations/manual' && request.method === 'POST') {
  response = await handleManualRegister(request, env, ctx);
}
```

- [ ] **Step 5: Commit**

```bash
git add worker/src/admin/register-manual.ts worker/src/admin/register-manual.test.ts worker/src/index.ts
git commit -m "feat(worker): admin manual registration endpoint"
```

---

### Task 4.4: Frontend — registrations list

**Files:**
- Modify: `admin/src/pages/RegistrationsList.tsx`

- [ ] **Step 1: Replace with**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DataTable, { Column } from '@/components/DataTable';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { Registration, Event } from '@/lib/types';

export default function RegistrationsList() {
  const [params, setParams] = useSearchParams();
  const eventFilter = params.get('event') || '';
  const statusFilter = params.get('status') || '';

  const [regs, setRegs] = useState<Registration[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAdmin<{ events: Event[] }>('/api/admin/events')
      .then((r) => setEvents(r.events))
      .catch(showApiError);
  }, []);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (eventFilter) qs.set('event_id', eventFilter);
    if (statusFilter) qs.set('status', statusFilter);
    fetchAdmin<{ registrations: Registration[] }>(`/api/admin/registrations?${qs}`)
      .then((r) => setRegs(r.registrations))
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, [eventFilter, statusFilter]);

  const eventOptions = useMemo(() => {
    const now = Date.now();
    const upcoming = events.filter((e) => Date.parse(e.date) >= now).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const past = events.filter((e) => Date.parse(e.date) < now).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    return { upcoming, past };
  }, [events]);

  const eventNameById = useMemo(() => Object.fromEntries(events.map((e) => [e.id, e.name])), [events]);

  const columns: Column<Registration>[] = [
    { key: 'name', header: 'Name', render: (r) => r.name },
    { key: 'phone', header: 'Phone', render: (r) => r.phone },
    { key: 'event', header: 'Event', render: (r) => eventNameById[r.event_id] || '—' },
    { key: 'seats', header: 'Seats', render: (r) => r.seats },
    { key: 'total', header: 'Total', render: (r) => `₹${r.total_amount}` },
    { key: 'status', header: 'Status', render: (r) => r.payment_status },
    { key: 'source', header: 'Source', render: (r) => r.source || '—' },
    { key: 'created', header: 'Created', render: (r) => new Date(r.created_at).toLocaleString() },
  ];

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Registrations</h1>
        <Button asChild><Link to="/registrations/new">New manual registration</Link></Button>
      </div>
      <div className="flex gap-2 mb-3">
        <Select value={eventFilter || 'all'} onValueChange={(v) => setFilter('event', v === 'all' ? '' : v)}>
          <SelectTrigger className="w-72"><SelectValue placeholder="All events" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            {eventOptions.upcoming.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            {eventOptions.past.length > 0 && <SelectItem value="__sep" disabled>── past ──</SelectItem>}
            {eventOptions.past.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} (past)</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter || 'all'} onValueChange={(v) => setFilter('status', v === 'all' ? '' : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {loading ? <p>Loading…</p> : (
        <DataTable
          rows={regs}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/registrations/${r.id}${params.toString() ? '?' + params.toString() : ''}`)}
          emptyMessage="No registrations match."
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add admin/src/pages/RegistrationsList.tsx
git commit -m "feat(admin): registrations list page"
```

---

### Task 4.5: Frontend — registration edit drawer

**Files:**
- Create: `admin/src/pages/RegistrationDrawer.tsx`
- Modify: `admin/src/App.tsx`

- [ ] **Step 1: Create `admin/src/pages/RegistrationDrawer.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { Registration } from '@/lib/types';

export default function RegistrationDrawer() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [reg, setReg] = useState<Registration | null>(null);
  const [initial, setInitial] = useState<Registration | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchAdmin<{ registration: Registration }>(`/api/admin/registrations/${id}`)
      .then((r) => { setReg(r.registration); setInitial(r.registration); })
      .catch(showApiError);
  }, [id]);

  const dirty = useMemo(() => JSON.stringify(reg) !== JSON.stringify(initial), [reg, initial]);

  function close() {
    if (dirty && !confirm('Discard changes?')) return;
    navigate(-1);
  }

  async function save() {
    if (!reg) return;
    setSaving(true);
    try {
      await fetchAdmin(`/api/admin/registrations/${reg.id}`, {
        method: 'PATCH',
        body: JSON.stringify(reg),
      });
      toast.success('Registration updated');
      navigate(-1);
    } catch (e) {
      showApiError(e);
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof Registration>(k: K, v: Registration[K]) {
    setReg((r) => (r ? { ...r, [k]: v } : r));
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit registration</SheetTitle>
        </SheetHeader>
        {!reg ? <p className="p-4">Loading…</p> : (
          <div className="space-y-3 p-4">
            <div><Label>Name</Label><Input value={reg.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div><Label>Phone</Label><Input value={reg.phone} onChange={(e) => set('phone', e.target.value)} /></div>
            <div><Label>Email</Label><Input value={reg.email || ''} onChange={(e) => set('email', e.target.value)} /></div>
            <div><Label>Seats</Label><Input type="number" value={reg.seats} onChange={(e) => set('seats', Number(e.target.value))} /></div>
            <div><Label>Total amount (₹)</Label><Input type="number" value={reg.total_amount} onChange={(e) => set('total_amount', Number(e.target.value))} /></div>
            <div>
              <Label>Payment status</Label>
              <Select value={reg.payment_status} onValueChange={(v) => set('payment_status', v as Registration['payment_status'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Source</Label><Input value={reg.source || ''} onChange={(e) => set('source', e.target.value || null)} /></div>
            <div className="text-xs text-muted-foreground pt-2">Custom answers and discount can only be edited via the database.</div>
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Update `admin/src/App.tsx`**

```tsx
import RegistrationDrawer from './pages/RegistrationDrawer';
// ...
<Route path="/registrations" element={<RegistrationsList />} />
<Route path="/registrations/:id" element={<><RegistrationsList /><RegistrationDrawer /></>} />
```

- [ ] **Step 3: Commit**

```bash
git add admin/src/pages/RegistrationDrawer.tsx admin/src/App.tsx
git commit -m "feat(admin): registration edit drawer"
```

---

### Task 4.6: Frontend — manual registration drawer

**Files:**
- Create: `admin/src/pages/ManualRegistrationDrawer.tsx`
- Modify: `admin/src/App.tsx`

- [ ] **Step 1: Create `admin/src/pages/ManualRegistrationDrawer.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { Event, CustomQuestion } from '@/lib/types';

interface PhoneLookup {
  user: { found: boolean; name: string | null; email: string | null };
  membership: { isMember: boolean; tier: string | null; discount: string | null; plus_ones_remaining: number };
  existing_seats_for_event: number;
}

export default function ManualRegistrationDrawer() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [eventId, setEventId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [seats, setSeats] = useState(1);
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'confirmed'>('confirmed');
  const [customAnswers, setCustomAnswers] = useState<Record<string, string | boolean>>({});
  const [lookup, setLookup] = useState<PhoneLookup | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchAdmin<{ events: Event[] }>('/api/admin/events')
      .then((r) => {
        const upcoming = r.events.filter((e) => Date.parse(e.date) >= Date.now()).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
        setEvents(r.events);
        if (upcoming[0]) setEventId(upcoming[0].id);
      })
      .catch(showApiError);
  }, []);

  const event = events.find((e) => e.id === eventId);
  const customQuestions: CustomQuestion[] = event?.custom_questions || [];

  async function onPhoneBlur() {
    if (!phone || phone.length < 10) return;
    try {
      const r = await fetchAdmin<PhoneLookup>('/api/admin/lookup-phone', {
        method: 'POST', body: JSON.stringify({ phone, event_id: eventId }),
      });
      setLookup(r);
      if (r.user.found) {
        if (r.user.name && !name) setName(r.user.name);
        if (r.user.email && !email) setEmail(r.user.email);
      }
    } catch (e) {
      showApiError(e);
    }
  }

  function close() {
    navigate('/registrations');
  }

  async function save() {
    setSaving(true);
    try {
      await fetchAdmin('/api/admin/registrations/manual', {
        method: 'POST',
        body: JSON.stringify({ event_id: eventId, name, phone, email, seats, payment_status: paymentStatus, custom_answers: customAnswers }),
      });
      toast.success('Registration created');
      navigate('/registrations');
    } catch (e) {
      showApiError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>New manual registration</SheetTitle>
        </SheetHeader>
        <div className="space-y-3 p-4">
          <div>
            <Label>Event</Label>
            <Select value={eventId} onValueChange={setEventId}>
              <SelectTrigger><SelectValue placeholder="Pick an event" /></SelectTrigger>
              <SelectContent>
                {events.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} — {new Date(e.date).toLocaleDateString()}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={onPhoneBlur} placeholder="10-digit number" /></div>
          {lookup && lookup.membership.isMember && (
            <div className="text-xs rounded-md bg-emerald-50 text-emerald-900 p-2">
              Active {lookup.membership.tier} member · {lookup.membership.plus_ones_remaining} plus-ones remaining
            </div>
          )}
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Email (optional)</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label>Seats</Label><Input type="number" min={1} value={seats} onChange={(e) => setSeats(Number(e.target.value))} /></div>
          <div>
            <Label>Payment status</Label>
            <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as 'pending' | 'confirmed')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="confirmed">Confirmed (already paid)</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {customQuestions.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="text-sm font-medium">Custom questions</div>
              {customQuestions.map((q) => (
                <div key={q.id}>
                  <Label>{q.label}{q.required && ' *'}</Label>
                  {q.type === 'text' && <Input value={(customAnswers[q.id] as string) || ''} onChange={(e) => setCustomAnswers({ ...customAnswers, [q.id]: e.target.value })} />}
                  {q.type === 'checkbox' && (
                    <div className="flex items-center gap-2 mt-1">
                      <Checkbox checked={!!customAnswers[q.id]} onCheckedChange={(c) => setCustomAnswers({ ...customAnswers, [q.id]: !!c })} />
                      <span className="text-sm">Yes</span>
                    </div>
                  )}
                  {(q.type === 'select' || q.type === 'radio') && (
                    <Select value={(customAnswers[q.id] as string) || ''} onValueChange={(v) => setCustomAnswers({ ...customAnswers, [q.id]: v })}>
                      <SelectTrigger><SelectValue placeholder="Pick one" /></SelectTrigger>
                      <SelectContent>
                        {(q.options || []).map((o) => <SelectItem key={o.value} value={o.value}>{o.value}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || !eventId || !name || !phone}>{saving ? 'Saving…' : 'Create'}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Update `admin/src/App.tsx`**

```tsx
import ManualRegistrationDrawer from './pages/ManualRegistrationDrawer';
// ...
<Route path="/registrations/new" element={<><RegistrationsList /><ManualRegistrationDrawer /></>} />
```

- [ ] **Step 3: Commit**

```bash
git add admin/src/pages/ManualRegistrationDrawer.tsx admin/src/App.tsx
git commit -m "feat(admin): manual registration drawer"
```

---

## Phase 5 — Guild members + Users CRUD

### Task 5.1: Worker — guild-members and users endpoints

**Files:**
- Create: `worker/src/admin/guild-members.ts`
- Create: `worker/src/admin/users.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Create `worker/src/admin/guild-members.ts`**

```ts
import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';

const GM_FIELDS = ['tier', 'amount', 'status', 'starts_at', 'expires_at', 'plus_ones_used', 'source'] as const;
type GMField = (typeof GM_FIELDS)[number];

function pickGM(body: Record<string, unknown>): Partial<Record<GMField, unknown>> {
  const out: Partial<Record<GMField, unknown>> = {};
  for (const f of GM_FIELDS) if (f in body) out[f] = body[f];
  return out;
}

function validateGM(p: Partial<Record<GMField, unknown>>): string | null {
  if ('tier' in p && !['initiate', 'adventurer', 'guildmaster'].includes(p.tier as string)) return 'Tier must be initiate, adventurer, or guildmaster';
  if ('status' in p && !['pending', 'paid', 'cancelled'].includes(p.status as string)) return 'Status must be pending, paid, or cancelled';
  if ('amount' in p && (typeof p.amount !== 'number' || p.amount < 0)) return 'Amount must be non-negative';
  if ('plus_ones_used' in p && (typeof p.plus_ones_used !== 'number' || p.plus_ones_used < 0)) return 'Plus-ones used must be non-negative';
  return null;
}

export async function handleListGuildMembers(url: URL, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const status = url.searchParams.get('status');
  const tier = url.searchParams.get('tier');

  let q = supabase
    .from('guild_path_members')
    .select('*, users:user_id(name, phone, email)')
    .order('expires_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (tier) q = q.eq('tier', tier);

  const { data, error } = await q;
  if (error) return jsonResponse({ error: 'Failed to load guild members' }, 500);

  const members = (data || []).map((m: any) => ({
    id: m.id,
    user_id: m.user_id,
    tier: m.tier,
    amount: m.amount,
    status: m.status,
    starts_at: m.starts_at,
    expires_at: m.expires_at,
    plus_ones_used: m.plus_ones_used,
    source: m.source,
    user_name: m.users?.name ?? null,
    user_phone: m.users?.phone ?? '',
    user_email: m.users?.email ?? null,
  }));
  return jsonResponse({ members });
}

export async function handleGetGuildMember(id: string, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('guild_path_members')
    .select('*, users:user_id(name, phone, email)')
    .eq('id', id)
    .maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to load guild member' }, 500);
  if (!data) return jsonResponse({ error: 'Guild member not found' }, 404);
  const m: any = data;
  return jsonResponse({
    member: {
      id: m.id, user_id: m.user_id, tier: m.tier, amount: m.amount, status: m.status,
      starts_at: m.starts_at, expires_at: m.expires_at, plus_ones_used: m.plus_ones_used, source: m.source,
      user_name: m.users?.name ?? null, user_phone: m.users?.phone ?? '', user_email: m.users?.email ?? null,
    },
  });
}

export async function handleUpdateGuildMember(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);
  const payload = pickGM(body);
  if (Object.keys(payload).length === 0) return jsonResponse({ error: 'No fields to update' }, 400);
  const err = validateGM(payload);
  if (err) return jsonResponse({ error: err }, 400);
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('guild_path_members').update(payload).eq('id', id).select('*').maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to update' }, 500);
  if (!data) return jsonResponse({ error: 'Guild member not found' }, 404);
  return jsonResponse({ member: data });
}
```

- [ ] **Step 2: Create `worker/src/admin/users.ts`**

```ts
import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { sanitizePhone, sanitizeEmail, sanitizeName, jsonResponse } from '../validation';

export async function handleGetUser(id: string, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to load user' }, 500);
  if (!data) return jsonResponse({ error: 'User not found' }, 404);
  return jsonResponse({ user: data });
}

export async function handleUpdateUser(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { name?: string; phone?: string; email?: string } | null;
  if (!body) return jsonResponse({ error: 'Invalid request body' }, 400);

  const update: Record<string, unknown> = {};
  if ('name' in body) {
    const n = sanitizeName(body.name || '');
    if (!n) return jsonResponse({ error: 'Invalid name' }, 400);
    update.name = n;
  }
  if ('phone' in body) {
    const p = sanitizePhone(body.phone || '');
    if (!p) return jsonResponse({ error: 'Invalid phone number' }, 400);
    update.phone = p;
  }
  if ('email' in body) {
    if (body.email) {
      const e = sanitizeEmail(body.email);
      if (!e) return jsonResponse({ error: 'Invalid email' }, 400);
      update.email = e;
    } else {
      update.email = null;
    }
  }
  if (Object.keys(update).length === 0) return jsonResponse({ error: 'No fields to update' }, 400);

  const supabase = getSupabase(env);
  const { data, error } = await supabase.from('users').update(update).eq('id', id).select('*').maybeSingle();
  if (error) return jsonResponse({ error: 'Failed to update user' }, 500);
  if (!data) return jsonResponse({ error: 'User not found' }, 404);
  return jsonResponse({ user: data });
}
```

- [ ] **Step 3: Wire into `worker/src/index.ts`**

```ts
import { handleListGuildMembers, handleGetGuildMember, handleUpdateGuildMember } from './admin/guild-members';
import { handleGetUser, handleUpdateUser } from './admin/users';

// inside admin block:
const gmMatch = url.pathname.match(/^\/api\/admin\/guild-members(?:\/([^/]+))?$/);
if (!response && gmMatch) {
  const gmId = gmMatch[1];
  if (!gmId && request.method === 'GET') response = await handleListGuildMembers(url, env);
  else if (gmId && request.method === 'GET') response = await handleGetGuildMember(gmId, env);
  else if (gmId && request.method === 'PATCH') response = await handleUpdateGuildMember(gmId, request, env);
  else response = new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}

const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
if (!response && userMatch) {
  const userId = userMatch[1];
  if (request.method === 'GET') response = await handleGetUser(userId, env);
  else if (request.method === 'PATCH') response = await handleUpdateUser(userId, request, env);
  else response = new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}
```

- [ ] **Step 4: Type-check, commit**

```bash
cd worker && npx tsc --noEmit
git add worker/src/admin/guild-members.ts worker/src/admin/users.ts worker/src/index.ts
git commit -m "feat(worker): admin guild-members and users endpoints"
```

---

### Task 5.2: Frontend — guild list + drawers

**Files:**
- Modify: `admin/src/pages/GuildList.tsx`
- Create: `admin/src/pages/GuildDrawer.tsx`
- Create: `admin/src/pages/UserDrawer.tsx`
- Modify: `admin/src/App.tsx`

- [ ] **Step 1: Replace `admin/src/pages/GuildList.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import DataTable, { Column } from '@/components/DataTable';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { GuildMember } from '@/lib/types';

export default function GuildList() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const tier = params.get('tier') || '';
  const [members, setMembers] = useState<GuildMember[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (tier) qs.set('tier', tier);
    fetchAdmin<{ members: GuildMember[] }>(`/api/admin/guild-members?${qs}`)
      .then((r) => setMembers(r.members))
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, [status, tier]);

  const columns: Column<GuildMember>[] = [
    { key: 'name', header: 'Name', render: (m) => m.user_name || '—' },
    { key: 'phone', header: 'Phone', render: (m) => m.user_phone },
    { key: 'tier', header: 'Tier', render: (m) => m.tier },
    { key: 'starts', header: 'Starts', render: (m) => m.starts_at },
    { key: 'expires', header: 'Expires', render: (m) => m.expires_at },
    { key: 'status', header: 'Status', render: (m) => m.status },
    { key: 'plus_ones', header: 'Plus-ones used', render: (m) => m.plus_ones_used },
  ];

  function setFilter(k: string, v: string) {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Guild members</h1>
      <div className="flex gap-2 mb-3">
        <Select value={status || 'all'} onValueChange={(v) => setFilter('status', v === 'all' ? '' : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tier || 'all'} onValueChange={(v) => setFilter('tier', v === 'all' ? '' : v)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All tiers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tiers</SelectItem>
            <SelectItem value="initiate">Initiate</SelectItem>
            <SelectItem value="adventurer">Adventurer</SelectItem>
            <SelectItem value="guildmaster">Guildmaster</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {loading ? <p>Loading…</p> : (
        <DataTable
          rows={members}
          columns={columns}
          rowKey={(m) => m.id}
          onRowClick={(m) => navigate(`/guild/${m.id}`)}
          emptyMessage="No guild members match."
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `admin/src/pages/GuildDrawer.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { GuildMember } from '@/lib/types';

export default function GuildDrawer() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [m, setM] = useState<GuildMember | null>(null);
  const [initial, setInitial] = useState<GuildMember | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchAdmin<{ member: GuildMember }>(`/api/admin/guild-members/${id}`)
      .then((r) => { setM(r.member); setInitial(r.member); })
      .catch(showApiError);
  }, [id]);

  const dirty = useMemo(() => JSON.stringify(m) !== JSON.stringify(initial), [m, initial]);

  function close() {
    if (dirty && !confirm('Discard changes?')) return;
    navigate('/guild');
  }

  async function save() {
    if (!m) return;
    setSaving(true);
    try {
      const payload = {
        tier: m.tier, amount: m.amount, status: m.status,
        starts_at: m.starts_at, expires_at: m.expires_at,
        plus_ones_used: m.plus_ones_used, source: m.source,
      };
      await fetchAdmin(`/api/admin/guild-members/${m.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast.success('Guild member updated');
      navigate('/guild');
    } catch (e) {
      showApiError(e);
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof GuildMember>(k: K, v: GuildMember[K]) {
    setM((x) => x ? { ...x, [k]: v } : x);
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit guild member</SheetTitle>
        </SheetHeader>
        {!m ? <p className="p-4">Loading…</p> : (
          <div className="space-y-3 p-4">
            <div className="rounded-md bg-muted/40 p-3 text-sm">
              <div><span className="text-muted-foreground">Name:</span> {m.user_name || '—'}</div>
              <div><span className="text-muted-foreground">Phone:</span> {m.user_phone}</div>
              <div><span className="text-muted-foreground">Email:</span> {m.user_email || '—'}</div>
              <Link to={`/guild/${m.id}/user`} className="text-xs underline mt-1 inline-block">Edit user details</Link>
            </div>
            <div>
              <Label>Tier</Label>
              <Select value={m.tier} onValueChange={(v) => set('tier', v as GuildMember['tier'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="initiate">Initiate</SelectItem>
                  <SelectItem value="adventurer">Adventurer</SelectItem>
                  <SelectItem value="guildmaster">Guildmaster</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={m.status} onValueChange={(v) => set('status', v as GuildMember['status'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Starts at</Label><Input type="date" value={m.starts_at} onChange={(e) => set('starts_at', e.target.value)} /></div>
              <div><Label>Expires at</Label><Input type="date" value={m.expires_at} onChange={(e) => set('expires_at', e.target.value)} /></div>
              <div><Label>Amount (₹)</Label><Input type="number" value={m.amount} onChange={(e) => set('amount', Number(e.target.value))} /></div>
              <div><Label>Plus-ones used</Label><Input type="number" value={m.plus_ones_used} onChange={(e) => set('plus_ones_used', Number(e.target.value))} /></div>
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 3: Create `admin/src/pages/UserDrawer.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchAdmin, showApiError } from '@/lib/api';
import { toast } from 'sonner';
import type { User, GuildMember } from '@/lib/types';

export default function UserDrawer() {
  const navigate = useNavigate();
  const { id: guildMemberId } = useParams();
  const [user, setUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!guildMemberId) return;
    fetchAdmin<{ member: GuildMember }>(`/api/admin/guild-members/${guildMemberId}`)
      .then(({ member }) => fetchAdmin<{ user: User }>(`/api/admin/users/${member.user_id}`))
      .then((r) => setUser(r.user))
      .catch(showApiError);
  }, [guildMemberId]);

  async function save() {
    if (!user) return;
    setSaving(true);
    try {
      await fetchAdmin(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: user.name || '', phone: user.phone, email: user.email }),
      });
      toast.success('User updated');
      navigate(`/guild/${guildMemberId}`);
    } catch (e) {
      showApiError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) navigate(`/guild/${guildMemberId}`); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader><SheetTitle>Edit user</SheetTitle></SheetHeader>
        {!user ? <p className="p-4">Loading…</p> : (
          <div className="space-y-3 p-4">
            <div><Label>Name</Label><Input value={user.name || ''} onChange={(e) => setUser({ ...user, name: e.target.value })} /></div>
            <div><Label>Phone</Label><Input value={user.phone} onChange={(e) => setUser({ ...user, phone: e.target.value })} /></div>
            <div><Label>Email</Label><Input value={user.email || ''} onChange={(e) => setUser({ ...user, email: e.target.value || null })} /></div>
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="ghost" onClick={() => navigate(`/guild/${guildMemberId}`)} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Update `admin/src/App.tsx`**

```tsx
import GuildDrawer from './pages/GuildDrawer';
import UserDrawer from './pages/UserDrawer';
// ...
<Route path="/guild" element={<GuildList />} />
<Route path="/guild/:id" element={<><GuildList /><GuildDrawer /></>} />
<Route path="/guild/:id/user" element={<><GuildList /><GuildDrawer /><UserDrawer /></>} />
```

- [ ] **Step 5: Commit**

```bash
git add admin/src/pages/GuildList.tsx admin/src/pages/GuildDrawer.tsx admin/src/pages/UserDrawer.tsx admin/src/App.tsx
git commit -m "feat(admin): guild members list and edit drawers"
```

---

## Phase 6 — Dashboard summary

### Task 6.1: Worker — summary endpoint (TDD)

**Files:**
- Create: `worker/src/admin/summary.ts`
- Create: `worker/src/admin/summary.test.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Write failing test for summary aggregation logic**

```ts
import { describe, it, expect } from 'vitest';
import { aggregateRegistrations, type RegRow, type EventRow } from './summary';

const event: EventRow = {
  id: 'e1', name: 'X', date: '2026-06-01T00:00:00Z',
  capacity: 30, custom_questions: [
    { id: 'meal', label: 'Meal', type: 'select', required: true, options: [{ value: 'Veg' }, { value: 'NonVeg' }] },
    { id: 'note', label: 'Note', type: 'text', required: false },
  ],
} as any;

const regs: RegRow[] = [
  { id: 'r1', user_id: 'u1', seats: 2, payment_status: 'confirmed', custom_answers: { meal: 'Veg', note: 'allergy: nuts' } },
  { id: 'r2', user_id: 'u2', seats: 1, payment_status: 'confirmed', custom_answers: { meal: 'NonVeg' } },
  { id: 'r3', user_id: 'u3', seats: 3, payment_status: 'pending', custom_answers: { meal: 'Veg' } },
  { id: 'r4', user_id: 'u4', seats: 1, payment_status: 'cancelled', custom_answers: { meal: 'Veg' } },
];

const guildUserIds = new Set(['u1']);

describe('aggregateRegistrations', () => {
  it('counts statuses correctly', () => {
    const summary = aggregateRegistrations(event, regs, guildUserIds);
    expect(summary.totals.confirmed).toBe(2);
    expect(summary.totals.pending).toBe(1);
    expect(summary.totals.cancelled).toBe(1);
  });

  it('sums confirmed seats for capacity_used', () => {
    const summary = aggregateRegistrations(event, regs, guildUserIds);
    expect(summary.capacity_used).toBe(3); // 2 + 1
  });

  it('counts confirmed regs whose user_id is in guild set', () => {
    const summary = aggregateRegistrations(event, regs, guildUserIds);
    expect(summary.guild_member_count).toBe(1);
  });

  it('aggregates select answers from confirmed only', () => {
    const summary = aggregateRegistrations(event, regs, guildUserIds);
    const meal = summary.custom_question_summary.meal;
    expect(meal).toEqual({ type: 'select', counts: { Veg: 1, NonVeg: 1 } });
  });

  it('collects text answers from confirmed only', () => {
    const summary = aggregateRegistrations(event, regs, guildUserIds);
    const note = summary.custom_question_summary.note;
    expect(note).toEqual({ type: 'text', count: 1, answers: ['allergy: nuts'] });
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd worker && npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `worker/src/admin/summary.ts`**

```ts
import type { Env } from '../index';
import { getSupabase } from '../supabase';
import { jsonResponse } from '../validation';

export interface EventRow {
  id: string; name: string; date: string; venue_name: string | null; venue_area: string | null;
  capacity: number; price: number; description: string | null; price_includes: string | null;
  is_published: boolean; created_at: string;
  custom_questions: Array<{ id: string; label: string; type: string; required: boolean; options?: Array<{ value: string }> }> | null;
}

export interface RegRow {
  id: string;
  user_id: string | null;
  seats: number;
  payment_status: 'pending' | 'confirmed' | 'cancelled';
  custom_answers: Record<string, string | boolean> | null;
}

export type QuestionSummary =
  | { type: 'select' | 'radio'; counts: Record<string, number> }
  | { type: 'checkbox'; yes: number; no: number }
  | { type: 'text'; count: number; answers: string[] };

export interface SummaryCard {
  event: EventRow;
  totals: { pending: number; confirmed: number; cancelled: number };
  guild_member_count: number;
  capacity_used: number;
  custom_question_summary: Record<string, QuestionSummary>;
}

export function aggregateRegistrations(event: EventRow, regs: RegRow[], guildUserIds: Set<string>): SummaryCard {
  const totals = { pending: 0, confirmed: 0, cancelled: 0 };
  let capacity_used = 0;
  let guild_member_count = 0;
  const cqs: Record<string, QuestionSummary> = {};

  for (const q of event.custom_questions || []) {
    if (q.type === 'select' || q.type === 'radio') {
      cqs[q.id] = { type: q.type as 'select' | 'radio', counts: {} };
    } else if (q.type === 'checkbox') {
      cqs[q.id] = { type: 'checkbox', yes: 0, no: 0 };
    } else if (q.type === 'text') {
      cqs[q.id] = { type: 'text', count: 0, answers: [] };
    }
  }

  for (const r of regs) {
    totals[r.payment_status]++;
    if (r.payment_status !== 'confirmed') continue;

    capacity_used += r.seats;
    if (r.user_id && guildUserIds.has(r.user_id)) guild_member_count++;

    for (const q of event.custom_questions || []) {
      const a = r.custom_answers?.[q.id];
      const summary = cqs[q.id];
      if (!summary) continue;
      if (summary.type === 'select' || summary.type === 'radio') {
        if (typeof a === 'string' && a) summary.counts[a] = (summary.counts[a] || 0) + 1;
      } else if (summary.type === 'checkbox') {
        if (a === true) summary.yes++;
        else summary.no++;
      } else if (summary.type === 'text') {
        if (typeof a === 'string' && a.trim()) {
          summary.count++;
          summary.answers.push(a);
        }
      }
    }
  }

  return { event, totals, guild_member_count, capacity_used, custom_question_summary: cqs };
}

export async function handleSummary(env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const nowIso = new Date().toISOString();

  const { data: upcomingEvents, error: ueErr } = await supabase
    .from('events').select('*').gte('date', nowIso).order('date', { ascending: true });
  if (ueErr) return jsonResponse({ error: 'Failed to load events' }, 500);

  const { data: pastEvents, error: peErr } = await supabase
    .from('events').select('*').lt('date', nowIso).order('date', { ascending: false }).limit(3);
  if (peErr) return jsonResponse({ error: 'Failed to load events' }, 500);

  const allEvents = [...(upcomingEvents || []), ...(pastEvents || [])];
  if (allEvents.length === 0) return jsonResponse({ upcoming: [], past: [] });

  const eventIds = allEvents.map((e: any) => e.id);
  const { data: regs, error: rErr } = await supabase
    .from('registrations')
    .select('id, event_id, user_id, seats, payment_status, custom_answers')
    .in('event_id', eventIds);
  if (rErr) return jsonResponse({ error: 'Failed to load registrations' }, 500);

  // Active guild members today
  const today = nowIso.split('T')[0];
  const { data: members } = await supabase
    .from('guild_path_members')
    .select('user_id')
    .eq('status', 'paid')
    .gte('expires_at', today);

  const guildIds = new Set<string>((members || []).map((m: any) => m.user_id));

  function buildCards(events: any[]): SummaryCard[] {
    return events.map((e) => {
      const eventRegs = (regs || []).filter((r: any) => r.event_id === e.id) as RegRow[];
      // For each event, the guild_member_count is restricted to members who would
      // be active on that event's date (handles past events). Simplification: we
      // use today's active set for upcoming, and for past events, we still use
      // "currently active" — tightening this requires per-event date checks; skipped
      // because non-members rarely become members retroactively.
      return aggregateRegistrations(e as EventRow, eventRegs, guildIds);
    });
  }

  return jsonResponse({
    upcoming: buildCards(upcomingEvents || []),
    past: buildCards(pastEvents || []),
  });
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd worker && npm test`
Expected: PASS for summary tests + all previous.

- [ ] **Step 5: Wire into `worker/src/index.ts`**

```ts
import { handleSummary } from './admin/summary';
// inside admin block:
if (!response && url.pathname === '/api/admin/summary' && request.method === 'GET') {
  response = await handleSummary(env);
}
```

- [ ] **Step 6: Commit**

```bash
git add worker/src/admin/summary.ts worker/src/admin/summary.test.ts worker/src/index.ts
git commit -m "feat(worker): admin dashboard summary endpoint"
```

---

### Task 6.2: Frontend — DashboardCard component

**Files:**
- Create: `admin/src/components/DashboardCard.tsx`

- [ ] **Step 1: Add types — append to `admin/src/lib/types.ts`**

```ts
export type QuestionSummary =
  | { type: 'select' | 'radio'; counts: Record<string, number> }
  | { type: 'checkbox'; yes: number; no: number }
  | { type: 'text'; count: number; answers: string[] };

export interface SummaryCard {
  event: Event;
  totals: { pending: number; confirmed: number; cancelled: number };
  guild_member_count: number;
  capacity_used: number;
  custom_question_summary: Record<string, QuestionSummary>;
}
```

- [ ] **Step 2: Create `admin/src/components/DashboardCard.tsx`**

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { SummaryCard, CustomQuestion } from '@/lib/types';

interface Props { summary: SummaryCard }

export default function DashboardCard({ summary }: Props) {
  const { event, totals, guild_member_count, capacity_used, custom_question_summary } = summary;
  const fillPct = event.capacity > 0 ? Math.min(100, Math.round((capacity_used / event.capacity) * 100)) : 0;
  const questions: CustomQuestion[] = (event.custom_questions || []) as CustomQuestion[];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{event.name}</span>
          <span className="text-sm font-normal text-muted-foreground">{new Date(event.date).toLocaleString()}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground">{event.venue_name || ''}</div>
        <div className="flex gap-4 text-sm">
          <span><strong>{totals.confirmed}</strong> confirmed</span>
          <span><strong>{totals.pending}</strong> pending</span>
          <span><strong>{totals.cancelled}</strong> cancelled</span>
          <span><strong>{guild_member_count}</strong> guild</span>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{capacity_used} / {event.capacity} seats</div>
          <div className="h-2 bg-muted rounded overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${fillPct}%` }} />
          </div>
        </div>
        {questions.length > 0 && (
          <div className="space-y-2">
            {questions.map((q) => {
              const s = custom_question_summary[q.id];
              if (!s) return null;
              return <QuestionSummaryRow key={q.id} question={q} summary={s} />;
            })}
          </div>
        )}
        <div className="pt-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/registrations?event=${event.id}`}>View registrations</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function QuestionSummaryRow({ question, summary }: { question: CustomQuestion; summary: import('@/lib/types').QuestionSummary }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="text-sm border-t pt-2">
      <div className="font-medium">{question.label}</div>
      {summary.type === 'select' || summary.type === 'radio' ? (
        <ul className="text-xs text-muted-foreground pl-2">
          {Object.entries(summary.counts).map(([opt, n]) => <li key={opt}>{opt}: {n}</li>)}
        </ul>
      ) : summary.type === 'checkbox' ? (
        <div className="text-xs text-muted-foreground">Yes: {summary.yes} · No: {summary.no}</div>
      ) : summary.type === 'text' ? (
        <div className="text-xs text-muted-foreground">
          <button onClick={() => setExpanded((x) => !x)} className="flex items-center gap-1 hover:underline">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {summary.count} answer{summary.count === 1 ? '' : 's'}
          </button>
          {expanded && (
            <ul className="pl-3 mt-1 space-y-0.5">
              {summary.answers.map((a, i) => <li key={i}>· {a}</li>)}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add admin/src/components/DashboardCard.tsx admin/src/lib/types.ts
git commit -m "feat(admin): dashboard card component"
```

---

### Task 6.3: Frontend — Dashboard page

**Files:**
- Modify: `admin/src/pages/Dashboard.tsx`

- [ ] **Step 1: Replace with**

```tsx
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';
import DashboardCard from '@/components/DashboardCard';
import { fetchAdmin, showApiError } from '@/lib/api';
import type { SummaryCard } from '@/lib/types';

export default function Dashboard() {
  const [data, setData] = useState<{ upcoming: SummaryCard[]; past: SummaryCard[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    fetchAdmin<{ upcoming: SummaryCard[]; past: SummaryCard[] }>('/api/admin/summary')
      .then(setData)
      .catch(showApiError)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading…</p>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <section>
        <h2 className="text-lg font-medium mb-3">Upcoming events</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.upcoming.length === 0
            ? <p className="text-sm text-muted-foreground">No upcoming events.</p>
            : data.upcoming.map((c) => <DashboardCard key={c.event.id} summary={c} />)}
        </div>
      </section>
      <section>
        <Button variant="ghost" onClick={() => setShowPast((x) => !x)} className="px-1">
          {showPast ? <ChevronDown className="h-4 w-4 mr-1" /> : <ChevronRight className="h-4 w-4 mr-1" />}
          Past events ({data.past.length})
        </Button>
        {showPast && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 mt-3">
            {data.past.map((c) => <DashboardCard key={c.event.id} summary={c} />)}
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add admin/src/pages/Dashboard.tsx
git commit -m "feat(admin): dashboard page with upcoming + past events"
```

---

## Phase 7 — PWA setup

### Task 7.1: Manifest, icons, and meta tags

**Files:**
- Create: `admin/public/manifest.webmanifest`
- Create: `admin/public/icon-192.png` (placeholder; replace with real icon)
- Create: `admin/public/icon-512.png`
- Create: `admin/public/apple-touch-icon.png`
- Modify: `admin/index.html`

- [ ] **Step 1: Create `admin/public/manifest.webmanifest`**

```json
{
  "name": "BGC Admin",
  "short_name": "BGC Admin",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#0a0a0a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: Add icons**

Drop three PNGs into `admin/public/`: `icon-192.png` (192×192), `icon-512.png` (512×512), `apple-touch-icon.png` (180×180). Use the existing `/Users/siddhantnarula/Projects/bgc-website/public/bgc-logo.png` resized — any image editor or:

```bash
cd admin/public
# Manual: copy the BGC logo and resize externally, or use sharp/imagemagick.
```

If you don't have ImageMagick, just copy the existing logo as a temporary placeholder:

```bash
cp ../public/bgc-logo.png icon-192.png
cp ../public/bgc-logo.png icon-512.png
cp ../public/bgc-logo.png apple-touch-icon.png
```

(Replace with proper 192/512/180 sizes before launch.)

- [ ] **Step 3: Replace `admin/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/icon-192.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0a0a0a" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="BGC Admin" />
    <title>BGC Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Commit**

```bash
git add admin/public/manifest.webmanifest admin/public/icon-192.png admin/public/icon-512.png admin/public/apple-touch-icon.png admin/index.html
git commit -m "feat(admin): PWA manifest and icons"
```

---

### Task 7.2: Service worker for app-shell caching

**Files:**
- Create: `admin/src/sw.ts`
- Modify: `admin/src/main.tsx`
- Modify: `admin/vite.config.ts`

- [ ] **Step 1: Add vite-plugin-pwa**

```bash
cd admin
npm install -D vite-plugin-pwa@^0.21
```

- [ ] **Step 2: Update `admin/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: false, // we ship our own manifest.webmanifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: /\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 5173 },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] },
});
```

- [ ] **Step 3: Verify PWA build**

Run: `cd admin && npm run build`
Expected: dist contains `sw.js` and `workbox-*.js`.

- [ ] **Step 4: Commit**

```bash
git add admin/package.json admin/package-lock.json admin/vite.config.ts
git commit -m "feat(admin): service worker for app-shell caching"
```

---

## Phase 8 — Sign-out polish & admin email display

### Task 8.1: Worker — `/api/admin/whoami` endpoint

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Add inline handler**

Inside the admin block (after the gate that produces `gate.admin.email`):

```ts
if (!response && url.pathname === '/api/admin/whoami' && request.method === 'GET') {
  response = new Response(JSON.stringify({ email: gate.admin.email }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(worker): admin whoami endpoint"
```

---

### Task 8.2: Frontend — show signed-in admin email

**Files:**
- Modify: `admin/src/components/TopBar.tsx`

- [ ] **Step 1: Replace with**

```tsx
import { useEffect, useState } from 'react';
import { fetchAdmin } from '@/lib/api';

export default function TopBar() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    fetchAdmin<{ email: string }>('/api/admin/whoami')
      .then((r) => setEmail(r.email))
      .catch(() => setEmail(null));
  }, []);

  return (
    <header className="h-14 bg-background border-b flex items-center justify-between px-6">
      <div className="font-medium">Admin</div>
      <div className="flex items-center gap-3 text-sm">
        {email && <span className="text-muted-foreground">{email}</span>}
        <a href="/cdn-cgi/access/logout" className="text-sm hover:underline">Sign out</a>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add admin/src/components/TopBar.tsx
git commit -m "feat(admin): show signed-in admin email in topbar"
```

---

## Phase 9 — Deployment

### Task 9.1: Configure Cloudflare Access application

**Files:** None (Cloudflare dashboard configuration)

- [ ] **Step 1: Add DNS record**

In Cloudflare DNS for `boardgamecompany.in`, add a `CNAME` record:
- Name: `admin`
- Target: a placeholder (e.g. `bgc-admin.pages.dev` — created in Task 9.2). Proxied (orange cloud) ON.

- [ ] **Step 2: Create Access application**

Cloudflare Zero Trust dashboard → Access → Applications → Add an application → Self-hosted.
- Application name: BGC Admin
- Subdomain: `admin`, Domain: `boardgamecompany.in`
- Session duration: **1 month**
- Identity providers: Google (or whichever is configured)
- Application Launcher visibility: optional

- [ ] **Step 3: Add Allow policy**

- Policy name: BGC admins
- Action: Allow
- Include: Emails → list the 4 admin emails

- [ ] **Step 4: Capture the AUD tag**

Click the application → Overview tab. Copy the **Application Audience (AUD) Tag** — this is the value for `CF_ACCESS_AUD`.

- [ ] **Step 5: Capture the team domain**

Top of Zero Trust dashboard. Format: `<team>.cloudflareaccess.com`. This is `CF_ACCESS_TEAM_DOMAIN`.

- [ ] **Step 6: Note completion in this checklist**

Record both values somewhere safe — they go into Worker env in Task 9.3 and Pages env in Task 9.2.

---

### Task 9.2: Create the `bgc-admin` Cloudflare Pages project

**Files:** None (Cloudflare dashboard)

- [ ] **Step 1: Create project**

Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → select the repo.
- Production branch: `main`
- Build command: `cd admin && npm install && npm run build`
- Build output directory: `admin/dist`
- Root directory: `/` (default)

- [ ] **Step 2: Set environment variables**

Production env vars:
- `VITE_API_BASE` = `https://bgc-api.boredsid.workers.dev`

(No secrets — Worker handles auth.)

- [ ] **Step 3: Trigger first deploy**

Push to `main` (or "Retry deployment" from the dashboard). Wait for build → success.

- [ ] **Step 4: Add custom domain**

In the Pages project → Custom domains → Set up a custom domain → `admin.boardgamecompany.in`. Cloudflare auto-updates DNS.

- [ ] **Step 5: Verify Access challenges the domain**

Open `https://admin.boardgamecompany.in` in a private window. Expected: Cloudflare Access login screen, not the admin UI.

---

### Task 9.3: Deploy Worker with Access env vars

**Files:**
- Modify: `worker/wrangler.toml`

- [ ] **Step 1: Replace placeholder vars in `worker/wrangler.toml`**

```toml
CF_ACCESS_TEAM_DOMAIN = "<your-team>.cloudflareaccess.com"
CF_ACCESS_AUD = "<aud-tag-from-9.1>"
ADMIN_EMAILS = "alice@x.com,bob@x.com,carol@x.com,dave@x.com"
ENVIRONMENT = "production"
```

- [ ] **Step 2: Deploy**

```bash
cd worker && npx wrangler deploy
```

- [ ] **Step 3: Smoke test from outside Access**

```bash
curl -i https://bgc-api.boredsid.workers.dev/api/admin/events
```

Expected: `401 Unauthorized` (no JWT).

- [ ] **Step 4: Smoke test through admin UI**

Sign in via `https://admin.boardgamecompany.in`. Open browser devtools → Network. Navigate to Events. Expected: GET `/api/admin/events` returns 200 with the events list.

- [ ] **Step 5: Commit env config**

```bash
git add worker/wrangler.toml
git commit -m "chore(worker): set Cloudflare Access env vars for production"
```

---

### Task 9.4: End-to-end smoke test

**Files:** None

- [ ] **Step 1: Visit admin domain in private window**

Expected: Access login → after sign-in, dashboard loads showing upcoming events.

- [ ] **Step 2: Click through every page**

Verify Dashboard, Events list, Games list, Registrations list, Guild list each load without errors.

- [ ] **Step 3: Create test event, then delete via Supabase dashboard**

In the admin: New event → fill in fields → Save. Verify it appears in the events list and (if `is_published`) on the public site. Then delete from the Supabase dashboard.

- [ ] **Step 4: Test manual registration**

Create a manual registration for a test event with a phone number that already has a guild membership. Verify discount applies, plus-ones decrement, source is `admin`.

- [ ] **Step 5: Test PWA install on mobile**

Open `admin.boardgamecompany.in` on iOS Safari → Share → Add to Home Screen. Tap the home-screen icon → expect standalone app, signed-in (within 1-month window).

- [ ] **Step 6: Test sign-out**

Click "Sign out" in TopBar → expect redirect to Access logout → back to login challenge.

---

## Plan complete

After all tasks: a working admin tool at `https://admin.boardgamecompany.in` gated by Cloudflare Access, with full CRUD for events / games / registrations / guild members, manual registration creation, dashboard summary, and PWA install support.





