# Proxmox Docker deployment

This runbook deploys Count On Us to a dedicated Ubuntu VM on a Proxmox host using Docker Compose. It is intentionally close to the external-VPS path, so the app can move later without changing its runtime shape.

## Host requirements

- Dedicated Ubuntu LTS VM, not Docker directly on the Proxmox host.
- At least 2 vCPU and 4 GB RAM for the first production-like rollout.
- Docker Engine and Docker Compose plugin.
- Public HTTPS ingress for the Shopify app domain, usually through Nginx Proxy Manager.
- Firewall rules that isolate the VM from other local services.
- S3-compatible object storage for receipts.
- Off-host database backup target, such as Backblaze B2 through `rclone` or `restic`.

## Network posture

Treat the VM as internet-facing even when it lives at home.

- Allow inbound traffic from the top-level reverse proxy to `APP_PORT`.
- Restrict inbound `22/tcp` to trusted admin IPs or a VPN.
- Block access from the VM to Proxmox management, other guests, NAS devices, IoT devices, printers, and private LAN ranges unless explicitly required.
- Allow outbound DNS, NTP, HTTP, and HTTPS only where practical.
- Keep Docker's internal database network private; Postgres is not published to the LAN.

Docker Compose provides container-to-container isolation, but local-network egress control belongs in Proxmox firewall, the VM firewall, or an upstream router/firewall.

## First deploy

1. Create the VM and install Docker.
2. Clone the repository on the VM.
3. Copy `.env.production.example` to `.env.production`.
4. Fill in Shopify, database, receipt storage, email, and secret values.
5. Point DNS for `APP_DOMAIN` to Nginx Proxy Manager or the public ingress path.
6. Confirm Shopify app config uses the same public base URL:
   - `https://APP_DOMAIN/app`
   - `https://APP_DOMAIN/auth/callback`
   - `https://APP_DOMAIN/auth/shopify/callback`
   - `https://APP_DOMAIN/webhooks`
7. Deploy:

```sh
bash scripts/deploy-production.sh
```

8. Confirm:
   - Nginx Proxy Manager routes to `http://<docker-vm-host>:APP_PORT`.
   - `https://APP_DOMAIN/healthz` returns JSON.
   - The embedded Shopify admin loads.
   - Webhooks reach `/webhooks`.
   - App proxy routes return widget data.
   - Receipt storage writes to object storage.
   - The VM cannot reach blocked local-network targets.

Run Shopify extension/config deployment from a Shopify CLI-authenticated machine whenever Shopify config or extension code changes:

```sh
npm run deploy
```

## Portainer stack deployment

Portainer can manage this deployment as a Stack using `compose.production.yml`.

Recommended Portainer setup:

- Create the stack inside the dedicated Count On Us Docker VM.
- Use the repository-based stack option if Portainer can access this repo, or paste/upload `compose.production.yml`.
- Add the values from `.env.production.example` in Portainer's environment-variable editor or env-file UI.
- Set `APP_DOMAIN` and `SHOPIFY_APP_URL` to the same public hostname.
- Set `APP_BIND_IP` and `APP_PORT` for the Nginx Proxy Manager target.
- Keep `APP_BIND_IP=127.0.0.1` if Nginx Proxy Manager can reach the app locally on the Docker VM; use the VM's LAN/interface IP only when the proxy runs elsewhere and needs network access.
- Do not publish additional ports beyond the app proxy target port.
- Do not add the app stack to external Docker networks used by unrelated services.

The Compose file marks `.env.production` as optional so Portainer-managed environment variables can be the source of truth. CLI deployments still use `.env.production` through `scripts/deploy-production.sh`.

## Reverse proxy options

The default production stack does not include Caddy. It publishes the Remix app on `APP_BIND_IP:APP_PORT` so a top-level proxy such as Nginx Proxy Manager can handle public HTTPS, certificates, and routing.

Recommended Nginx Proxy Manager settings:

- Scheme: `http`
- Forward hostname/IP: the Docker VM host reachable by NPM
- Forward port: `APP_PORT`
- Websockets support: enabled
- SSL: request/attach a certificate for `APP_DOMAIN`
- Force SSL: enabled

Caddy remains available as an optional standalone reverse proxy for environments that do not already have Nginx Proxy Manager:

```sh
APP_ENV_FILE=.env.production docker compose --env-file .env.production -f compose.production.yml -f compose.caddy.yml up -d --build --wait
```

## Image storage

The initial deployment builds the image on the Docker engine that runs the app:

- For Portainer deployments, the built app image lives in the local Docker image store inside the dedicated Proxmox Docker VM.
- For CLI deployments, `scripts/deploy-production.sh` also builds into that same local Docker image store.
- For CI, GitHub Actions builds a validation image on the temporary GitHub runner and does not publish it.

No registry is required for the first rollout. This keeps cost and moving parts low, but it means the production image is not an immutable artifact stored outside the host.

When deploys need stronger reproducibility, switch to registry-based deployment:

1. GitHub Actions builds the runtime image.
2. GitHub Actions tags it with the commit SHA.
3. GitHub Actions pushes it to GitHub Container Registry.
4. Portainer or Compose pulls that exact image tag on the Proxmox VM.

At that point, `compose.production.yml` should reference the pushed image instead of building from local source.

## Low-risk update process

Only deploy commits that have passed CI. The CI workflow runs the Remix build, unit tests, and a production Docker image build.

Before deploying an update, take a database backup:

```sh
bash scripts/backup-postgres.sh
```

Then update and redeploy:

```sh
git fetch --prune
git checkout main
git pull --ff-only
bash scripts/deploy-production.sh
```

The deploy script validates Compose config, builds the app image, starts the stack with `--wait`, and prints service status plus recent app logs. Prisma migrations run during app startup through `npm run docker-start`.

Smoke-test after every update:

- `https://APP_DOMAIN/healthz`
- embedded Shopify admin launch
- one authenticated admin page
- one public/app-proxy widget endpoint
- recent app logs for migration, queue, webhook, or storage errors

## Backups

The included backup script writes a compressed `pg_dump` under `backups/postgres`. For production use, sync that directory off-host, for example:

```sh
rclone sync backups/postgres b2:your-count-on-us-backups/postgres
```

Do not rely on local VM disk as the only copy. Also test restore before treating the deployment as production-ready.

Restore from a verified backup with:

```sh
bash scripts/restore-postgres.sh backups/postgres/countonus-YYYYMMDDTHHMMSSZ.sql.gz
```

The restore script stops the app, takes a pre-restore safety backup under `backups/postgres/pre-restore`, pipes the selected dump into `psql`, restarts the app, and prints service status. It prompts for confirmation by default. For non-interactive use, pass `--yes`:

```sh
bash scripts/restore-postgres.sh backups/postgres/countonus-YYYYMMDDTHHMMSSZ.sql.gz --yes
```

Only skip the pre-restore backup when you have a known-good off-host copy:

```sh
SKIP_PRE_RESTORE_BACKUP=true bash scripts/restore-postgres.sh backups/postgres/countonus-YYYYMMDDTHHMMSSZ.sql.gz
```

Prefer backups created by `scripts/backup-postgres.sh`, because it runs `pg_dump` from the same PostgreSQL container version used by production. Plain SQL dumps from pgAdmin can include newer client session settings, such as `SET transaction_timeout`, that PostgreSQL 16 does not recognize. The restore script filters that known unsupported setting by default. To disable that compatibility filter:

```sh
FILTER_UNSUPPORTED_PG_SETTINGS=false bash scripts/restore-postgres.sh backups/postgres/countonus-YYYYMMDDTHHMMSSZ.sql.gz
```

## Production catalog export

The standalone catalog/CSV importer has been removed because its duplicate cost
engine could diverge from production order calculations. Catalog exports remain
available for diagnostics and backups, but must not be used to create financial
snapshots. Use the production financial backfill or the admin **Imports &
rebuild** workflow instead.

The production app image includes the catalog export and import scripts. Run them
through the `app` service so they use the same Node, Prisma client, and
`DATABASE_URL` as the deployed application.

The runtime image is based on Alpine Linux. Use `/bin/sh`, not `/bin/bash`, for
ad hoc container inspection.

The production app container is read-only except for `/tmp`, so write temporary
files inside `/tmp`. Docker's `cp` command cannot copy files into this read-only
container rootfs, even when the destination is `/tmp`; stream host files through
`docker compose exec -T` instead.

Use the same Compose arguments as the deploy script:

