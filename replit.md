# FieldWork - Contractor Field App

## Overview
FieldWork is a monorepo project providing a mobile field application for contractors to manage tasks across various communities. It features an Expo (React Native) frontend and an Express.js backend. Key capabilities include offline task management, map-based task visualization, photo attachments, and an admin dashboard for task creation and user management. The project uses a shared Drizzle ORM and PostgreSQL schema for type safety. The goal is to streamline field operations, improve task efficiency, and offer a robust platform for contractor-client interactions.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure
The project is organized as a monorepo with `app/` for the Expo React Native application, `server/` for the Express.js API, and `shared/` for common code including Drizzle ORM schema definitions and Zod validation.

### Authentication & Authorization
The system uses session-based authentication with `express-session` and a PostgreSQL store. Passwords are `bcryptjs` hashed. Five roles exist: `admin`, `property_manager`, `contractor`, `hoa_admin`, and `hoa_member`. Middleware enforces access control based on roles and HOA community scoping. HOA users are limited to a single community. Client-side authentication and routing are managed by React Query and Expo Router, with continuous enforcement of stack routing based on user roles.

### Web Portal Architecture (VRTSync Portal)
The web portal expands the existing admin portal into a multi-role SPA platform. All portals share the same design system, API layer, router pattern, and session authentication.

**Entry points:**
- `/web/login` — Unified login for all non-admin roles; detects role via `GET /api/auth/me` and redirects to the correct shell
- `/web/admin/*` — Super Admin Hub (existing, unchanged)
- `/web/contractor/*` — Contractor Portal shell
- `/web/hoa/*` — HOA Admin / HOA Member Portal shell
- `/web/pm/*` — Property Manager Portal shell

**Shared static assets:**
- `/admin-static/*` → `server/public/admin/` — design system CSS (`admin.css`), admin-specific JS
- `/portal-static/*` → `server/public/portal/` — shared portal JS (`portal-api.js`, `portal-router.js`, `portal.js`, `portal-ext.css`) and portal page modules (`pages/`)

**Shell templates:** `server/templates/contractor-shell.html`, `hoa-shell.html`, `pm-shell.html` — each sets `window.PORTAL_CONFIG = { base, allowedRoles, label }` before loading the shared `portal.js` bootstrap.

**Bootstrap flow:** `portal.js` reads `PORTAL_CONFIG`, validates role, fetches communities, renders role-appropriate sidebar nav, community picker (or fixed label for HOA), and user profile chip. `portal-topbar.js` activates all interactive topbar elements (notification bell, community selector dropdown, profile menu, "+" action menu). Unregistered routes show a "Coming Soon" placeholder automatically via the router.

**Topbar interactivity (`portal-topbar.js`):** Shared module loaded by all 4 shells. Provides: notification bell with dropdown panel (fetches from `/api/notifications`, shows unread-first list, mark-as-read per item and mark-all-read, 30s unread count polling); community selector dropdown for multi-community users; user profile dropdown with name/role/logout; role-aware "+" quick action menu. All dropdowns are appended to `document.body` as fixed-position elements and close on outside click.

**Page registration:** Each page module registers itself with `PortalRouter.register('route-name', fn)`. Page scripts are loaded in the shell template's `<script>` tags. `PortalState` provides `getUser()`, `getActiveCommunity()`, `getCommunities()`, and `setActiveCommunity()` to all page modules.

### Data Model
The PostgreSQL database, managed with Drizzle ORM, includes tables for Users, Communities, Tasks, Task Completions, Attachments, Assets, Task Templates, Offline Packs, Task Schedules, Service Schedules, Service Visits, and Asset Notes. Key features include:
- **Users**: Differentiated by roles with specific access controls. HOA users are scoped to a single community.
- **Tasks**: Community-scoped with status, priority, geolocation, assignee, and versioning. Supports CSV import, bulk assignment, and HOA-specific request flows with status enforcement. Tasks now include `windowStart` and `windowEnd` for scheduling.
- **Assets**: Community-scoped physical assets with types, properties, tags, and audit fields. Features auto-sync from GeoJSON, KML ingestion, and bulk property completion.
- **Service Schedules & Visits**: Recurring service schedules per community with seasonal bounds and individual visit logs, supporting idempotent upsert.
- **Asset Notes**: Contractor-specific notes on assets with offline queue support.
- **Attachments**: Support both task-completion-level and task-level attachments. The `attachments` table has nullable `taskCompletionId` and `taskId` columns. Task-level attachments are used for HOA request photos submitted during creation. Idempotency enforced via unique indexes on both `(taskCompletionId, idempotencyKey)` and `(taskId, idempotencyKey)`.
- **Notifications**: In-app notification feed for HOA admins and contractors. Stores notification type, title, body, read status, and related task. Push notifications sent via Expo push tokens.

