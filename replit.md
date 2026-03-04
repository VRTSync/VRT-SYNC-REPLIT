# FieldWork - Contractor Field App

## Overview

FieldWork is a monorepo project designed to empower contractors with a mobile field application for managing tasks across various communities. It features an Expo (React Native) frontend for mobile users and an Express.js backend. Key capabilities include offline task management, map-based task visualization, photo attachments via Google Cloud Storage, and an admin dashboard for task creation and user management. The project utilizes a shared Drizzle ORM and PostgreSQL schema for type safety across the client and server. The vision is to streamline field operations, improve task efficiency, and provide a robust platform for contractor-client interactions.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure
The project is organized as a monorepo with `app/` for the Expo React Native application, `server/` for the Express.js API, and `shared/` for common code including Drizzle ORM schema definitions and Zod validation.

### Authentication & Authorization
The system employs session-based authentication using `express-session` with a PostgreSQL store. Passwords are `bcryptjs` hashed. There are four roles: `admin`, `contractor`, `hoa_admin`, and `hoa_member`. Middleware enforces access control: `requireAuth`, `requireAdmin`, and `enforceHoaScoping` (applied globally to `/api` routes). HOA users have a `hoaCommunityId` FK column on the users table that locks them to a single community. Session stores `hoaCommunityId` for HOA roles. HOA user limits: max 1 `hoa_admin` and max 4 `hoa_member` per community. React Query manages client-side user sessions. The mobile app hides the Admin tab for non-admin roles and locks community switching for HOA users.

### Data Model
The PostgreSQL database, managed with Drizzle ORM, includes tables for:
- **Users**: Contractors, Admins, HOA Admins, and HOA Members. HOA users have a `hoaCommunityId` column for single-community scoping.
- **Communities**: Core organizational units.
- **Tasks**: Community-scoped tasks with status, priority, geolocation, assignee, and versioning. Supports CSV import and bulk assignment. HOA Request fields: `origin` (varchar, "HOA" for HOA-created requests), `assetId` (FK to assets, nullable), `category` (varchar, nullable: Irrigation/Landscape/Snow/Other). Status enum includes "submitted" and "acknowledged" for HOA request flow. HOA requests are created via `POST /api/hoa/requests` (hoa_admin only) with optional `assignedTo` for contractor assignment (validated against community membership). Contractor handling: HOA requests appear in dedicated "Urgent Requests" and "HOA Requests" sections in the task list. Status flow enforced server-side: Submitted→Acknowledged→Completed (no skipping). Contractors cannot change HOA request priority. Task detail gates Complete behind Acknowledge for HOA requests. Contractor dashboard shows a Requests card with urgent/normal open request counts and "View Requests" navigation.
- **Task Completions**: Records task completion details including notes, sign-off, time, materials, and follow-up.
- **Attachments**: References to files stored in Google Cloud Storage.
- **Assets**: Community-scoped physical assets with types (e.g., controller, backflow, tree) and properties. Features auto-sync from GeoJSON map layers, KML ingestion for irrigation systems, and bulk property completion. Includes `tags[]` text array, `createdBy`/`updatedBy` audit fields (FK to users), and auto-computed `sqFt` property for polygon assets via @turf/area.
- **Task Templates**: Reusable templates for generating tasks, supporting scheduled task generation.
- **Offline Packs**: Per-community downloadable data packs for offline functionality.
- **Task Schedules**: Recurrence schedules for automated task generation based on templates.
- **Service Schedules**: Recurring service day-of-week schedules (e.g., mowing) per community with seasonal bounds.
- **Service Visits**: Individual visit logs tied to a schedule+date, with idempotent upsert via unique (scheduleId, serviceDate) constraint.
- **Asset Notes**: Contractor notes on assets with offline queue support. Fields: id, assetId, communityId, createdBy, noteText, idempotencyKey (unique for offline dedup), createdAt. API: `GET /api/assets/:id/notes`, `POST /api/assets/:id/notes`.
- **Tasks** now include `windowStart` and `windowEnd` date columns for windowed task scheduling.

