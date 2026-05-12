# VRTSync

A field-operations platform for landscape and HOA community management — mobile app for crews and HOA members, web admin portal for managers, and a backend API for data and push notifications.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port from `$PORT`, ~8080 in dev)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run migrate:generate --name <name>` — generate a new migration SQL file (see Gotchas)
- `pnpm --filter @workspace/db run migrate:up` — apply pending migrations against `DATABASE_URL` (CLI runner)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only — **risky in prod, prefer migrations**)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (+ WebSocket via `ws`, sessions via `express-session` + `connect-pg-simple`)
- DB: PostgreSQL + Drizzle ORM (`lib/db/src/schema/schema.ts`)
- Validation: Zod, `drizzle-zod`
- Build: esbuild (ESM bundle); `pdfkit`, `fontkit`, `@swc/helpers` are externalized
- Mobile: Expo SDK 54, expo-router v6, React Native 0.81.5

## Where things live

- `lib/db/src/schema/schema.ts` — DB schema (source of truth)
- `artifacts/api-server/src/routes/routes.ts` — all API routes (`registerRoutes`)
- `artifacts/api-server/src/app.ts` — Express app setup (CORS, sessions)
- `artifacts/api-server/src/index.ts` — startup migrations, seeds, scheduler
- `artifacts/api-server/src/shared/` — code shared between server and mobile (layerColors, assetFieldTemplates)
- `artifacts/web-portal/src/server.ts` — lightweight Express server for all web portal routes
- `artifacts/web-portal/public/` + `artifacts/web-portal/templates/` — static HTML/CSS/JS for web portals
- `artifacts/vrtsync-mobile/app/` — expo-router screens (`(auth)`, `(tabs)` crew, `(hoa-tabs)` HOA)
- `artifacts/vrtsync-mobile/client/` — contexts (Auth, Community, Offline, MapFilter) + utils
- `artifacts/vrtsync-mobile/shared/` — copies of server shared files for Metro bundler
- `artifacts/vrtsync-mobile/lib/query-client.ts` — fetch layer + React Query client

## Architecture decisions

- **Single-file routes**: all API routes live in `routes/routes.ts` via `registerRoutes(app)` called directly from `index.ts` (not as an Express Router) — mirrors the original monolith structure.
- **Two-layer boot migrations**: server boot runs two sequential phases: (1) Drizzle versioned migrator (`lib/db/migrations/`) using the `drizzle` schema for tracking — idempotent, auditable; (2) additive `ALTER TABLE … ADD COLUMN IF NOT EXISTS` block as a safety net for lagging environments. All new columns **must** ship as a migration file under `lib/db/migrations/`; the ALTER block is not the primary path anymore.
- **Migrations copied to dist**: `build.mjs` copies `lib/db/migrations/` into `artifacts/api-server/dist/migrations/` post-build so the bundled server can read SQL files at runtime. `lib/db/src/migrate.ts` accepts `migrationsFolder` as a parameter rather than computing it from `__dirname`.
- **Shared code duplication**: `artifacts/api-server/src/shared/` files are manually copied to `artifacts/vrtsync-mobile/shared/` because Metro bundler can't resolve outside the artifact directory.
- **pdfkit externalized**: `pdfkit`, `fontkit`, and `@swc/helpers` are listed as esbuild externals to avoid runtime `MODULE_NOT_FOUND` errors caused by fontkit's CJS helper imports.
- **CORS**: API allows any `*.replit.dev` / `*.replit.app` / `*.janeway.replit.dev` origin (covers both the main dev proxy and the Expo web preview domain).
- **Object ACL — owner OR community member**: Attachments are stored with `visibility: "private"` and a `COMMUNITY_MEMBER` ACL rule scoped to the task's `communityId`. `GET /objects/:id` grants access to the owner, any member of that community (via `community_members` OR `users.hoaCommunityId`), and admins (via `requireAdmin` middleware on export routes). The `exportGenerator.ts` bypasses the HTTP ACL layer by downloading bytes directly from GCS via service-account credentials — no signed-URL change needed there. A 90-day backfill script lives at `artifacts/api-server/src/scripts/backfill-acl.ts` to re-stamp pre-existing public attachments.

## Product

- **Crew portal** (`(tabs)`): task list, community map with GIS layers, admin tools, profile
- **HOA portal** (`(hoa-tabs)`): service calendar, community map, maintenance request submission, profile
- **Web portals**: admin hub (full management) and resident portal (HOA request tracking) served by the dedicated `web-portal` artifact at `/web/*`, `/admin-static`, `/portal-static`
- **Push notifications**: Expo push ticket system with scheduler for due-reminder alerts
- **Offline support**: React Query persistence via AsyncStorage + offline pack context (MMKV + file-system)

## Offline pack storage

- **Native (iOS/Android)**: MMKV stores hot metadata (manifest, packId, packVersion, downloadedAt) per community under key `pack_meta_<communityId>`. Large blobs (assetIndex, per-layer GeoJSON, workHistory, searchIndex) are written as individual JSON files at `documentDirectory/offline-packs/<communityId>/`.
- **Web**: Falls back to AsyncStorage (`offline_pack_meta_v2`) storing all packs as one JSON blob (the original approach). Web users rarely need offline support and AsyncStorage size limits are less critical there.
- **Atomicity**: The MMKV key is deleted before file writes begin and re-written only after all files are committed. A crash mid-write leaves no valid MMKV key; `verifyPack` returns `{ valid: false }` and the app prompts a re-download.
- **Migration**: On first boot after upgrade, `migrateFromAsyncStorage()` reads the legacy `offline_pack_meta` AsyncStorage key, saves each community pack through the new storage layer, and removes the old key. Migration runs once.
- **`clearCache` scope**: `OfflineContext.clearCache()` clears task cache, pending completions, service schedules/visits, and pending asset notes — it does NOT delete offline pack files. Pack management (download/delete) is done exclusively through `OfflinePackProvider` / the offline pack settings screen.

## User preferences

_Populate as encountered._

## Gotchas

- Always externalize `pdfkit`, `fontkit`, `@swc/helpers` in `build.mjs` — bundling them causes `@swc/helpers/cjs/_define_property.cjs` not found at runtime.
- `artifacts/vrtsync-mobile/shared/` must stay in sync with `artifacts/api-server/src/shared/` manually — Metro can't reach outside its project root.
- `registerRoutes` returns a `http.Server` (via WebSocket upgrade); call `.listen()` on the returned server, not on `app`.
- Mobile workflow restart required (not just HMR) when adding new top-level directories — Metro's watcher won't pick them up otherwise.
- **Never name a schema export `exports`**: drizzle-kit's CJS loader treats `export const exports = pgTable(...)` as a CJS reserved-word conflict and fails to transform the file. Use a distinct name (e.g. `exportJobs`) and keep the DB table name in the string argument.
- Do **not** use `drizzle-kit push` in production — it bypasses the migration history.
- After adding a new migration file, rebuild the server (`pnpm --filter @workspace/api-server run build`) so it gets copied to `dist/migrations/`.

## Pointers

- See `pnpm-workspace` skill for workspace structure and TypeScript setup
- See `expo` skill for mobile development guidelines
