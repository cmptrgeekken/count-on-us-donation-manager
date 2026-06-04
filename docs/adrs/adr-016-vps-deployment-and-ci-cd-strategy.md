# ADR-016: Single-server Docker deployment and CI/CD strategy

- Status: Proposed
- Date: June 2026
- Depends on: ADR-001, ADR-004, ADR-007, ADR-010, ADR-012, ADR-015

## Context

Count On Us is moving from development/tunnel hosting toward an initial production deployment. The app is a Shopify Remix app with PostgreSQL persistence, Shopify webhooks, scheduled/background jobs through `pg-boss`, storefront extension assets, public app proxy endpoints, receipt storage, and a growing admin product surface.

The current repository has a basic Docker path:

- `Dockerfile` builds and runs the Remix app.
- `compose.yml` starts Postgres and the app.
- `npm run docker-start` runs Prisma setup and starts `remix-serve`.

This is a useful foundation, but it is not yet a production deployment design. The current Compose file exposes Postgres on a host port, does not include a reverse proxy or TLS termination, does not separate local and production settings, and does not define a backup/update process. The current Dockerfile also uses Node 18 while `package.json` requires Node 20.19+ or Node 22.12+, so production images should be brought back in line with the declared runtime contract.

The initial rollout goal is to minimize fixed monthly cost while preserving a clear path to scale later. VPS providers such as Hetzner and Hostinger are reasonable candidates because the app does not initially need managed Kubernetes, multi-region infrastructure, or high-volume autoscaling. As of May 2026, current provider pages show low-cost VPS options in the approximate single-digit to low-teens monthly range:

- Hetzner Cloud price-adjustment docs list shared cloud servers such as CX23, CX33, CPX22, and CPX32 with monthly caps after the April 2026 price change.
- Hostinger's VPS page lists KVM plans with 4 GB to 32 GB RAM, NVMe storage, bandwidth allowances, weekly backups, and full VPS control, with promotional prices that renew at higher monthly rates.

GitHub Actions is useful for CI and can also orchestrate deployment, but it does not replace a runtime host. For a private repository, Actions usage depends on included quota and paid overages; public repositories have free standard hosted runners. A CI/CD pipeline can reduce manual deployment mistakes, but it can also add secret handling, SSH, registry, and rollback complexity before the app has production traffic.

The short-term deployment target is a local Docker host running on a Proxmox server. That local server should be treated like a production-like single-server host, not like a trusted development machine. The app must be isolated from other containers, guests, and the local network as much as possible while still allowing outbound HTTPS access to Shopify and other configured external services such as object storage and email.

Docker remains useful even when GitHub Actions is introduced. Docker defines the runtime artifact and keeps the host environment small and repeatable. GitHub Actions should decide when and how that artifact is built, tested, and deployed; Docker should continue to define what actually runs.

## Decision

Count On Us will use a provider-neutral single-server Docker Compose deployment for the initial rollout. The first target may be a local Proxmox-hosted Docker VM; an external VPS remains a later drop-in hosting target.

The initial production-like topology will be:

- one dedicated Ubuntu LTS VM on Proxmox, or an equivalent Ubuntu VPS
- Docker Engine and Docker Compose plugin
- one app container
- one Postgres container with a persistent Docker volume
- one top-layer reverse proxy, preferably the existing Nginx Proxy Manager deployment; optional Caddy is available for hosts without an existing proxy
- S3-compatible object storage for receipt files
- off-server Postgres backups

The Docker host must be isolated from other local workloads. A dedicated VM is preferred over running this app directly on the Proxmox host or in a shared Docker host with unrelated containers. A VM boundary keeps Docker compromise from becoming Proxmox-host compromise and makes firewall policy easier to reason about.

The app will run as a single app instance during the initial rollout. This is intentional because the Remix server process starts the background job queue and scheduled jobs. Horizontal scaling is deferred until job execution is split from web serving or made explicitly singleton-safe.

GitHub Actions will be adopted in stages:

1. **CI first** - run install, type/build, tests, and Docker build validation on pull requests and main branch pushes.
2. **Manual deployment workflow second** - add a `workflow_dispatch` deployment that connects to the deployment host over SSH and runs the documented Docker Compose update procedure.
3. **Automatic deployment later** - optionally deploy automatically from `main` after the production runbook, backups, and rollback process have been proven.

The deployment workflow should use Docker, not replace it. The recommended low-cost path is to build on the target host during the first rollout, because it avoids paying for or maintaining a container registry and keeps the deployment mental model simple. If builds become slow or the host is resource-constrained, move to GitHub Actions building and pushing an image to GitHub Container Registry, then have the host pull that image.

During the first rollout, production app images are stored only in the local Docker image store on the deployment host. CI-built images are temporary validation artifacts on GitHub-hosted runners and are not published. A remote registry is deferred until immutable image promotion is worth the added setup.

## Host provider approach

The app should remain host-neutral. The implementation should assume a plain Ubuntu host with sudo SSH access, firewall control, and Docker support. That host can be a Proxmox VM, RackNerd VPS, Hetzner Cloud server, Hostinger VPS, or another comparable server.

Short-term Proxmox recommendation:

- create a dedicated Ubuntu VM for Count On Us
- do not run the app on the Proxmox host itself
- do not share the Docker host with unrelated local services
- place the VM on a DMZ or isolated VLAN when practical
- allow inbound traffic only for SSH from trusted admin addresses and HTTP/HTTPS from the public reverse proxy path
- deny VM access to RFC1918/private local networks except for explicitly required services
- allow outbound DNS, NTP, HTTP, and HTTPS only as needed for Shopify, object storage, email, package/image downloads, and certificate issuance
- use Proxmox firewall, the VM firewall, or upstream network rules for egress control because Docker Compose alone is not sufficient for reliable outbound network allow/deny policy

Initial provider recommendation:

- Choose the lowest-cost host that comfortably supports Docker, Postgres, the Remix app, build memory, and backups.
- Prefer at least 2 vCPU and 4 GB RAM for the first production server. A 1 vCPU / 4 GB server may work, but builds, migrations, and Postgres can contend for memory and CPU.
- If using Hostinger, account for promotional pricing versus renewal pricing before treating it as the cheapest long-term option.
- If using Hetzner, account for region, IPv4 cost/availability, backup/snapshot settings, and object storage pricing separately from server pricing.
- If using RackNerd, treat low-cost annual specials as compute only and verify renewal, transfer, backup, and datacenter terms before depending on them.

The ADR does not lock the app to Proxmox, Hostinger, Hetzner, or RackNerd. The app should be deployable to any isolated host that can run Docker Compose.

## Production deployment model

Production should use a separate Compose configuration from local development. The production configuration should:

- keep Postgres off public host ports
- expose the app only to the configured top-layer reverse proxy
- use separate Docker networks so the database is reachable only from the app and not from the reverse proxy or host LAN
- avoid `network_mode: host`, privileged containers, Docker socket mounts, and broad host bind mounts
- run containers as non-root users where the image supports it
- use `cap_drop: [ALL]` and add back only specifically required capabilities
- set `security_opt: ["no-new-privileges:true"]`
- use read-only filesystems for app/reverse-proxy containers where compatible, with explicit writable `tmpfs` or volumes for required paths
- set conservative memory and process limits where practical
- set `restart: unless-stopped` or equivalent policies
- mount named volumes for Postgres and, when using bundled Caddy, reverse proxy state
- load secrets from a production `.env` file that is not committed
- set `NODE_ENV=production`
- use a `DATABASE_URL` pointing at the internal `db:5432` service
- configure receipt storage with `RECEIPT_STORAGE_DRIVER=s3`

The production app image should use a Node version compatible with `package.json`. A multi-stage Dockerfile is preferred so build dependencies do not need to remain in the runtime image.

Prisma migrations should run during deployment before the new app serves traffic. For the initial single-server deployment, running `prisma migrate deploy` as part of `npm run docker-start` is acceptable. Before adding multiple app replicas, migration execution must be moved to a one-off release command or CI/CD deployment step.

Receipt storage should use S3-compatible object storage rather than local disk. Local receipt storage is acceptable for development and may work on a single host, but receipts are business records and should survive server replacement.

## Network isolation and hardening

The local Proxmox deployment must assume that container breakout, SSRF, dependency compromise, or app vulnerability could attempt lateral movement. The deployment should minimize what the app can reach.

Required host/network controls:

- run the Docker stack inside a dedicated VM
- block access from that VM to other Proxmox guests, Docker hosts, NAS services, management interfaces, printers, IoT devices, and private LAN ranges unless explicitly required
- permit outbound HTTPS to Shopify Admin/API/webhook-related endpoints, S3-compatible object storage, email provider APIs, certificate authorities, package/image registries during deploy, and security update mirrors
- permit DNS only to approved resolvers
- permit NTP only to approved time sources
- restrict SSH to trusted admin IPs or VPN
- keep Proxmox management UI unavailable from the Docker VM network
- log denied egress during the first rollout so missing legitimate dependencies can be identified deliberately

Required Compose/container controls:

- publish only the app target port needed by the top-layer reverse proxy, or only the bundled reverse proxy ports when using Caddy
- do not publish Postgres or app ports directly on the LAN
- attach Postgres only to a private backend network
- attach optional Caddy/reverse proxy only to the public frontend network and the app-facing network
- attach the app to the app-facing network and backend database network
- do not mount the Docker socket into app or reverse-proxy containers
- do not run containers with `privileged: true`
- do not grant host PID, IPC, or network namespaces
- keep secrets in environment files, Docker secrets, or the host secret store; never bake them into images
- prefer immutable image tags for production deployments once GitHub Actions image builds are adopted

Outbound allowlisting can be implemented at the Proxmox firewall, VM firewall, or upstream router/firewall layer. Docker network definitions are necessary for container-to-container isolation, but they are not a complete egress security boundary for protecting the rest of the local network.

## CI/CD approach

GitHub Actions should be used for quality gates immediately and deployment automation gradually.

The initial CI workflow should run on pull requests and pushes to `main`:

- `npm ci`
- `npm run build`
- `npm test`
- Docker image build validation

The first deployment workflow should be manual, not automatic. It should:

- require explicit `workflow_dispatch`
- use GitHub Environments for production approval if available
- SSH to the deployment host using a deploy key stored in GitHub Secrets
- pull the selected branch or tag on the deployment host
- run `docker compose -f compose.yml -f compose.production.yml build app`
- run `docker compose -f compose.yml -f compose.production.yml up -d --no-deps app`
- show recent app logs

This keeps operating cost low because it avoids a paid platform and avoids a registry at first. It also limits blast radius while production behavior is still being learned.

Later, if deployments need to be faster or more reproducible, switch to image-based deployment:

- GitHub Actions builds the app image.
- GitHub Actions pushes it to GitHub Container Registry.
- The deployment host pulls the immutable image tag.
- Compose references the image tag instead of building from source on the deployment host.

Automatic deployment from `main` should be deferred until rollback, backups, and smoke tests are routine.

## Deployment and update process

Initial deployment:

1. Provision a dedicated Ubuntu LTS VM on Proxmox, or an equivalent VPS.
2. Place the VM on an isolated network or VLAN where practical.
3. Configure SSH keys, firewall, automatic security updates, and a non-root deploy user.
4. Configure inbound and outbound firewall rules before starting the stack.
5. Install Docker Engine and the Docker Compose plugin.
6. Point the production DNS record to the public ingress path for the host.
7. Create the production `.env` file on the host.
8. Start the production stack with Docker Compose.
9. Confirm Nginx Proxy Manager or optional Caddy routes HTTPS to the app.
10. Run Prisma migrations.
11. Configure Shopify app URLs, OAuth redirects, webhooks, and app proxy URLs for the production domain.
12. Run `npm run deploy` from a Shopify CLI-authenticated environment when Shopify config or extensions change.
13. Install or re-auth the app on the target Shopify store.
14. Smoke-test embedded admin, webhooks, app proxy widget data, receipt storage, background jobs, and denied local-network egress.

