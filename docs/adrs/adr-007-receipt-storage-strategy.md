# ADR-007: Receipt storage strategy for disbursements

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | April 2026 |
| **Depends on** | ADR-001, ADR-002 |

## Context

Phase 4 introduces disbursement logging with optional receipt uploads. These files may contain personal data or other sensitive financial information, even when merchants are warned to redact them before upload.

The storage approach must satisfy several constraints at once:

- support production-grade receipt storage with expiring access links
- support local development and repeatable testing without requiring a cloud account
- preserve the option to support merchant-preferred or platform-native storage later
- enforce a reasonable security baseline for files that may contain personal data
- fit the product's existing pattern of abstracting infrastructure concerns behind app-owned services

The current schema already includes `Disbursement.receiptFileKey`, but no storage provider has yet been selected or implemented.

## Decision

The app will use an application-owned receipt storage abstraction with three tiers of support:

1. **Primary production adapter:** S3-compatible object storage
2. **Local development adapter:** local filesystem storage
3. **Test adapter:** in-memory or fake storage

Shopify Files will **not** be the primary implementation. It remains a possible future adapter, but it is deferred until the app has a clear operational policy for uninstall-time cleanup and public-link semantics.

## Architecture

### Storage abstraction

Receipt handling will be implemented behind a small service interface owned by the app, rather than exposing provider-specific code directly in routes:

- `put`
- `getSignedReadUrl`
- `delete`

Optional later extensions:

- `replace`
- `exists`
- metadata helpers

All admin and storefront receipt workflows will call this abstraction rather than depending directly on a single cloud SDK.

### Supported adapters

#### 1. S3-compatible adapter

This is the default production adapter.

Reasons:

- broad provider portability through a shared API surface
- support for AWS S3, Cloudflare R2, Backblaze B2 S3 API, MinIO, DigitalOcean Spaces, and similar services
- strong ecosystem support for expiring signed URLs
- clean fit for receipt file keys already represented in the schema

Implementation expectations:

- expiring read URLs, default 1 hour
- TLS for transport
- encryption at rest enabled at the storage provider
- least-privilege credentials scoped to the receipt bucket/path

#### 2. Local filesystem adapter

This is the default local-development adapter.

Reasons:

- no cloud dependency for local testing
- easy manual inspection of uploaded files
- easier smoke testing than requiring a live object store

Local URLs do not need to mimic provider-native presigned URLs exactly. The app may serve short-lived local access links through an app route if needed for behavior parity.

This adapter is for local and non-production use only.

#### 3. Fake or in-memory adapter

This is the preferred test adapter.

Reasons:

- no filesystem or network I/O
- deterministic tests
- simple cleanup

## Deferred option: Shopify Files

Shopify Files is a plausible future adapter, but not the default and not required for Phase 4.

### Why it is attractive

- merchant/store-owned file location
- no separate cloud storage account required
- uses Shopify-admin-native file APIs

### Why it is deferred

- uninstall-time file ownership and cleanup are operationally unclear
- the app's `app/uninstalled` flow occurs after uninstall, which complicates any final cleanup API call strategy
- local development and test ergonomics are worse than local filesystem or fake storage
- signed/public access behavior is less directly under app control than with app-owned object storage

If a Shopify Files adapter is added later, it must explicitly document:

- who owns uploaded files after app uninstall
- what cleanup guarantees exist
- whether receipt access should be public, expiring, or app-mediated

## Security and GDPR posture

Receipt files must be treated as potentially sensitive because merchants may upload files containing names, addresses, transaction references, or other personal data.

The app will therefore adopt the following baseline:

- **Encryption in transit:** required in production
- **Encryption at rest:** required in production
- **Expiring access links:** required for non-public receipt access
- **Upload warning:** required, instructing merchants to redact personal information before upload
- **Retention and deletion support:** required in the storage adapter contract and data lifecycle planning

This aligns with the GDPR's risk-based security expectations under Article 32, which explicitly names encryption as an example of an appropriate technical measure where warranted by risk.

### Practical interpretation

- Production backends must support encrypted storage and HTTPS/TLS
- Local development storage does not need production-grade encryption, but must be clearly non-production
- Receipt access should default to short-lived URLs unless a later product requirement explicitly makes a receipt public

## Consequences

### Benefits

- production and local development needs are both covered cleanly
- storage provider choice remains flexible without rewriting route logic
- S3-compatible portability avoids lock-in to a single vendor
- security requirements are explicit up front instead of bolted on later

### Costs

- one additional abstraction layer to maintain
- Shopify Files integration is postponed instead of solved immediately
- local receipt access behavior may differ slightly from cloud-provider signed URL behavior

## Alternatives considered

**Use Shopify Files as the primary storage backend** - Deferred. Attractive from a merchant ownership perspective, but not chosen because uninstall cleanup and link semantics are operationally less clear, and local/test ergonomics are worse.

**Store receipt files directly in PostgreSQL** - Rejected. File blobs would bloat the database, complicate retention management, and are a poor fit for expiring-link workflows.

**Adopt a single provider-specific SDK with no abstraction** - Rejected. This would make local testing harder and reduce portability to other S3-compatible platforms.

**Use only local filesystem storage in all environments** - Rejected. This is not suitable for production durability, scale, or secure public/app-proxy access patterns.

## Operational notes

- Recommended configuration model:
  - `RECEIPT_STORAGE_DRIVER=s3|local|memory`
- S3-compatible deployments should additionally configure:
  - bucket
  - region
  - optional custom endpoint
  - access key / secret
  - path-style mode where required
- Local deployments should configure:
  - a dedicated local receipts directory

## Links

- Build Plan §4.6 (Disbursement logging)
- PRD §9.5 (Reporting and disbursement receipts)
- PRD §14.3 (Storage and retention considerations)
- GDPR Article 32 (security of processing)
- [ADR-001](adr-001-immutable-snapshot-architecture.md)
- [ADR-002](adr-002-dual-track-financial-model.md)