```sh
APP_ENV_FILE=.env.production docker compose \
  --project-name count-on-us \
  --env-file .env.production \
  -f compose.production.yml \
  ps
```

Export catalog/configuration data from a production tenant:

```sh
mkdir -p seed-imports

APP_ENV_FILE=.env.production docker compose \
  --project-name count-on-us \
  --env-file .env.production \
  -f compose.production.yml \
  exec app npm run export:catalog -- \
    --shop=source-store.myshopify.com \
    --out=/tmp/catalog.json

APP_ENV_FILE=.env.production docker compose \
  --project-name count-on-us \
  --env-file .env.production \
  -f compose.production.yml \
  cp app:/tmp/catalog.json seed-imports/catalog.json
```

This export includes material and equipment libraries, Causes, synced products
and variants, cost templates and template lines, direct variant
material/equipment assignments, variant cost config basics, and product-Cause
assignments. Template rows are exported as source-keyed records and recreated
directly by the importer.

Export app-owned financial ledger data from a dev or production tenant when you
need to carry over non-snapshot records such as business expenses, Shopify charge
transactions already synced in another environment, disbursements, artist
payments, and tax true-ups:

```sh
APP_ENV_FILE=.env.production docker compose \
  --project-name count-on-us \
  --env-file .env.production \
  -f compose.production.yml \
  exec app npm run export:financial -- \
    --shop=source-store.myshopify.com \
    --since=2026-02-01 \
    --until=2026-06-05 \
    --out=/tmp/financial.json

APP_ENV_FILE=.env.production docker compose \
  --project-name count-on-us \
  --env-file .env.production \
  -f compose.production.yml \
  cp app:/tmp/financial.json seed-imports/financial.json
```

The financial export intentionally excludes order snapshots, snapshot lines,
line allocations, and materialized period allocations. Those should be recreated
by the financial backfill/reporting services against the target shop's current
Cause, material, and equipment configuration. Receipt file keys are exported as
references only; this command does not copy backing receipt files from object
storage.

Before importing into production, take a database backup:

```sh
bash scripts/backup-postgres.sh
```

## Production financial backfill

Use the financial backfill script for historical orders, payout/fee history, and
reporting period materialization. It queues a `financial.backfill` job for the
running app worker. The worker calls the same production services used by the
scheduled jobs: reconciliation creates order snapshots through the normal cost
engine, Shopify charge sync imports payout/fee transactions, and reporting
period closure materializes Cause and artist allocations from the target shop's
current configuration.

Without Shopify's `read_all_orders` scope, Shopify generally limits historical
order access to the most recent 60 days. Use the explicit date window that
matches the permissions available to the installed app.

Dry-run the queued payload:

```sh
APP_ENV_FILE=.env.production docker compose \
  --project-name count-on-us \
  --env-file .env.production \
  -f compose.production.yml \
  exec app npm run backfill:financial -- \
    --shop=target-store.myshopify.com \
    --since=2026-02-01 \
    --until=2026-06-05 \
    --dry-run
```

Queue the production backfill:

```sh
APP_ENV_FILE=.env.production docker compose \
  --project-name count-on-us \
  --env-file .env.production \
  -f compose.production.yml \
  exec app npm run backfill:financial -- \
    --shop=target-store.myshopify.com \
    --since=2026-02-01 \
    --until=2026-06-05
```

The `--until` date is exclusive. Watch the app logs after queueing the job:

```sh
APP_ENV_FILE=.env.production docker compose \
  --project-name count-on-us \
  --env-file .env.production \
  -f compose.production.yml \
  logs -f app
```

Pass `--no-close-periods` to import snapshots and charges without closing any
reporting periods. Pass `--create-monthly-periods` only when Shopify charge sync
does not create payout-backed reporting periods and you intentionally want
synthetic monthly periods for the backfill window.

For deliberate CSV migrations, use the authenticated admin **Imports & rebuild**
workflow. Historical order rows processed there use `createSnapshot()` and the
same cost engine as webhook orders.

## Rollback

Rollback is code-first, database-careful:

1. Check out the previous known-good commit.
2. Run `bash scripts/deploy-production.sh`.
3. Do not automatically reverse migrations.
4. If a migration caused the issue, choose between a forward fix and restoring from a verified backup.

For lower-risk releases, prefer additive/backward-compatible database migrations.