Manual update process:

1. SSH to the deployment host.
2. Pull the target commit.
3. Build the app image.
4. Recreate only the app container.
5. Confirm migrations completed.
6. Check logs.
7. Smoke-test the Shopify admin and public endpoints.

CI/CD-assisted update process:

1. Merge to `main`.
2. Confirm CI passes.
3. Run the manual production deployment workflow from GitHub Actions.
4. Confirm deployment logs and smoke tests.
5. Promote to automatic deploy only after the manual workflow is reliable.

Rollback process:

- keep the previous Git commit or image tag available
- redeploy the previous version
- do not automatically roll back database migrations
- if a migration is not backward-compatible, require an explicit restore or forward-fix plan

## Scaling path

The first scale step is vertical: resize the VM or move to a larger VPS plan.

The second scale step is separation of concerns:

- move Postgres to a managed database or a dedicated database server
- keep receipt files in object storage
- split background workers from the web container
- make scheduled jobs singleton-safe
- move from source-on-server builds to registry-based immutable images
- move from local Proxmox hosting to an external VPS or managed platform if public availability, bandwidth, or home-network constraints become limiting

The third scale step is horizontal:

- run multiple web containers behind the reverse proxy or a load balancer
- run a separate worker process with controlled concurrency
- move deployment from single-server Compose to a small orchestrated platform only when operational need justifies the cost

## Consequences

### Benefits

- keeps initial monthly cost low
- avoids premature platform complexity
- supports a short-term local Proxmox rollout without changing the app architecture
- keeps the app portable across Proxmox, Hetzner, Hostinger, RackNerd, and similar hosts
- preserves a straightforward path to CI/CD
- uses Docker as a stable runtime contract while allowing GitHub Actions to automate checks and deployment
- keeps receipt files off the deployment host from the start
- explicitly limits lateral movement into the rest of the local network

### Costs

- requires host administration, patching, firewall setup, monitoring, and backups
- local hosting requires careful network isolation to avoid exposing other home/lab services
- local hosting may depend on residential ISP, router, dynamic DNS, NAT, or reverse-proxy constraints
- does not provide managed database failover
- deploys are initially single-server and not zero-downtime
- horizontal scaling requires later job/web separation
- GitHub Actions deployment adds SSH secret management and production environment controls

## Alternatives considered

**Manual SSH deployment without GitHub Actions** - Acceptable for the first one or two deployments, but not the desired steady state. It is cheap and simple, but easy to do inconsistently.

**GitHub Actions instead of Docker** - Rejected. Actions can build, test, and orchestrate deployment, but the app still needs a runtime host and a repeatable runtime artifact. Docker remains the deployment unit.

**GitHub Actions plus Docker from day one** - Accepted in stages. CI should come first, manual deployment automation second, and automatic deployment later.

**Managed PaaS such as Fly.io, Render, Railway, or Heroku** - Deferred. These reduce server administration but usually increase monthly cost once Postgres, workers, storage, and production reliability are included.

**Managed database from day one** - Deferred for cost. It is a strong future move, especially before meaningful merchant volume, but the initial rollout can use a local Postgres volume if backups are treated as mandatory.

**All-local host storage, including receipts** - Rejected as the preferred production path. It is cheapest, but receipt files should survive host replacement and should not depend on a single disk.

**Run the app directly on the Proxmox host** - Rejected. This would make Docker compromise more likely to become host compromise and would complicate firewall boundaries around other guests and local services.

**Run the app on a shared Docker host with unrelated containers** - Rejected for the first production-like rollout. A dedicated VM provides a clearer blast-radius boundary and simpler network policy.

**Kubernetes or Docker Swarm** - Rejected for initial rollout. The app does not yet need cluster orchestration, and operational complexity would work against the cost-minimization goal.

## References

- Docker Docs: "Use Compose in production"
- GitHub Docs: "GitHub Actions billing"
- Hetzner Docs: "Price adjustment for cloud products"
- Hostinger VPS hosting plan page
