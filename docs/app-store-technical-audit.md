# App Store Technical Audit

This worksheet is the working artifact for Issue `#59`. It separates repo-backed evidence from the manual verification still required before submission.

Status legend:

- `Ready for manual verification` — implementation evidence exists in the repo, but a human still needs to verify the live behavior
- `Blocked` — a submission requirement is not fully represented yet
- `Pending` — needs review and evidence gathering

## Technical Audit Checklist

| Area | Status | Repo evidence | Manual verification still required |
| --- | --- | --- | --- |
| Built for Shopify / embedded admin posture | Ready for manual verification | Embedded app shell and Shopify App Bridge wrapper live in `app/routes/app.tsx` | Run an end-to-end embedded admin pass and verify current BFS expectations |
| GDPR webhook route exists | Ready for manual verification | `app/routes/webhooks.compliance.tsx` enqueues async handling and returns `200` immediately | Send all three compliance topics end to end from a dev store |
| GDPR compliance topics configured in app config | **Blocked** | `shopify.app.toml` and `shopify.app.phase3.toml` currently do **not** declare `compliance_topics` | Add config entries and verify Shopify accepts them |
| shop/redact deletion flow | Ready for manual verification | `app/jobs/processors.server.ts` handles `shop/redact` through the compliance worker and deletion job | Trigger the webhook from Shopify and verify 48-hour deletion scheduling works |
| Security headers on admin shell | Ready for manual verification | `app/routes/app.tsx` sets HSTS, `X-Content-Type-Options`, and `Referrer-Policy`; embedded CSP headers still come from Shopify/Remix boundary headers | Inspect live responses in browser dev tools and a security-header scanner |
| Public receipt/file safety headers | Ready for manual verification | `app/routes/dev.receipt-file.tsx` sends `X-Content-Type-Options: nosniff` and inline disposition | Verify behavior for uploaded files in a live environment |
| Install -> uninstall -> reinstall lifecycle | Ready for manual verification | `app/services/installService.server.ts` and deletion-job lifecycle exist | Run all three scenarios on a clean dev store and record results |
| Empty states on admin pages | Ready for manual verification | Empty-state behavior is present across Dashboard, Products, Audit Log, receipts page tests, and placeholder routes | Walk every admin route as a new merchant and record gaps |
| Error boundaries on major pages | Ready for manual verification | Error boundaries exist on Dashboard, Settings, Materials, Equipment, Templates, Variants, Causes, Products, Reporting, Expenses, Order History, and Audit Log routes | Trigger representative failures and confirm recoverable UI behavior |
| Theme compatibility testing | Pending | Theme app extension and cart app block are implemented | Test Dawn plus two additional OS2.0 themes and capture notes/screenshots |
| Checkout extensibility disclosure | Ready for manual verification | Listing draft includes OS2.0 and Checkout Extensibility disclosures in `docs/app-store-listing-draft.md` | Confirm final listing copy preserves the disclosure |
| Privacy policy URL | **Blocked** | No final URL is recorded yet | Publish/finalize the privacy policy URL |
| DPA availability | **Blocked** | No public request path is recorded yet | Define how merchants request or receive the DPA |
| OAuth scope minimization | Ready for manual verification | Active scopes are listed in `shopify.app.toml`; recent work moved post-purchase email to `contact_email` to avoid `read_customers` | Review final scope list against submission needs and justify each scope |
| GraphQL-only admin API posture | Ready for manual verification | Repo uses `admin.graphql(...)`; no known REST Admin usage remains | Spot-check remaining Shopify API touchpoints before submission |

## Immediate Blockers Found During Repo Audit

1. `compliance_topics` are not configured in the app TOML files even though the webhook route exists.
2. Privacy policy URL is not yet recorded in submission-facing docs.
3. DPA request path is not yet recorded in submission-facing docs.

## Evidence Links

- Embedded admin shell: `app/routes/app.tsx`
- Compliance webhook handler: `app/routes/webhooks.compliance.tsx`
- Compliance/deletion processing: `app/jobs/processors.server.ts`
- Install/reinstall handling: `app/services/installService.server.ts`
- Listing/disclosure draft: `docs/app-store-listing-draft.md`
- Security standard: `docs/standards/security.md`

## Audit Notes To Fill In Later

- Dev store used for verification:
- Theme compatibility stores/themes tested:
- Security header scanner results:
- GDPR webhook replay notes:
- Install/uninstall/reinstall evidence links:
- Empty-state gaps found:
- Error-boundary scenarios exercised:
