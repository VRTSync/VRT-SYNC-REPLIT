# FieldWork - Contractor Field App

## Overview

FieldWork is a mobile contractor portal built with Expo (React Native) on the frontend and Express.js on the backend. It enables contractors to manage field tasks across communities, with an admin dashboard for task creation and user management. The app supports offline capabilities, map-based task visualization, and photo attachments via Google Cloud Storage.

The project is a monorepo where the Expo mobile app and Express API server coexist. The shared schema (Drizzle ORM + PostgreSQL) is used by both client and server for type safety.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure
- **`app/`** — Expo Router file-based routing (React Native screens)
  - `(auth)/` — Login and registration screens
  - `(tabs)/` — Main app tabs: Tasks list, Map, Admin, Profile
  - `task/[id].tsx` — Task detail screen with completion workflow
- **`server/`** — Express.js API server
  - `index.ts` — Server entry point with CORS setup
  - `routes.ts` — All API route definitions
  - `auth.ts` — Session-based authentication with express-session + connect-pg-simple
  - `storage.ts` — Database access layer (Drizzle ORM queries)
  - `assetSync.ts` — Auto-sync engine: creates/updates/archives assets from GeoJSON map layers
  - `kmlConverter.ts` — KML→GeoJSON converter with stable feature ID extraction (ExtendedData, sha1 hash)
  - `layerKeys.ts` — Canonical layer hierarchy dictionary and validation (community/irrigation/snow/trees)
  - `db.ts` — PostgreSQL connection pool setup
  - `objectStorage.ts` / `objectAcl.ts` — Google Cloud Storage integration with ACL policies
- **`shared/`** — Shared code between client and server
  - `schema.ts` — Drizzle ORM schema definitions and Zod validation schemas
- **`client/`** — Client-side utilities and context providers
  - `contexts/` — React contexts for Auth, Community selection, and Offline support
  - `utils/` — File upload utilities
- **`components/`** — Reusable React Native components
- **`lib/`** — Client-side API utilities (query client, fetch helpers)

### Authentication & Authorization
- **Session-based auth** using `express-session` with PostgreSQL session store (`connect-pg-simple`)
- Passwords hashed with `bcryptjs`
- Two roles: `admin` and `contractor`
- Middleware: `requireAuth` (any logged-in user) and `requireAdmin` (admin-only routes)
- Client uses React Query to cache the current user via `/api/auth/me`
- Auth state drives navigation: unauthenticated users see login/register, authenticated users see the main tabs

### Data Model (PostgreSQL + Drizzle ORM)
- **users** — id, username, password (hashed), displayName, role (contractor/admin)
- **communities** — id, name, description; core organizational unit
- **community_members** — many-to-many between users and communities, unique constraint on (communityId, userId)
- **tasks** — belong to a community, have status (pending/in_progress/completed), priority (low/medium/high/urgent), optional geolocation, assignee, version for optimistic concurrency
- **task_completions** — completion records with notes, employeeSignOffName (required), timeSpentMinutes, materialsUsed, followUpNeeded
- **attachments** — file references linked to task completions, with idempotencyKey for retry safety
- **push_tokens** — for push notification support
- **assets** — community-scoped physical assets (controllers, backflows, zones, trees, etc.) with optional geolocation, version for optimistic locking. Types: controller, backflow, zone, tree, pet_station, landscape_bed, bluegrass_area, native_area, snow_area. Fields: mapLayerId (source layer), isArchived/archivedAt (archival from sync), sourceUpdatedAt. Unique constraint on (communityId, mapLayerId, featureRef)
- **asset_properties** — key-value custom properties on assets, unique constraint on (asset_id, key) for efficient upsert
- **Asset Auto-Sync** — Map layers are source of truth for assets. GeoJSON features auto-create/update assets on layer create/update. Removed features get archived (not deleted). Asset type templates define required fields per type (e.g., backflow requires brand/serialNumber/size). Completeness endpoint tracks missing required fields. SubLayerKey mapping: irrigation/backflow→backflow, trees/tree→tree, etc.
- **Bulk Asset Completion** — POST /api/assets/bulk/properties accepts assetIds[], key, value, mode (set_if_missing|overwrite) for batch property updates. GET /api/communities/:id/assets/incomplete returns assets missing required fields with filters for assetType, mapLayerId, missingKey. Admin UI: Incomplete Queue modal with type/layer/key filters, multi-select bulk edit panel, and Save & Next sequential form for rapid field completion.
- **Global Search** — GET /api/search?q=&communityId=&types= searches across assets (label, featureRef, key properties like serialNumber/species/brand) and tasks (title, description, address) with relevance ranking. Permission-aware: contractors see only their communities/assigned tasks, admins see all. Frontend SearchModal component with debounced input, grouped results by type (Assets/Tasks), and navigation to detail views. Accessible from Home and Tasks tab headers via search icon. **Offline search**: when device is offline or API fails, falls back to locally cached search index from offline pack. Search index generated during pack creation (generateSearchIndex in storage.ts) containing assets with key properties and tasks. OfflinePackContext.searchOffline() performs local case-insensitive matching with relevance ranking. SearchModal shows "Searching offline data" banner and "offline" badge on results.
- **task_templates** — reusable task templates with name, title, description, priority, defaultStatus, dueDaysOffset, targetType (none/asset_type/map_layer/specific_asset), targetAssetType, targetMapLayerId, targetAssetId, requireSignOffName, allowPhotos. Admin Templates page with CRUD modals. Generate modal previews task count and creates tasks with optional community, assignee, due date. Template runs tracked in template_runs table.
- **template_runs** — logs of each template generation run with templateId, communityId, createdBy, taskCountCreated, assignmentUserId
- **Bulk Task Assignment** — POST /api/tasks/bulk/assign accepts taskIds[] and assignedTo for batch reassignment
- **task_links** — links a task to either an asset (linkType="asset") or GPS pin (linkType="pin")
- **offline_packs** — per-community downloadable data packs with packVersion, manifestRef, assetIndexRef, geojsonBundleRef, workHistoryRef, mbtilesRef, searchIndexRef, checksum; unique constraint on (communityId, packVersion)
- **task_schedules** — recurrence schedules linking a template to a community with frequency (weekly/monthly/once), daysOfWeek (comma-separated day indices 0-6), dayOfMonth (1-31), timezone (default America/Denver), startDate, endDate, nextRunAt, assignToUserId, isEnabled, createdBy. Unique constraint prevents duplicate runs via scheduleInstanceKey on tasks table (format: scheduleId:YYYY-MM-DD or scheduleId:YYYY-MM-DD:assetId).
- **schedule_runs** — logs each scheduler execution with scheduleId, windowStart, windowEnd, createdCount, skippedCount, status (success/failure), errorMessage
- **Scheduler Engine** — server/scheduler.ts: hourly interval finds enabled schedules where nextRunAt <= now, generates tasks with idempotent instance keys (prevents duplicates), records runs, advances nextRunAt. Supports template targeting (none → 1 task, asset_type/map_layer → 1 per matching asset, specific_asset → 1 task). POST /api/task-schedules/run-now for manual trigger. Admin Schedules page with CRUD modal, enable/disable toggle, run history panel, and Run Now button.

