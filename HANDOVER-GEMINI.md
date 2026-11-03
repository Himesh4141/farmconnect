# Farmconnect handover for Gemini

Updated 3 November 2026. Continue the existing Farmconnect project; do not replace it with a demo.

## Owner’s requirements

- Preserve the full React application previously approved at `http://localhost:4141`.
- Marketplace connects farmers/FPOs directly to consumers and bulk buyers. Farmer, consumer, bulk buyer, delivery partner, and administrator roles must remain isolated and enforced by the backend.
- Farmer stock is one shared quantity in kilograms; prices are calculated from price per kg. Farmers list and edit products, adjust stock, accept orders, pack them, and mark them ready for pickup. Delivery partners handle pickup and delivery.
- Keep the approved green Farmconnect branding and real-produce UI. Do not call the product production-ready unless real payments and delivery are configured and the full flow is verified.
- Free hosting without a card requirement is preferred. Do not enable billing or paid services without permission.

## Working locations

Deployment checkout:

```text
C:\Users\himes\Documents\Codex\2026-10-01\h\deploy-source
```

Original project, preserved as source:

```text
C:\Users\himes\Projects\Farmconnect
```

The owner approved preserving this version, but the original project and original database were not overwritten. Continue in the deployment checkout.

Git remote is `https://github.com/Himesh4141/farmconnect.git`. The deployment commits through `d84b939` were pushed to `main` on 3 November 2026. The latest Pages-name migration changes in this checkout still need a local commit and push. Never force-push.

## What is deployed

Primary Cloudflare Pages address:

```text
https://farmconnect.pages.dev
```

