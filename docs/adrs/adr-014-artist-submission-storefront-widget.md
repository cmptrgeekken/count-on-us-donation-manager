# ADR-014: Artist submission storefront widget

- Status: Proposed
- Date: May 2026
- Depends on: ADR-004, ADR-012, ADR-013

## Context

ADR-013 defines artist collaboration records, product attribution, artist-selected Cause routing, artist payouts, and privacy boundaries. It intentionally leaves public artist intake out of the first collaboration implementation so merchants can collect interest through external forms, Shopify-native forms, email, or manual workflows.

Sparkly Rocketship needs a more direct intake path that can be embedded in the online store as a customer-facing artist collaboration signup form. The form should let artists submit contact details, public credit preferences, collaboration ideas, preferred product formats, Cause interests, artist share preferences, proof approval preferences, and acknowledgement of collaboration terms.

The form may also need artwork uploads. Shopify-native contact forms and basic Shopify Forms workflows are not a reliable architectural foundation for file uploads, structured validation, malware scanning, staging records, or direct integration with the app's artist collaboration model. A Shopify-native form remains useful as a fallback for merchants who only need a short interest form and can collect artwork through links.

## Decision

The app will provide an artist submission storefront widget that can be added to the online store through a Shopify Theme App Extension app block or app embed.

The widget will submit to an app-owned endpoint, not to Shopify's native contact form endpoint. The endpoint may be exposed through the app server or a Shopify app proxy, depending on deployment constraints. The widget must work inside Shopify's theme extension sandbox and use scoped styling.

### Submission records are staged before artist creation

Artist submissions will be stored as shop-scoped intake records separate from active Artist records.

Each intake record should include:

- public credit name
- email, required for durable follow-up and payment/legal coordination
- preferred communication method and method-specific contact detail when the preferred method is not email
- public/work sample links, such as Instagram, website, portfolio, Etsy, Linktree, Google Drive, Dropbox, or similar
- local connection selection
- artwork or collaboration idea
- interested product formats
- product format restrictions
- sales channel restrictions
- Cause support preference, including whether the artist has specific causes in mind, wants Sparkly Rocketship to choose aligned causes, or wants to discuss later
- Cause links, such as organization websites, donation pages, mutual aid funds, or cause information pages
- Cause notes
- artist share preference
- proof approval preference
- uploaded file metadata
- optional notes
- collaboration terms acknowledgement timestamp
- optional payment acknowledgement timestamp
- submission status, such as new, reviewing, contacted, converted, declined, spam, or archived
- internal review notes

Admins may convert a submission into a draft Artist record. Conversion should copy only operationally relevant artist fields into the Artist model and preserve the original submission as intake history. Conversion must not automatically create product assignments, Cause assignments, payout obligations, or public product attribution.

### The full form is the default template

The default Sparkly Rocketship template should include these fields:

- Public credit name, required
- Email, required
- Preferred communication method, required dropdown
- Method-specific contact detail, required when the preferred method is not email
- Instagram / website / portfolio, optional repeatable validated links
- Are you based in Minnesota or the Twin Cities?, optional dropdown
- Tell us about your artwork or idea, required long text
- What product formats interest you?, optional checkboxes
- Are there any product formats you do not want your design used for?, optional long text
- Are there any sales channels you do not want your design sold through?, optional long text
- Cause support preference, optional dropdown
- Cause, nonprofit, or donation links, optional repeatable validated links
- Cause notes, optional long text
- Artist share preference, optional dropdown
- Do you want to approve final product proofs before launch?, optional dropdown
- Artwork/sample file upload, optional when uploads are enabled
- Anything else we should know?, optional long text
- Collaboration terms acknowledgement, required checkbox
- Payment acknowledgement, optional checkbox or conditional acknowledgement when payment is selected

The widget may also offer a minimal template for merchants who want less friction:

- Public credit name
- Email
- Preferred communication method
- Instagram / website / portfolio
- Tell us about your artwork or idea
- Product formats that interest you
- Cause support preference
- Cause, nonprofit, or donation links
- Cause notes
- Artist share preference
- Terms acknowledgement

### Option values are merchant-configurable with Sparkly defaults

The Sparkly Rocketship defaults are:

Local connection:

- Twin Cities
- Elsewhere in Minnesota
- Minnesota connection, but not currently local
- Outside Minnesota
- Prefer not to say

Product formats:

- Full-color stickers
- Buttons
- Laser-cut acrylic earrings
- Laser-cut acrylic pins
- Single-tone silhouette acrylic designs
- Two-tone acrylic designs
- Full-color sublimated earrings or pins
- Future formats like magnets, keychains, shirts, or bags
- Not sure yet

Artist share preference:

- Donate my artist share to my selected cause
- Receive artist payment
- Not sure yet / discuss later

Proof approval preference:

- Yes, I want to approve proofs before launch
- No, Sparkly Rocketship can handle production adaptation
- Not sure yet / discuss later

Merchants may edit labels, helper text, requiredness for non-core fields, option values, intro copy, privacy note, and acknowledgement text. Name, email, idea text, and collaboration terms acknowledgement remain required for the default full template.

### Terms and privacy copy are explicit

The default form intro should say:

```text
Interested in collaborating with Sparkly Rocketship? Use this form to tell us a little about yourself, your artwork, and the kinds of products or causes you're interested in.

Submitting this form does not commit you to a collaboration or automatically grant product rights. If we move forward, final details will be confirmed before launch.
```

