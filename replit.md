# FieldWork - Contractor Field App

## Overview

FieldWork is a monorepo project designed to empower contractors with a mobile field application for managing tasks across various communities. It features an Expo (React Native) frontend for mobile users and an Express.js backend. Key capabilities include offline task management, map-based task visualization, photo attachments via Google Cloud Storage, and an admin dashboard for task creation and user management. The project utilizes a shared Drizzle ORM and PostgreSQL schema for type safety across the client and server. The vision is to streamline field operations, improve task efficiency, and provide a robust platform for contractor-client interactions.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure
The project is organized as a monorepo with `app/` for the Expo React Native application, `server/` for the Express.js API, and `shared/` for common code including Drizzle ORM schema definitions and Zod validation.

### Authentication & Authorization
The system employs session-based authentication using `express-session` with a PostgreSQL store. Passwords are `bcryptjs` hashed. There are two roles: `admin` and `contractor`, with middleware enforcing access control (`requireAuth`, `requireAdmin`). React Query manages client-side user sessions.

### Data Model
The PostgreSQL database, managed with Drizzle ORM, includes tables for:
- **Users**: Contractors and Admins.
- **Communities**: Core organizational units.
- **Tasks**: Community-scoped tasks with status, priority, geolocation, assignee, and versioning. Supports CSV import and bulk assignment.
- **Task Completions**: Records task completion details including notes, sign-off, time, materials, and follow-up.
- **Attachments**: References to files stored in Google Cloud Storage.
- **Assets**: Community-scoped physical assets with types (e.g., controller, backflow, tree) and properties. Features auto-sync from GeoJSON map layers, KML ingestion for irrigation systems, and bulk property completion.
- **Task Templates**: Reusable templates for generating tasks, supporting scheduled task generation.
- **Offline Packs**: Per-community downloadable data packs for offline functionality.
- **Task Schedules**: Recurrence schedules for automated task generation based on templates.
- **Service Schedules**: Recurring service day-of-week schedules (e.g., mowing) per community with seasonal bounds.
- **Service Visits**: Individual visit logs tied to a schedule+date, with idempotent upsert via unique (scheduleId, serviceDate) constraint.
- **Tasks** now include `windowStart` and `windowEnd` date columns for windowed task scheduling.

### Access Control
Contractors have restricted access to tasks within their assigned communities, while Admins have full access. Community membership is managed through the admin interface. Optimistic locking is implemented for concurrency control.

### Frontend Architecture
Built with Expo SDK and Expo Router for file-based routing. Uses React Query for server state management. Features include:
- **Context Providers**: For authentication, active community selection, and offline support.
- **Offline Support**: Tasks are cached locally, and completions can be queued and synced. Offline map packs provide local GeoJSON layers and asset indexes.
- **Maps**: `react-native-maps` for native platforms, with web fallback.
- **Platform**: Supports iOS, Android, and web with platform-specific conditional logic.

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
- **react-native-maps**: Native map rendering.
- **expo-image-picker**, **expo-location**: Photo capture and GPS services.
- **@react-native-async-storage/async-storage**: Local persistence.
- **zod**, **drizzle-zod**: Validation schemas.

### Environment Variables
- `DATABASE_URL`
- `SESSION_SECRET`
- `EXPO_PUBLIC_DOMAIN`
- `REPLIT_DEV_DOMAIN` (Replit-specific)
- `PUBLIC_OBJECT_SEARCH_PATHS`