### Mobile Features
- **Service Schedule Widget**: Displays active service schedules, next service date, and allows logging visits via a modal, with full offline support.
- **Calendar View**: Provides a calendar/list toggle on the Tasks screen, displaying tasks with window bars, color-coded by priority, and mowing day indicators. Features month navigation and works fully offline by reusing cached data.
- **HOA Tasks Page**: The HOA "Tasks" tab (formerly "Calendar") mirrors the contractor tasks page layout with list/calendar toggle, search, and filter tabs (All/Requests/Non-Requests). List view groups tasks by window classification (Overdue/Active/Upcoming/Other) with urgency chips. Read-only — no complete or acknowledge actions.
- **HOA Dashboard**: Landing page for HOA users, displaying upcoming tasks, quick map layers, read-only mowing day card, recent completions, and requests preview.
- **HOA Requests Tab**: Provides a unified request history for HOA users with filter chips and a create request option for `hoa_admin`.
- **Request Map**: A dedicated single-pin map screen for viewing individual HOA request locations.
- **Notification Bell**: Badge with unread count on both HOA admin and contractor dashboards. Taps open a shared notification list screen with mark-read and mark-all-read support.

### Map Implementation
The project uses a Leaflet-based map. Both contractor and HOA maps fetch community bounds on load to center the view. Map popups are Leaflet HTML popups, sending bridge messages to open a full-screen `AssetDetailPanel` modal. The `AssetDetailPanel` has tabs for Details, Work History, and Contractor Notes (with offline queue support). The Leaflet HTML for web iframe and native WebView must be kept in sync.

### Frontend Architecture
Built with Expo SDK and Expo Router for file-based routing. Uses React Query for server state management. Features context providers for authentication, active community selection, and offline support. Supports iOS, Android, and web. All screens utilize a `StatusBarFill` component for consistent header styling.

### Shared NavyHeader Component
`components/NavyHeader.tsx` is a prop-based shared component used across all contractor and HOA tab screens. It renders a navy bar (#0C1D31) with community name (left), optional chevron dropdown for multi-community users, and sync badge pill (right). Below the navy bar, each screen provides its own subtitle row (white bar with page title and actions) via `children`. The `components/useNavyHeaderProps.ts` hook computes sync state from `useOffline()` and community data from `useCommunity()`, returning all props NavyHeader needs. Used in: `app/(tabs)/index.tsx`, `app/(tabs)/tasks.tsx`, `app/(hoa-tabs)/index.tsx`, `app/(hoa-tabs)/calendar.tsx`, `app/(hoa-tabs)/requests.tsx`, `app/(hoa-tabs)/settings.tsx`.

### Web Portal — Tasks & Requests (Slice 3)
The web portals now include full task and request management pages:
- **Tasks page (`pages/tasks.js`)**: Shared across all three portal shells (Contractor, HOA, PM). Contractors see filter tabs (Active/Overdue/Upcoming/Completed) scoped to assigned tasks. HOA and PM see All/Active/Completed tabs for community-wide view. Clicking a task row opens the detail side panel.
- **Task Detail panel (`pages/task-detail.js`)**: Slide-in panel from the right showing full task details, status/priority badges, description, window dates, and completion history. Contractors see contextual action buttons: Acknowledge (HOA submitted tasks), Mark In Progress, and Complete (only from in_progress). Completion form captures sign-off name, time, materials, follow-up notes. HOA and PM roles are read-only.
- **Requests page (`pages/requests.js`)**: HOA-only page with filter chips (All/Open/Completed). HOA admins can create new requests via a modal form (title, description, priority, category). HOA members see list only.
- **`PortalRouter.refresh()`**: Added to re-render the current route after task actions without full navigation.
- **HOA request location relaxed**: `POST /api/hoa/requests` no longer requires `pinLat`/`pinLng` when no asset is selected. Partial coordinates (one without the other) are rejected.

### API Design
A RESTful JSON API (`/api/`) provides endpoints for authentication, communities, tasks, user management, and object storage. Data is filtered by the selected community.

### Build & Deployment
Development uses separate processes for Expo and Express. Production includes a static Expo web build and a bundled Express server. `drizzle-kit` manages database migrations.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store.
- **Drizzle ORM**: Type-safe query builder.
- **drizzle-kit**: Schema migration tool.

### Object Storage
- **Google Cloud Storage (@google-cloud/storage)**: For file and image storage.

### Key NPM Packages
- **expo**: React Native framework.
- **expo-router**: File-based navigation.
- **@tanstack/react-query**: Data fetching and caching.
- **express**: API server.
- **express-session**, **connect-pg-simple**: Session management.
- **bcryptjs**: Password hashing.
- **expo-image-picker**, **expo-location**: Photo capture and GPS services.
- **@react-native-async-storage/async-storage**: Local persistence.
- **zod**, **drizzle-zod**: Validation schemas.