### Access Control
- Contractors can only view/complete tasks assigned to them within their communities
- Admins bypass all access restrictions
- `canUserAccessTask` and `isUserMemberOfCommunity` helpers enforce security on all task endpoints
- 403 returned for unauthorized access; 409 for version conflicts (optimistic locking)
- **Community Membership Management** — POST /api/admin/users creates contractor/admin users. POST /api/communities/:id/members accepts { userIds: string[] } for bulk member addition with { added, skipped } response. GET /api/users/:id/communities returns a user's community memberships. Admin web hub has Users page (create user modal, community badges per user, role toggle) and Members tab on community detail (multi-select add modal with search/filter, remove buttons, joined date).
- **Show on Map** — SearchModal "Show on Map" button passes targetLat/targetLng/targetLabel params to Map tab; NativeMap animates camera to target region and shows a teal pin. Alert shown if item has no coordinates.
- **409 Conflict UX** — Task detail auto-refreshes on 409 conflict (invalidates query, shows dialog). Offline queue uses 'conflict' state for version conflicts (separate from generic 'failed') with descriptive error message.

### Frontend Architecture
- **Expo SDK 54** with Expo Router v6 (file-based routing with typed routes)
- **React Query (@tanstack/react-query)** for server state management and data fetching
- **Context Providers**: AuthContext (user session), CommunityContext (active community selection with AsyncStorage persistence), OfflineContext (task caching and pending completion sync)
- **Offline Support**: Tasks are cached to AsyncStorage; completions can be queued offline and synced when connectivity returns
- **Offline Map Packs**: OfflinePackContext manages downloadable per-community packs containing GeoJSON layers, asset index, and work history snapshots stored in AsyncStorage. Map screen and asset history fall back to offline pack data when connectivity is lost. Pack UI on Profile screen shows download/update/delete controls.
- **Maps**: react-native-maps for native platforms, dynamically imported; web shows a placeholder
- **Platform**: Targets iOS, Android, and web; uses platform-specific conditionals throughout

### API Design
- RESTful JSON API under `/api/` prefix
- Routes for auth (`/api/auth/*`), communities (`/api/communities/*`), tasks (`/api/tasks/*`), task completions, user management
- Object storage routes for file uploads/downloads with ACL-based access control
- Community-scoped data filtering — tasks are filtered by the selected community

### Build & Deployment
- **Development**: Two processes — `expo:dev` (Expo dev server) and `server:dev` (Express via tsx)
- **Production**: Static Expo web build (`expo:static:build`) + bundled Express server (`server:build` via esbuild) served by `server:prod`
- **Database migrations**: `drizzle-kit push` for schema sync
- Uses Replit-specific environment variables (`REPLIT_DEV_DOMAIN`, `REPLIT_DOMAINS`, `REPLIT_INTERNAL_APP_DOMAIN`) for CORS and URL configuration

## External Dependencies

### Database
- **PostgreSQL** — Primary data store, connected via `pg` Pool using `DATABASE_URL` environment variable
- **Drizzle ORM** — Type-safe query builder and schema definition
- **drizzle-kit** — Schema migration tooling (push-based)

### Object Storage
- **Google Cloud Storage** (@google-cloud/storage) — File/image storage for task attachments
- Connects through Replit's sidecar proxy at `http://127.0.0.1:1106` for credentials
- ACL-based access control for stored objects

### Key NPM Packages
- **expo** (~54.0) — React Native framework
- **expo-router** (~6.0) — File-based navigation
- **@tanstack/react-query** (^5.83) — Data fetching and caching
- **express** (^5.0) — API server
- **express-session** + **connect-pg-simple** — Session management with PG store
- **bcryptjs** — Password hashing
- **react-native-maps** — Native map rendering
- **expo-image-picker** — Photo capture for task completions
- **expo-location** — GPS location services
- **@react-native-async-storage/async-storage** — Local persistence for offline support
- **zod** + **drizzle-zod** — Runtime validation schemas derived from DB schema
- **patch-package** — Applies patches to dependencies on install

### Environment Variables Required
- `DATABASE_URL` — PostgreSQL connection string
- `SESSION_SECRET` — Express session secret (has fallback default)
- `EXPO_PUBLIC_DOMAIN` — Public domain for API requests from client
- `REPLIT_DEV_DOMAIN` — Development domain (Replit-specific)
- `PUBLIC_OBJECT_SEARCH_PATHS` — Comma-separated paths for public object storage lookup