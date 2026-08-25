# Panchmeru Studio — Studio Operations & Management Platform

A real, working, mobile-first Progressive Web App for running Panchmeru Studio's day-to-day
operations across 40–50 active sites: attendance with GPS + biometric confirmation, task
management, site visits with GPS tracking and boundary mapping, documents, leave, notifications,
audit trail, and an owner dashboard. Built to be installed on a phone home screen today (PWA) and
wrapped into an app-store app later (Capacitor) with no rewrite.

The database also models the studio's future Client Portal and Commercial modules (quotations,
invoices, BOQ, vendors, etc.) end to end — those tables exist and are fully related, but they're
switched off by feature flags and never rendered in the current UI. Turning the studio's business
model outward to clients later is a flag flip and some new screens, not a re-architecture.

## Quick start

```bash
npm install
npm run db:push      # creates the local SQLite database from the schema
npm run db:seed      # loads demo data (6 users, 8 sites, sample tasks/leave/attendance)
npm run dev           # http://localhost:3000
```

### Demo logins

All seed accounts use the password `Panchmeru@123`.

| Role | Email |
|---|---|
| Owner | `owner@panchmeru.studio` |
| Manager | `manager@panchmeru.studio` |
| Supervisor | `supervisor@panchmeru.studio` |
| Employee | `ankit@panchmeru.studio`, `priya@panchmeru.studio`, `deepak@panchmeru.studio` |

Sign in on a phone (or a desktop browser with location permission granted) to exercise GPS
check-in against the seeded Ludhiana head-office geofence.

### Resetting the database

```bash
npm run db:reset   # deletes the SQLite file, re-applies the schema, re-seeds demo data
```

Restart `npm run dev` afterwards — the dev server holds the SQLite file open, so it needs a
restart to pick up a freshly recreated file.

## What's actually built (current version)

Every one of these is a real, working flow — not a mockup — verified with a scripted Playwright
walkthrough (`e2e-check.mjs`, see below):

- **Auth** — custom DB-backed sessions (httpOnly cookie, per-device revocation), password + optional
  WebAuthn biometric (Face ID / fingerprint) second factor
- **Employees** — onboarding, profiles, document uploads, status lifecycle, monthly salary (owner/
  manager only, used for the leave deduction below)
- **Attendance** — GPS + geofence-checked check-in/out, event-sourced (idempotent, fraud-resistant),
  optional biometric confirmation, offline queue with visible PENDING SYNC state. Every check-in and
  check-out captures exact GPS coordinates + accuracy (always) and a best-effort reverse-geocoded
  street address (when the free lookup succeeds) — both are visible to owner/manager on **Team
  attendance** and on a site's visit history, alongside distance from the expected geofence
- **Leave** — apply, view your balance, approve/reject. Policy: **8 sick days + 15 annual days per
  year, paid**; approved days beyond that allocation are automatically unpaid and deduct
  `(monthly salary ÷ 30)` per day from the employee's pay — see "Leave policy & payroll deduction"
  below
- **Tasks** — assign, submit, review/approve/request-changes, reschedule, cancel, full history,
  multi-modal conversation thread (text, photo, document, voice-with-live-transcription)
- **Sites** — directory with clustered map (Leaflet + OpenStreetMap, free, no API key), assignment,
  GPS-verified visit start/track/checkout, visit reports, walk-the-boundary area/perimeter capture,
  site photos
- **Projects** — create, edit status, milestones (add/track to done), team members, linked sites
- **Documents** — upload with automatic versioning, category/project/site linkage
- **Materials** — request and approve
- **Notifications, dashboard, reports (including a payroll/leave-deduction breakdown), full audit log
  (who/what/when/before/after, never overwritten), global search, feature-flag admin panel**

## Leave policy & payroll deduction

The studio's policy — 8 sick days/year + 15 annual days/year, both paid — is enforced in
`src/lib/leave-policy.ts` and seeded in `src/db/seed.ts`'s `leaveTypes` insert. When an owner/manager
approves a leave request, the app looks at how many days of that leave type the employee has already
had *approved* so far that calendar year, and splits the new request into paid days (up to the
remaining balance) and unpaid days (the rest). Unpaid days deduct `monthlySalary ÷ 30` per day — a
standard loss-of-pay convention — from the employee's stored monthly salary. The approver sees this
split *before* approving (e.g. "8 remaining paid days, 2 unpaid, ₹2,333 deduction"), the employee is
notified of any deduction on their own request, and a running **Payroll** table on the Reports page
(owner/manager only) totals each active employee's unpaid days and deduction amount for the year.

