# Farmconnect: no-card hosting

Target: Render Free web service + Turso Free libSQL database. Both the website and the Android app use the same HTTPS service. No PC or USB connection is needed after deployment.

Status: code prepared; public deployment and release APK still require the owner's signed-in hosting accounts. No public address has been assigned or tested yet.

## Accounts

Sign in at https://dashboard.render.com and https://app.turso.tech. Use only their free plans. Do not add payment details, enable overages, or accept a paid upgrade. If the host requires account-specific card verification, stop; the no-card requirement takes priority.

## Deployment

1. Create a new **libSQL** database in Turso, in Oregon (US West), matching the Render service. Keep its URL and database token private. This is a fresh hosted database; the laptop database is not uploaded automatically.
2. Publish the prepared source to the owner's GitHub repository after reviewing the source bundle. Exclude secrets, databases, Android signing keys and test-account fixtures.
3. Create a Render **Free** Docker web service from that repository, using the repository root and `Dockerfile`. `render.yaml` contains the settings. Use one service instance. No Render Postgres database or paid disk is needed.
4. Set these environment values in Render's secret settings:

   - `NODE_ENV=production`, `APP_MODE=demo`
   - `COURIER_MODE=demo`, `CHECKOUT_ENABLED=true`
   - `HOST=0.0.0.0`, `PORT=4000`, `TRUST_PROXY=render`
   - `APP_ORIGIN=https://<the assigned Render hostname>` (no trailing slash)
   - `TURSO_DATABASE_URL=<database URL>` and `TURSO_AUTH_TOKEN=<private database token>`

   Keep payment and courier credentials empty. Hosted demo mode rejects them and shows that orders do not involve real payment or delivery. Secure cookies, origin checks and role approvals remain enabled.
5. Verify `/api/health`, the website, registration, approvals, weight-based ordering, farmer preparation, delivery simulation and buyer tracking. Restart the service and confirm accounts, uploaded photos and orders still exist in Turso. Run `node deploy/verify-public.mjs https://<assigned hostname>` as an additional read-only check.
6. Bootstrap the owner's administrator account through a trusted operator connection after the owner registers; never publish a default administrator password. Add test service areas and approve test farmer/delivery accounts before testing checkout.
7. Build the Android release using the verified origin and a private release signing key. The build script verifies the public service before signing. Retain the key securely for future app updates. Install and test the APK on a physical Android phone using mobile data with the computer stopped.

## Limits

- Render Free sleeps after 15 minutes without incoming requests. The next opening can take about a minute. The Android startup now retries automatically for a bounded period. Free hosting cannot promise instant, always-on service.
- Turso owns the durable database. The app never silently falls back to Render's temporary disk. Keep the free usage caps and overages disabled; use Turso's exports/restore controls for backups.
- No real payments or courier pickups are connected. Google sign-in requires separate OAuth setup for the final hostname.
- Existing local SQLite development still works. The local regression suite and in-memory libSQL compatibility suite are separate from a real remote database test.

Sources checked 2026-10-14: https://render.com/docs/free , https://turso.tech/pricing , https://github.com/tursodatabase/libsql-js .
