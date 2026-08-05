# AGENTS.md

## Commands

- `npm run dev` — starts BOTH dev servers via concurrently: Vite on :5173 and `wrangler dev` (Workers runtime with local D1) on :8787. Frontend calls `/api/*`, which Vite proxies to :8787 (vite.config.ts).
- `npm run typecheck` — `vue-tsc -b`; typechecks BOTH `src/` (tsconfig.app.json) and `server/` + `vite.config.ts` (tsconfig.node.json) via TS project references.
- `npm run build` — `vue-tsc -b && vite build` (build includes typecheck).
- `npm run deploy` — `npm run build && npm run deploy:worker && npm run deploy:pages`; deploy:worker = `wrangler deploy`, deploy:pages = `wrangler pages deploy dist --project-name lemon-mail --branch main`.
- `npm run db:migrate` / `npm run db:migrate:local` — apply D1 migrations to remote / local database.
- No lint or test tooling configured — don't invent `npm run lint` / `npm test`.

## Architecture

- **Frontend**: Cloudflare Pages (`lemon-mail` project) at `mail.lemonhub.net`. One SFC: `src/App.vue`; entry `src/main.ts`. API base from `VITE_API_BASE` (`.env.production`), relative `/api` in dev (Vite proxy → :8787).
- **Backend**: Cloudflare Worker `lemon-mail` at `api.lemonhub.net`. One file: `server/worker.ts` (Hono + zod + @hono/zod-validator + PostalMime). Default export has BOTH `fetch` (REST API) and `email` (inbound) handlers. CORS allows only `https://mail.lemonhub.net`.
- **Inbound mail**: MX → Cloudflare Email Routing (zone-level, configured in Dashboard — catch-all rule sends to Worker `lemon-mail`) → `email` handler: size ≤1MB → mailbox exists → quota (10MB) check → PostalMime parse → insert into D1 `emails`. Rejections use `message.setReject()` (bounces to sender).
- **Auth**: per-mailbox password (WebCrypto PBKDF2, 100k iters, salted). Login issues a 32-byte session token stored in `auth_sessions` (7-day expiry). All mailbox-level API routes require `Authorization: Bearer <token>`; token must match the `:id` path param.
- Data persists in D1 (`lemon-mail`, binding `DB`); schema in `migrations/` (mailboxes with password columns, emails, auth_sessions). Changes to schema = new migration file, never direct edits to applied migrations.
- `wrangler.jsonc` is the deployment source of truth: worker entry, D1 binding, vars (`LEMONMAIL_DOMAIN`, `MAILBOX_QUOTA_MB`), custom domain route `api.lemonhub.net`.
- Tailwind CSS v4, CSS-first config in `src/style.css` (`@import "tailwindcss"` + `@theme`); no `tailwind.config.js`; colors are arbitrary hex classes.
- UI copy and API error messages are Chinese (zh-CN) — keep new user-facing strings in Chinese.

## Gotchas

- `verbatimModuleSyntax` on in both tsconfigs → `import type` required for type-only imports.
- `noUnusedLocals`/`noUnusedParameters` on for `src/` → typecheck fails on unused vars.
- zod v4 API (`.trim().email()`), not v3's `z.string().email()`.
- workers-types and DOM lib both define `ReadableStream` with incompatible types — email handler must read `message.raw` via a manual reader loop (see `readStream` in server/worker.ts), never pass it to `Response`.
- Email handler type is `ForwardableEmailMessage` (has `raw`/`rawSize`/`setReject`), not the base `EmailMessage`.
- `PostalMime` is a default export (`import PostalMime from 'postal-mime'`); use `new PostalMime().parse(bytes)`.
- Domain is `LEMONMAIL_DOMAIN` env var in wrangler.jsonc `vars`; `lemonhub.net` is hardcoded in `src/App.vue` for display.
- Email Routing rules/DNS/MX are zone-level and NOT managed by wrangler.jsonc — configure in Dashboard; the OAuth token cannot create email routing rules via API (error 2020) nor DNS records (no dns write scope).
- In this sandbox, workerd (local Workers runtime) cannot start (tcmalloc mmap blocked by PRoot) — `wrangler dev` and `--local` D1 commands fail here; verify changes via `npm run typecheck`/`build` and test against the deployed endpoint.
- Local D1 state lives in `.wrangler/state` (gitignored); apply migrations with `--local` on machines where workerd runs.