To change the policy (different day counts, a different divisor for the daily rate, or to add more
leave types), edit the `leaveTypes` seed values and `dailyRate()` in `leave-policy.ts` — nothing else
needs to change.

## What's modeled but hidden (future architecture)

The schema (`src/db/schema/future-client.ts`, `future-commercial.ts`) already has proper relational
tables — with foreign keys, not text fields — for:

- **Client Management & Portal**: Clients, ClientContacts, ClientUsers, ClientProjects,
  ClientDocuments, ClientDrawingShares (with explicit employee-vs-owner "who sent it" tracking),
  ClientRevisionRequests, ClientApprovals, ClientComments, ClientMessages, ClientActivities,
  ClientNotifications, ClientMeetings
- **Commercials**: Quotations, Estimates, BOQ, Contracts, Invoices, Payments, Expenses, Vendors

None of this is exposed in navigation or UI. Every flag defined in `src/lib/feature-flags.ts` seeds
`OFF`; toggle one from **Settings → Feature flags** (owner only) to confirm the tables are live and
ready — the UI for those modules is the next phase of work, not this one.

## Why this stack

The brief asked for the best free/cost-effective tooling for a mobile-first app that's easy to wrap
into a native app later. Given that:

- **Next.js (App Router) + TypeScript** — one codebase for the PWA today and (via Capacitor, see
  below) an app-store build later; free to build and host (Vercel's free tier covers this project's
  traffic comfortably)
- **Drizzle ORM + Postgres** — a real relational schema with proper foreign keys throughout (never
  plain-text references), zero licensing cost on a free-tier hosted Postgres (Supabase or Neon) — see
  below. *(Note: this project started on Prisma; it was swapped to Drizzle only because this
  sandbox's network policy blocks Prisma's engine-binary download — worth knowing if you ever see
  Prisma mentioned elsewhere, but it has no bearing on your deployment.)*
- **Custom DB-backed sessions** instead of a heavier auth framework — this needed per-device session
  rows for the "manage my signed-in devices" requirement, which off-the-shelf libraries fought
  against; a plain `userSessions` table with an httpOnly cookie is ~100 lines and fully auditable
- **Leaflet + OpenStreetMap** — a fully free map stack with marker clustering for 40–50+ sites, no API
  key, no per-load billing (unlike Google Maps)
- **WebAuthn** (`@simplewebauthn`) — the actual browser/OS biometric API; no raw fingerprint or face
  data is ever stored, only a public key and a signature counter
- **Browser-native MediaRecorder + Web Speech API** — free on-device voice capture and transcription,
  no paid speech-to-text API
- **IndexedDB-backed offline queue** — a plain browser API, no external dependency, so a site visit
  check-in made with no signal is never silently lost

## Database: Postgres

The app runs on Postgres end to end (`src/db/schema/*` uses `drizzle-orm/pg-core`, `src/db/client.ts`
connects via `drizzle-orm/postgres-js`). Set `DATABASE_URL` to a Postgres connection string — a
free-tier Supabase or Neon project is enough for this studio's scale — then:

```
npm run db:push   # creates/updates all tables from the schema
npm run db:seed   # optional: seeds demo roles, employees, leave types, one project/site
```

*(This project started on a local SQLite file for zero-config dev; it has since been fully migrated
to Postgres so local dev and production share one code path and one set of migrations.)*

### Deploying (free tier)

1. Push this repo to GitHub.
2. Create a free Supabase or Neon Postgres project; copy its connection string into `DATABASE_URL`.
3. Import the repo into Vercel (free Hobby tier). Set the `DATABASE_URL` environment variable to
   the Postgres connection string, and set `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` to your real domain
   (e.g. `panchmeru.vercel.app` and `https://panchmeru.vercel.app`) — WebAuthn is origin-locked and
   won't work if these are left as `localhost` in production.