### Mobile Service Schedule Widget
The mobile dashboard includes a MowingDayCard component (`components/MowingDayCard.tsx`) that displays active service schedules for the selected community. It shows the service type, day-of-week badge, season awareness, and next service date. A "Log" button opens a LogVisitModal (`components/LogVisitModal.tsx`) bottom-sheet for recording visits with date, sign-off name, and notes. The OfflineContext (`client/contexts/OfflineContext.tsx`) supports full offline caching of schedules/visits and an offline queue for visit logging (matching the task completion offline pattern). API paths: `GET /api/communities/:id/service-schedules`, `GET /api/communities/:id/service-visits`, `POST /api/service-schedules/:id/log`.

### Calendar View
The Tasks screen (`app/(tabs)/tasks.tsx`) includes a calendar/list view toggle. The CalendarView component (`components/CalendarView.tsx`) renders a month grid with:
- **Task window bars**: Horizontal bars spanning windowStart→windowEnd across day columns, color-coded by priority (green/orange/red/purple), with completed tasks showing strikethrough and muted colors, overdue tasks in red. Lane stacking (max 3 visible) with "+X more" overflow that opens a week items modal.
- **Mowing day indicators**: Green dots on matching day-of-week cells with season awareness. Filled green = logged, outlined = not logged. Tapping opens LogVisitModal with pre-filled date.
- **Month navigation**: Prev/next arrows and tap month title to return to today. Today highlighted with teal circle.
- **Offline support**: Reuses cached tasks, service schedules, and visits from OfflineContext — no new API calls. Works fully offline.
- **Interactions**: Tap task bar → navigate to task detail. Tap mowing dot → LogVisitModal. Tap "+X more" → week items modal listing all tasks and service days for that week.

### HOA Dashboard
The HOA Dashboard (`app/(hoa-tabs)/index.tsx`) is the landing page for HOA users. It fetches data from `GET /api/hoa/dashboard` (HOA users only, community-scoped) and displays 6 sections: (1) Header with community name, (2) Upcoming Tasks with execution windows and REQUEST badges for HOA-origin tasks, (3) Quick Map Layers 2x2 grid (Community/Irrigation/Trees/Snow) linking to `/(hoa-tabs)/map?category=X`, (4) Read-only Mowing Day Card (no Log button, no visit data), (5) Recent Completions with photo indicators, (6) Requests Preview with submitted/acknowledged counts and top requests. HOA_ADMIN sees Create Request button; HOA_MEMBER does not. The HOA Map tab (`app/(hoa-tabs)/map.tsx`) is a full asset map (same as contractor map) with category tabs and layer toggles, accepting a `category` URL param for quick navigation. No task/request pins.

### HOA Requests Tab
The Requests tab (`app/(hoa-tabs)/requests.tsx`) provides a unified request history for HOA users. Both `hoa_admin` and `hoa_member` can view the tab (read-only for members). Features filter chips (All/Submitted/Acknowledged/Completed/Archived) with "Submitted" as default. Each request card shows title, priority badge, status chip, date, location reference, and photo indicator. Completed requests auto-archive after 60 days (computed via `task_completions.completedAt`). Archived requests are hidden from active filters but accessible via Archived/All filter. `hoa_admin` gets a FAB to create requests. Tap navigates to task detail. API: `GET /api/hoa/requests` (HOA users only, scoped to `hoaCommunityId`).

### Request Map
The Request Map (`app/request-map/[id].tsx`) is a dedicated single-pin map screen for viewing individual HOA request locations. It shows exactly one pin at the request's pinLocation with a distinctive marker style. No asset layers, no other pins. Pin popup shows HOA REQUEST label, title, priority, and status. Accessed via "View on Map" button on the task detail screen for HOA requests. The Asset Map (`app/(tabs)/map.tsx`) shows only assets — no task or request pins.