The owner requested the shorter Pages address. Cloudflare does not permit changing an existing `pages.dev` subdomain, so a second Pages project named `farmconnect` was created and deployed. The previous project remains available as a fallback at `https://farmconnect-himesh4141.pages.dev`. The API Worker accepts both origins during this transition. See [Cloudflare Pages known issues](https://developers.cloudflare.com/pages/platform/known-issues/).

Cloudflare API Worker:

```text
farmconnect-api
```

Cloudflare account ID:

```text
958710c499dde27ae9abe0e7fbc795b6
```

The primary site, fallback site, and API were deployed on 3 November 2026. The public verification script passed `/`, `/farmer`, `/delivery`, `/api/health`, `/api/catalog`, and `/api/store/config` on both Pages addresses. Health returned `200`, application `Farmconnect`, and database `connected`. The catalogue returns 7 products in 4 categories. An unauthenticated request to `/api/business/catalog` returned `401`.

The root `wrangler.jsonc` is the primary Pages configuration (`farmconnect`) and declares the private API service binding. `cloudflare/wrangler.jsonc` configures the API Worker and SQLite Durable Object, with `APP_ORIGIN=https://farmconnect.pages.dev` and the previous Pages origin in `ALLOWED_ORIGINS`. Wrangler v4.155 rejects a custom `--config` path on `pages deploy`; deploy Pages from the repo root so it reads root `wrangler.jsonc`:

```powershell
$env:XDG_CONFIG_HOME = Join-Path (Get-Location) 'deploy/private/cloudflare'
$env:WRANGLER_SEND_METRICS = 'false'
$env:CLOUDFLARE_ACCOUNT_ID = '958710c499dde27ae9abe0e7fbc795b6'
node cloudflare/node_modules/wrangler/bin/wrangler.js pages deploy cloudflare/site --project-name farmconnect-himesh4141 --branch main
```

For the API Worker, use `--config cloudflare/wrangler.jsonc --env=""` so Wrangler deploys the top-level production environment rather than `local`.

## Database state and transfer

The approved private local reference database was verified with SQLite integrity check `ok`. Its snapshot initially contained 3 users, 7 products, 2 orders, 5 farms, and 20 applied migrations.

The snapshot was transferred to the Cloudflare Durable Object database after the owner explicitly approved the transfer. Cloudflare now has the snapshot’s 42 non-ephemeral rows, including 3 accounts, 7 products, 2 orders, 5 farms, and 2 admin memberships. The owner’s account `himeshgurram4141@gmail.com` was an administrator in the source snapshot.

Old sessions, session details, auth attempt records, OAuth attempts, and demo courier/shipment events were excluded. Users must sign in again. The one-time importer route was removed from the Worker source and redeployed; its Cloudflare secret was deleted. The import audit row remains in the database.

**This did not migrate or reconcile the separate Render/Turso database.** Render may contain accounts or records created after the local snapshot. Keep the Render service running until its data has been reconciled and a rollback plan is verified. Render was last known at `https://farmconnect-himesh4141.onrender.com`; its database token was stored in Render and is not present in this checkout.

Temporary local files still need manual cleanup because the environment rejected their deletion. They are under:

```text
deploy/private/cloudflare/baseline-import.json
deploy/private/cloudflare/baseline-import-token.txt
```

The token has already been revoked in Cloudflare. The JSON file contains account identifiers/password hashes and business/order data; delete both files from the above private directory after confirming the site still works. Neither file is tracked by Git.

## Android APK

A release APK was rebuilt with the existing signing key, version code `6`, version `0.4.3`, and HTTPS origin `https://farmconnect.pages.dev`. Signature verification passed for APK v2 and v3. The public-site readiness checks passed against the new primary address during this build.

File:

```text
android/Farmconnect-release.apk
```

SHA-256:

```text
287D4103BD23A03D1204C23F64CEC77F8B1BB9509DF83357EBFBD24158250F76
```

No Android device was connected during the build. Physical installation and role-workflow testing remain outstanding. Preserve the existing key under `farmconnect-farmer-module/deploy/private/android-release`; never commit it or its password.

## Not configured or not verified

- **Google sign-in:** code exists, but `/api/auth/google/config` returns `{"enabled":false}`. The owner has not created Google OAuth credentials. Do not claim Google sign-in works until credentials and the exact callback are configured and tested.
- **Payments:** no payment gateway business account or credentials. Store config returns `checkoutEnabled:false` and `onlinePayments:false`.
- **Courier delivery:** no courier provider account or credentials. `courierMode` is `disabled`. Farm preparation states are not real courier booking or tracking.
- **Full integrated Cloudflare journey:** only public routes, health, catalogue, and basic access denial were verified against Cloudflare. A complete sign-in → consumer/bulk purchase → farmer acceptance/preparation → delivery journey has not been run on Cloudflare.
- **Administrator login:** the owner account and two admin memberships were imported, but the owner needs to sign in again and confirm access. Do not grant admin to other accounts.
- **Render cutover:** not completed. Do not shut down Render until its separate Turso records and credentials are accounted for.
- **APK phone test:** not done; no device was connected.

The backend regression suite last recorded 103/103 tests passing on 2 November 2026. That was the Node backend suite, not an end-to-end test of the deployed Cloudflare Worker.

## Immediate next actions

1. Manually delete the two temporary transfer files listed above; the Cloudflare token is already revoked.
2. Sign in to the Pages site with the existing owner account; confirm the admin panel and listing visibility.
3. Keep the old Pages address and Render service available until the owner has tested sign-in and the integrated journey on the new address.
4. Set up Google OAuth only after creating Farmconnect’s own Google client and registering the production callback:

   ```text
   https://farmconnect.pages.dev/api/auth/google/callback
   ```

5. Obtain real payment and courier provider accounts before enabling those services. Keep online checkout disabled until a verified fulfillment path exists.
6. Run isolated end-to-end role tests against Cloudflare, then install and test the signed APK on a real Android phone.
7. Reconcile Git with `origin/main`, inspect the staged diff, commit, and publish the application source. Do not include `deploy/private/`, databases, signing material, transfer exports, tokens, or built APKs in Git.
8. Retire Render only after data integrity, access, recovery, and integrated workflows are confirmed.