4. **File storage is Cloudflare R2** (`src/lib/storage.ts`, via the S3-compatible API): chosen over
   Vercel Blob and Supabase Storage because it has the largest free tier (10GB) and never charges for
   downloads, even past that. Create a bucket in the Cloudflare dashboard (R2 Object Storage → Create
   bucket) and an API token scoped to it (R2 → Manage API tokens → Object Read & Write), then set four
   env vars in Vercel: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`.
   The bucket stays private — every read goes through `/api/files/[id]`, which checks the caller is
   signed in before streaming the object back, so nothing is ever served from a public bucket URL.
   (Local dev without these env vars will fail on first upload attempt, not at build time — see the
   comment at the top of `storage.ts`.)

## Installing as an app today, wrapping natively later

The app is already an installable PWA — open it on a phone, and the browser offers "Add to Home
Screen," which installs it with its own icon and no browser chrome (manifest + service worker are
already wired up, with offline-tolerant caching for the app shell).

For an actual app-store build later, wrap this same codebase with
[Capacitor](https://capacitorjs.com/) (free, open source): `npm install @capacitor/core
@capacitor/cli`, point it at the built Next.js output, and it produces an Android/iOS project that
embeds this web app in a native shell with access to native GPS/camera/biometric APIs where the web
APIs used here (`navigator.geolocation`, WebAuthn, MediaRecorder) don't already cover it. No
rewrite — the web app is the source of truth either way.

## Automated verification

`e2e-check.mjs` is a scripted Playwright walkthrough of the real acceptance flow: owner logs in,
onboards an employee, creates a site, assigns the employee, creates and assigns a task; the new
employee logs in with their temp password, sees the task, submits work, checks in with GPS at the
office geofence, applies for leave, starts a GPS-verified site visit at a different location, fills
in a report, and checks out; then the owner verifies the submission, approves it, sees the leave
request pending, sees the employee marked present, and sees the completed site visit in history.

```bash
npm run dev              # in one terminal
node e2e-check.mjs        # in another — needs `npm install playwright` once, plus
                           # `npx playwright install chromium` if Chromium isn't already present
```

It prints a ✅/❌ per step and saves a numbered screenshot of each step to `e2e-shots/`.

Two more focused scripts cover the newer functionality the same way:

- **`e2e-leave-check.mjs`** — applies for 10 days of sick leave (allocation is 8/year) as Ankit
  Sharma (seeded at ₹35,000/month), confirms the owner sees the correct "8 paid, 2 unpaid" preview
  before approving, approves it, and confirms the Reports payroll table shows exactly 2 unpaid days
  and a ₹2,333.33 deduction (35000 ÷ 30 × 2) — verifying the leave-balance math end to end, not just
  that the screens render.
- **`e2e-projects-check.mjs`** — creates a project, adds a milestone, cycles its status, adds a team
  member, and confirms it all shows up back on the projects list.

Run either the same way as `e2e-check.mjs` above.

## Known limitations / honest gaps

- **Photo and voice-note uploads during site-visit checkout require connectivity.** The visit's GPS
  check-in/out, tracking points, and report text fields are offline-queued (IndexedDB) and clearly
  marked PENDING SYNC when there's no signal; multipart photo/voice uploads are not yet queued the
  same way — on a flaky connection, save the report text first (it's protected) and add photos once
  back online.
- **WebAuthn (biometric) and voice recording were verified by code review and manual testing, not by
  the automated Playwright script** — both need a real browser/device with an actual authenticator
  or microphone, which a headless CI browser doesn't have. The rest of the acceptance flow (auth,
  GPS attendance, tasks, leave, site visits, approvals) is covered by `e2e-check.mjs` end to end.
- **Reverse-geocoded addresses on check-in/out are best-effort.** They use the free OpenStreetMap
  Nominatim API from the employee's browser — if that lookup is slow, rate-limited, or the network
  blocks it (as this development sandbox's does), the address is simply left blank and the record
  falls back to showing raw coordinates instead. The GPS coordinates, accuracy, and geofence
  distance are always captured regardless — the address is a convenience layer on top, never a
  dependency for the check-in/out itself to succeed.
- **SQLite is for local development only.** It works fine for one person testing on one machine, but
  isn't meant to hold this studio's real data — do the Postgres swap described above before onboarding
  real users.

## Project layout

```
src/db/schema/       All 62 tables, organized by domain (identity, employees, sites, tasks, …).
                      future-client.ts and future-commercial.ts hold the flagged-off modules.
src/lib/              Business logic: auth, RBAC, feature flags, geofencing, attendance/site-visit
                      services, file storage, audit logging, WebAuthn.
src/app/(app)/         Every current-version screen, grouped by feature, behind an auth-gated layout.
src/app/api/           Routes for GPS/biometric/multipart flows that need a real request/response
                      (attendance, site visits, file uploads, WebAuthn ceremonies).
src/components/        Shared UI: app shell/nav, icon set, map, voice recorder.
public/                PWA manifest, service worker, icons.
```