The required acknowledgement should say:

```text
I have reviewed the Collaboration Terms & Conditions and understand that submitting this form does not commit me to a collaboration or automatically grant product rights. Final details will be confirmed before launch.
```

The optional payment acknowledgement should say:

```text
I understand that if I choose to receive artist payments, Sparkly Rocketship may require a completed Form W-9 before issuing payment.
```

The default privacy note should say:

```text
We will use your information only to review and follow up on possible Sparkly Rocketship collaborations. We will not publish your legal name, contact information, or private submission details without permission.
```

The app should store the text/version of any acknowledgement accepted at submission time, or a reference to an immutable terms version, so later copy edits do not blur what the artist accepted.

### File uploads use controlled app storage

When uploads are enabled, files must be uploaded to app-controlled storage through a constrained upload flow.

Upload handling must include:

- per-shop configuration for whether uploads are enabled
- allowed MIME types and file extensions, initially limited to common image and PDF formats
- maximum file size and maximum file count per submission
- server-side validation of uploaded content
- malware scanning or quarantine before admin download
- non-public object storage by default
- signed, time-limited admin access URLs
- retention settings and deletion support
- metadata stored in the intake record rather than raw file bytes stored in the database

The storefront widget must not expose long-lived public file URLs. Public product assets, if any, are created later through an explicit admin workflow and are separate from intake uploads.

If uploads are disabled or unavailable, the form should rely on the Instagram / website / portfolio repeatable link field for sample artwork links and helper text asking artists to use a portfolio, Google Drive, Dropbox, or similar link with sharing permissions enabled.

### Submissions are not legal grants or payment records

Submitting the form does not:

- create an active Artist record
- assign Causes
- create artist payout eligibility
- grant product rights
- approve artwork for production
- publish the artist's name or work
- create a payment obligation

Payment/tax identifiers, completed W-9 documents, bank details, or other sensitive payout documents must not be collected through the public storefront form. Payment follow-up remains an admin-side process as defined in ADR-013.

### Abuse controls are required

The widget and submission endpoint must include anti-abuse controls before public release:

- bot protection or challenge support compatible with Shopify storefronts
- server-side rate limiting per shop, IP, and email
- honeypot or similar low-friction spam signal
- content length limits
- upload count and size limits
- duplicate submission detection
- admin controls to mark spam and archive submissions

These controls are especially important when file uploads are enabled.

### Notifications and admin review are part of the workflow

New submissions should appear in an admin review queue. Merchants may configure notification email recipients or in-app notifications.

The review queue should support:

- filtering by status
- viewing submitted field values
- viewing safe file metadata and scan status
- opening signed file download links after scan approval
- adding internal notes
- converting to a draft Artist record
- declining, archiving, or marking spam

## Consequences

### Benefits

- gives Sparkly Rocketship a first-party artist collaboration intake path on the storefront
- avoids forcing artists into email-only or external-form workflows
- supports artwork uploads without depending on Shopify-native contact form limitations
- keeps intake data separate from active collaboration, payout, and public attribution records
- preserves ADR-012 privacy boundaries and ADR-013 payment/tax separation
- gives merchants a short-form fallback when uploads or full intake are too much friction

### Costs

- introduces public submission endpoints that need spam, rate limit, and upload protections
- requires object storage, scanning/quarantine, retention, and signed download infrastructure if uploads are enabled
- adds admin review queue and conversion workflow scope
- requires merchant-facing configuration for form copy, fields, options, and notifications
- creates more private data to retain and delete responsibly

## Alternatives considered

**Use Shopify-native contact forms only** - Rejected as the primary architecture. Native contact forms are useful for simple interest capture, but they do not reliably support controlled file uploads, malware scanning, staged records, or direct conversion into app-owned artist intake workflows.

**Require artwork links instead of uploads** - Rejected as the only supported model. Links are the safest fallback and should remain available, but an artist collaboration program may reasonably need direct sample uploads.

**Create Artist records immediately on submission** - Rejected. Public submissions are unreviewed and may be spam, incomplete, or inappropriate. Staging submissions separately avoids polluting the operational artist model and protects public attribution workflows.

**Collect W-9 or payment details in the public form** - Rejected. Payment/tax follow-up is sensitive and belongs in an admin-controlled process outside the public storefront intake path.

**Make all fields required** - Rejected. The form should collect enough information to evaluate fit, but artists should not be forced to provide every restriction, sales channel preference, Cause, or proofing preference before an initial conversation.

## Follow-up implications

- Add schema models for ArtistSubmission and ArtistSubmissionFile.
- Add admin screens for artist submission review, status changes, notes, and conversion to draft Artist records.
- Add storefront widget/app block configuration for full vs minimal templates, copy, option values, upload enablement, and notifications.
- Add upload storage, scanning/quarantine, signed URL access, retention, and deletion behavior.
- Add app-owned submission endpoint or app proxy route with rate limiting and bot protection.
- Update ADR-013 follow-up planning to account for the public intake widget as the preferred first-party intake path.
- Update privacy documentation and merchant setup docs before enabling uploads.

## Links

- [ADR-004](adr-004-storefront-widget-data-delivery.md)
- [ADR-012](adr-012-public-financial-disclosure-boundaries.md)
- [ADR-013](adr-013-artist-collaboration-product-attribution-and-payouts.md)