### Map Initial Centering & Category Auto-Select
Both the contractor map (`app/(tabs)/map.tsx`) and HOA map (`app/(hoa-tabs)/map.tsx`) fetch community bounds via `GET /api/communities/:id/bounds` on load. The backend computes a bounding box from all map layer GeoJSON for the community and returns `{ bounds: [[south, west], [north, east]], center: [lat, lng] }`. `LeafletMap` accepts an `initialBounds` prop and uses `map.fitBounds()` on map ready to center the view on the community's geographic extent instead of the default US-wide view. The Leaflet bridge stores these bounds as `communityBounds` and uses them as a fallback in `fitToContent` — if no layers/tasks/markers are found, the map stays at the community bounds instead of resetting to the US default. Both maps auto-select the first category tab that has layers (e.g., if a community has no `community` layers but has `irrigation` layers, the Irrigation tab is auto-selected on load).

### Leaflet HTML Sync
The web iframe uses `generateLeafletHTML()` from `components/LeafletMap.tsx` via `srcDoc`, while the native WebView loads `server/public/leaflet-map.html` from the Express server. These two must stay in sync — any changes to the Leaflet bridge functions in `generateLeafletHTML()` must be manually mirrored to the static HTML file.

### Map Popups & Asset Detail
The map uses Leaflet HTML popups (inside the iframe/WebView) as the single popup system. Each feature popup shows the asset type, label, and a "View Details" button. The "View Details" button sends a `viewAssetDetail` bridge message which resolves the feature's database asset by featureRef and opens the `AssetDetailPanel`. There is no React Native overlay popup — all popup interaction happens inside Leaflet.

### Asset Detail Panel
The map popup's "View Details" button opens a full-screen `AssetDetailPanel` modal (`components/AssetDetailPanel.tsx`) with 3 tabs:
1. **Details**: Asset type, feature ref, geometry, location, sqFt (prominent for polygons), tags, properties, audit trail.
2. **Work History**: Task completions linked to the asset with dates, sign-off, notes, materials, follow-ups, and photo viewer.
3. **Contractor Notes**: Notes list (newest-first) with creator name + timestamp. Add note input with offline queue support (queued/syncing/failed states). Notes sync automatically on reconnect via OfflineContext.

### Access Control
Contractors have restricted access to tasks within their assigned communities, while Admins have full access. Community membership is managed through the admin interface. Optimistic locking is implemented for concurrency control.

### Frontend Architecture
Built with Expo SDK and Expo Router for file-based routing. Uses React Query for server state management. Features include:
- **Context Providers**: For authentication, active community selection, and offline support.
- **Offline Support**: Tasks are cached locally, and completions can be queued and synced. Offline map packs provide local GeoJSON layers and asset indexes.
- **Maps**: Leaflet-based web map (`components/LeafletMap.tsx`) used across all platforms.
- **Platform**: Supports iOS, Android, and web with platform-specific conditional logic.

### Screen Header Pattern
All screens use the `StatusBarFill` component (`components/StatusBarFill.tsx`) at the very top of the view hierarchy. This component renders an `ImageBackground` with `topography-texture.png` overlaid with `rgba(12, 29, 49, 0.88)` (dark navy). Its height equals `useSafeAreaInsets().top` on native and `67 + insets.top` on web. Screen-specific content (titles, back buttons, controls) sits below it as regular views — NOT inside the StatusBarFill. Sub-screens (like task detail) use `headerShown: false` in their Stack layout and render `<StatusBarFill />` + a content-level header bar. The task list header bar uses opaque `#0C1D31` background with white text/icons for contrast.

### API Design
A RESTful JSON API (`/api/`) provides endpoints for authentication, communities, tasks, user management, and object storage. Data is filtered by the selected community.

### Build & Deployment
Development involves separate processes for Expo and Express. Production builds include a static Expo web build and a bundled Express server. `drizzle-kit` handles database migrations. Replit-specific environment variables are utilized for configuration.

## External Dependencies

### Database
- **PostgreSQL**: Primary data store.
- **Drizzle ORM**: Type-safe query builder.
- **drizzle-kit**: Schema migration tool.

### Object Storage
- **Google Cloud Storage (@google-cloud/storage)**: For file and image storage, accessed via Replit's sidecar proxy, with ACL-based access control.

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

### Environment Variables
- `DATABASE_URL`
- `SESSION_SECRET`
- `EXPO_PUBLIC_DOMAIN`
- `REPLIT_DEV_DOMAIN` (Replit-specific)
- `PUBLIC_OBJECT_SEARCH_PATHS`