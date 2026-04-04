# Internal API Contract — Shopify Donation Manager

Use this document as the intended contract for internal and extension-facing endpoints.

It is a design reference, not proof that every endpoint is already implemented. Check the current implementation status and the codebase before assuming an endpoint is live.

**Version:** 1.0  
**Date:** March 2026  
**Style:** REST  
**Base URL:** `https://{app-server}/api`

---

## Conventions

### Authentication

All endpoints fall into one of three authentication categories:

| Category | Mechanism | Used by |
| --- | --- | --- |
| **Admin** | Shopify session token (App Bridge JWT) — `Authorization: Bearer {session_token}` | Embedded admin app |
| **Extension** | Shopify session token from Checkout UI Extension `sessionToken` API | Thank You / Order Status extension |
| **Public** | App Proxy HMAC-SHA256 signature in query params (`signature=`) | Storefront widget lazy-load, App Proxy pages |
| **Shopify** | HMAC-SHA256 `X-Shopify-Hmac-Sha256` header | Inbound webhooks |

All admin endpoints extract `shopId` from the verified session token. `shopId` is never accepted as a client-supplied parameter — it is always derived server-side from the token. Any request where the token does not resolve to a valid shop is rejected with `401`.

### Request and response format

- All request and response bodies are `application/json`
- All monetary values are strings in `"0.00"` format — never floats
- All timestamps are ISO 8601 with timezone: `"2026-03-15T14:32:00Z"`
- All IDs are strings (Shopify IDs can be GID strings or large integers)
- Enum values are lowercase strings unless noted

### Error format

All errors use a consistent envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "fields": {
      "fieldName": "Field-specific error message"
    }
  }
}
```

`fields` is omitted when not applicable (e.g. auth errors, server errors).

| HTTP status | `error.code` | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Request body or params failed validation |
| 401 | `UNAUTHORIZED` | Missing or invalid session token |
| 403 | `FORBIDDEN` | Valid token but insufficient permission |
| 404 | `NOT_FOUND` | Resource does not exist for this shop |
| 409 | `CONFLICT` | State conflict (e.g. closing an already-closed period) |
| 422 | `UNPROCESSABLE` | Request valid but business rule prevents it |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `SERVER_ERROR` | Unexpected server error |

### Pagination

List endpoints use cursor-based pagination:

```json
{
  "data": [...],
  "pagination": {
    "cursor": "eyJpZCI6MTIzfQ==",
    "hasNextPage": true,
    "pageSize": 50
  }
}
```

Request next page with `?cursor={cursor}&pageSize={n}`. Default page size is 50. Maximum is 250.

### Soft-deleted records

Soft-deleted records (`status: "inactive"`) are excluded from list responses by default. Pass `?includeInactive=true` to include them.

---

## Surface areas

1. [Settings](#1-settings)
2. [Material Library](#2-material-library)
3. [Equipment Library](#3-equipment-library)
4. [Cost Templates](#4-cost-templates)
5. [Variant Cost Configuration](#5-variant-cost-configuration)
6. [POD Provider Connections](#6-pod-provider-connections)
7. [Causes](#7-causes)
8. [Product Cause Assignment](#8-product-cause-assignment)
9. [Reporting Periods](#9-reporting-periods)
10. [Business Expenses](#10-business-expenses)
11. [Disbursements](#11-disbursements)
12. [Tax True-Up](#12-tax-true-up)
13. [Order Snapshots](#13-order-snapshots)
14. [Recalculation](#14-recalculation)
15. [Storefront Widget](#15-storefront-widget)
16. [Post-Purchase Extension](#16-post-purchase-extension)
17. [App Proxy — Donation Receipts](#17-app-proxy--donation-receipts)
18. [Webhooks](#18-webhooks)

---

## 1. Settings

### `GET /api/settings`

Returns the current shop configuration.

**Auth:** Admin

**Response `200`:**
```json
{
  "data": {
    "shopifyPlanTier": "basic",
    "paymentProcessingRate": "2.90",
    "paymentProcessingFlatFee": "0.30",
    "managedMarketsEnableDate": "2025-06-01",
    "mistakeBufferPercentage": "5.00",
    "effectiveTaxRate": "25.00",
    "taxDeductionMode": "non_501c3_only",
    "postPurchaseEmailEnabled": true,
    "wizardCompleted": false
  }
}
```

---

### `PATCH /api/settings`

Updates one or more settings fields. Partial update — only supplied fields are changed.

**Auth:** Admin

**Request body:**
```json
{
  "paymentProcessingRate": "2.60",
  "mistakeBufferPercentage": "3.00",
  "effectiveTaxRate": "22.00",
  "taxDeductionMode": "all_causes",
  "postPurchaseEmailEnabled": false,
  "managedMarketsEnableDate": "2025-10-15"
}
```

**Validation:**
- `paymentProcessingRate`: NUMERIC string, 0.00–10.00
- `mistakeBufferPercentage`: NUMERIC string, 0.00–100.00
- `effectiveTaxRate`: NUMERIC string, 0.00–100.00
- `taxDeductionMode`: one of `dont_deduct` | `non_501c3_only` | `all_causes`
- `managedMarketsEnableDate`: ISO 8601 date string

**Response `200`:** Full settings object (same shape as GET)

---

## 2. Material Library

### `GET /api/materials`

**Auth:** Admin

**Query params:**
- `?includeInactive=true` — include soft-deleted items
- `?cursor=` / `?pageSize=`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "mat_01J...",
      "name": "A4 Sticker Paper",
      "type": "production",
      "costingModel": "yield",
      "purchasePrice": "24.99",
      "purchaseQuantity": "100.0000",
      "perUnitCost": "0.2499",
      "totalUsesPerUnit": null,
      "unitDescription": "sheets",
      "status": "active",
      "usedByTemplateCount": 3,
      "usedByVariantCount": 12,
      "notes": "",
      "createdAt": "2026-03-01T10:00:00Z",
      "updatedAt": "2026-03-01T10:00:00Z"
    }
  ],
  "pagination": { "cursor": null, "hasNextPage": false, "pageSize": 50 }
}
```

Note: `perUnitCost` is derived (`purchasePrice ÷ purchaseQuantity`) and returned for display — not stored.

---

### `POST /api/materials`

**Auth:** Admin

**Request body:**
```json
{
  "name": "Acrylic Sheet 3mm",
  "type": "production",
  "costingModel": "yield",
  "purchasePrice": "45.00",
  "purchaseQuantity": "10.0000",
  "unitDescription": "sheets",
  "totalUsesPerUnit": null,
  "notes": "A3 size, clear"
}
```

**Validation:**
- `name`: required, non-empty string, unique per shop
- `type`: required, one of `production` | `shipping`
- `costingModel`: required, one of `yield` | `uses`
- `purchasePrice`: required, NUMERIC string > 0
- `purchaseQuantity`: required, NUMERIC string > 0
- `totalUsesPerUnit`: required if `costingModel = uses`, must be > 0; must be null if `costingModel = yield`

**Response `201`:** Full material object

---

### `GET /api/materials/:id`

**Auth:** Admin

**Response `200`:** Full material object  
**Response `404`:** Material not found for this shop

---

### `PATCH /api/materials/:id`

**Auth:** Admin

Partial update. Same validation rules as POST for supplied fields.

**Response `200`:** Full updated material object

---

### `DELETE /api/materials/:id`

Soft-deletes the material (sets `status: "inactive"`). Hard delete is not supported.

**Auth:** Admin

**Response `200`:**
```json
{
  "data": {
    "id": "mat_01J...",
    "status": "inactive"
  }
}
```

**Response `422`:** If material is assigned to active templates or variant configs — returns list of affected template and variant names so merchant can clean up.

---

## 3. Equipment Library

### `GET /api/equipment`

**Auth:** Admin

**Query params:** `?includeInactive=true`, `?cursor=`, `?pageSize=`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "eq_01J...",
      "name": "Cricut Maker 3",
      "hourlyRate": "0.50",
      "perUseCost": null,
      "status": "active",
      "usedByTemplateCount": 2,
      "usedByVariantCount": 8,
      "notes": "",
      "createdAt": "2026-03-01T10:00:00Z",
      "updatedAt": "2026-03-01T10:00:00Z"
    }
  ],
  "pagination": { "cursor": null, "hasNextPage": false, "pageSize": 50 }
}
```

---

### `POST /api/equipment`

**Auth:** Admin

**Request body:**
```json
{
  "name": "Cricut Maker 3",
  "hourlyRate": "0.50",
  "perUseCost": null,
  "notes": ""
}
```

**Validation:**
- `name`: required, non-empty, unique per shop
- At least one of `hourlyRate` or `perUseCost` must be non-null and > 0

**Response `201`:** Full equipment object

---

### `GET /api/equipment/:id`

**Auth:** Admin  
**Response `200`:** Full equipment object

---

### `PATCH /api/equipment/:id`

**Auth:** Admin  
**Response `200`:** Full updated equipment object

---

### `DELETE /api/equipment/:id`

Soft-delete. Same `422` rule as materials — blocked if assigned to active templates or variants.

**Auth:** Admin  
**Response `200`:** `{ "data": { "id": "...", "status": "inactive" } }`

---

## 4. Cost Templates

### `GET /api/templates`

**Auth:** Admin

**Query params:** `?includeInactive=true`, `?cursor=`, `?pageSize=`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "tpl_01J...",
      "name": "Acrylic Earring — Standard",
      "status": "active",
      "usedByVariantCount": 24,
      "materialLines": [
        {
          "id": "tml_01J...",
          "materialId": "mat_01J...",
          "materialName": "Acrylic Sheet 3mm",
          "materialType": "production",
          "costingModel": "yield",
          "yield": "30.0000",
          "quantity": null,
          "usesPerVariant": null,
          "perUnitCost": "4.5000",
          "linePreviewCost": "0.1500"
        }
      ],
      "equipmentLines": [
        {
          "id": "tel_01J...",
          "equipmentId": "eq_01J...",
          "equipmentName": "Cricut Maker 3",
          "defaultMinutes": "2.00",
          "defaultUses": null,
          "linePreviewCost": "0.0167"
        }
      ],
      "createdAt": "2026-03-01T10:00:00Z",
      "updatedAt": "2026-03-01T10:00:00Z"
    }
  ],
  "pagination": { "cursor": null, "hasNextPage": false, "pageSize": 50 }
}
```

`linePreviewCost` is derived for display only. Shipping material lines follow the same shape as material lines with `materialType: "shipping"`.

---

### `POST /api/templates`

**Auth:** Admin

**Request body:**
```json
{
  "name": "Acrylic Earring — Standard",
  "materialLines": [
    {
      "materialId": "mat_01J...",
      "yield": "30.0000",
      "quantity": null,
      "usesPerVariant": null
    }
  ],
  "equipmentLines": [
    {
      "equipmentId": "eq_01J...",
      "defaultMinutes": "2.00",
      "defaultUses": null
    }
  ]
}
```

**Validation:**
- `name`: required, non-empty, unique per shop
- `materialLines[].materialId`: must exist and belong to this shop
- For yield-based materials: `yield` required and > 0; `quantity` and `usesPerVariant` must be null
- For uses-based materials: `usesPerVariant` required and > 0; `yield` and `quantity` must be null
- `equipmentLines[].equipmentId`: must exist and belong to this shop
- At least one of `defaultMinutes` or `defaultUses` required per equipment line; must match the equipment item's configured rate type

**Response `201`:** Full template object

---

### `GET /api/templates/:id`

**Auth:** Admin  
**Response `200`:** Full template object

---

### `PATCH /api/templates/:id`

**Auth:** Admin

Full replacement of `materialLines` and `equipmentLines` arrays (not partial line updates — send the complete new array). Template name and status are partial-updatable independently.

**Response `200`:** Full updated template object

---

### `DELETE /api/templates/:id`

Soft-delete. Blocked with `422` if template is assigned to active variant configs.

**Auth:** Admin  
**Response `200`:** `{ "data": { "id": "...", "status": "inactive" } }`

---

## 5. Variant Cost Configuration

### `GET /api/variants/costs`

Bulk read — returns cost configs for all variants of a product or a list of variant IDs.

**Auth:** Admin

**Query params:**
- `?productId={shopify_product_id}` — all variants for a product
- `?variantIds={id1},{id2}` — specific variants (max 250)

**Response `200`:**
```json
{
  "data": [
    {
      "variantId": "gid://shopify/ProductVariant/123",
      "productId": "gid://shopify/Product/456",
      "variantTitle": "Red / Small",
      "price": "28.00",
      "templateId": "tpl_01J...",
      "templateName": "Acrylic Earring — Standard",
      "laborMinutes": "15.00",
      "laborRate": "12.00",
      "materialOverrides": [
        {
          "materialId": "mat_01J...",
          "materialName": "Acrylic Sheet 3mm",
          "yield": "25.0000",
          "quantity": null,
          "usesPerVariant": null
        }
      ],
      "equipmentOverrides": [
        {
          "equipmentId": "eq_01J...",
          "equipmentName": "Cricut Maker 3",
          "minutes": "3.00",
          "uses": null
        }
      ],
      "lineItemCount": 4,
      "costPreview": {
        "laborCost": "3.00",
        "materialCost": "0.18",
        "equipmentCost": "0.025",
        "packagingCost": "0.15",
        "mistakeBuffer": "0.009",
        "totalCost": "3.364",
        "netContribution": "24.636"
      }
    }
  ]
}
```

`costPreview` calls `CostEngine` in preview mode. Included by default; omit with `?includePreview=false` for bulk operations where preview is unnecessary.

---

### `PUT /api/variants/costs/:variantId`

Create or replace the cost config for a single variant.

**Auth:** Admin

**Request body:**
```json
{
  "templateId": "tpl_01J...",
  "laborMinutes": "15.00",
  "laborRate": "12.00",
  "materialOverrides": [
    {
      "materialId": "mat_01J...",
      "yield": "25.0000",
      "quantity": null,
      "usesPerVariant": null
    }
  ],
  "equipmentOverrides": []
}
```

**Validation:**
- `templateId`: optional — if null, variant uses manual lines only
- `laborMinutes` and `laborRate`: both required, both > 0
- Override validation follows same rules as template line validation

**Response `200`:** Full variant cost config with `costPreview`

---

### `POST /api/variants/costs/bulk`

Assign a template to multiple variants in one operation.

**Auth:** Admin

**Request body:**
```json
{
  "templateId": "tpl_01J...",
  "variantIds": ["gid://shopify/ProductVariant/123", "gid://shopify/ProductVariant/456"],
  "laborMinutes": "15.00",
  "laborRate": "12.00",
  "overwriteExisting": false
}
```

**Validation:**
- `variantIds`: max 250 per request
- `overwriteExisting: false`: skips variants that already have a config — returns count of skipped in response
- `overwriteExisting: true`: replaces all existing configs for listed variants

**Response `200`:**
```json
{
  "data": {
    "updated": 18,
    "skipped": 2,
    "skippedVariantIds": ["gid://shopify/ProductVariant/456"]
  }
}
```

---

### `DELETE /api/variants/costs/:variantId`

Removes the cost config for a variant. Variant will show as unconfigured.

**Auth:** Admin  
**Response `200`:** `{ "data": { "variantId": "...", "removed": true } }`

---

## 6. POD Provider Connections

### `GET /api/providers`

**Auth:** Admin

**Response `200`:**
```json
{
  "data": [
    {
      "id": "pcon_01J...",
      "provider": "printful",
      "authType": "oauth",
      "status": "connected",
      "lastSyncedAt": "2026-03-15T06:00:00Z",
      "mappedVariantCount": 14,
      "unmappedVariantCount": 3
    }
  ]
}
```

---

### `POST /api/providers/printful/connect`

Initiates Printful OAuth flow. Returns the OAuth redirect URL for the client to navigate to.

**Auth:** Admin

**Response `200`:**
```json
{
  "data": {
    "authUrl": "https://www.printful.com/oauth/authorize?client_id=..."
  }
}
```

---

### `POST /api/providers/printify/connect`

Connects Printify via API key.

**Auth:** Admin

**Request body:**
```json
{
  "apiKey": "pk_live_..."
}
```

**Response `200`:**
```json
{
  "data": {
    "provider": "printify",
    "status": "connected",
    "shopName": "My Printify Shop"
  }
}
```

**Response `422`:** If API key is invalid or Printify returns an auth error.

---

### `DELETE /api/providers/:id`

Disconnects a provider. Clears stored credentials and marks all mappings as unmapped.

**Auth:** Admin  
**Response `200`:** `{ "data": { "id": "...", "status": "disconnected" } }`

---

### `GET /api/providers/:id/mappings`

**Auth:** Admin

**Query params:** `?status=mapped|unmapped|all`, `?cursor=`, `?pageSize=`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "pvm_01J...",
      "variantId": "gid://shopify/ProductVariant/123",
      "variantTitle": "Red / Small",
      "productTitle": "Acrylic Earring",
      "providerVariantId": "12345678",
      "matchMethod": "sku",
      "lastCostSyncedAt": "2026-03-15T06:00:00Z",
      "currentCost": "8.50",
      "currentShippingCost": "4.25"
    }
  ],
  "pagination": { "cursor": null, "hasNextPage": false, "pageSize": 50 }
}
```

---

### `PATCH /api/providers/:id/mappings/:mappingId`

Manually update a variant mapping.

**Auth:** Admin

**Request body:**
```json
{
  "providerVariantId": "12345678"
}
```

**Response `200`:** Full mapping object

---

### `POST /api/providers/:id/sync`

Triggers a manual cost sync for all mapped variants.

**Auth:** Admin

**Response `202`:**
```json
{
  "data": {
    "jobId": "sync_01J...",
    "status": "queued"
  }
}
```

---

## 7. Causes

Causes are stored as Shopify metaobjects. These endpoints proxy the metaobject API and maintain local cache where needed.

### `GET /api/causes`

**Auth:** Admin

**Query params:** `?includeInactive=true`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "gid://shopify/Metaobject/789",
      "name": "Ocean Conservancy",
      "legalNonprofitName": "Ocean Conservancy Inc.",
      "is501c3": true,
      "description": "Protecting the ocean...",
      "iconUrl": "https://cdn.shopify.com/...",
      "donationLink": "https://oceanconservancy.org/donate",
      "websiteUrl": "https://oceanconservancy.org",
      "instagramUrl": "https://instagram.com/oceanconservancy",
      "status": "active",
      "assignedProductCount": 4
    }
  ]
}
```

---

### `POST /api/causes`

**Auth:** Admin

**Request body:**
```json
{
  "name": "Ocean Conservancy",
  "legalNonprofitName": "Ocean Conservancy Inc.",
  "is501c3": true,
  "description": "Protecting the ocean and its wildlife.",
  "iconUrl": "https://cdn.shopify.com/...",
  "donationLink": "https://oceanconservancy.org/donate",
  "websiteUrl": "https://oceanconservancy.org",
  "instagramUrl": "https://instagram.com/oceanconservancy"
}
```

**Validation:**
- `name`: required, non-empty
- `is501c3`: required boolean
- `donationLink`: optional, valid URL if provided

**Response `201`:** Full cause object

---

### `GET /api/causes/:id`

**Auth:** Admin  
**Response `200`:** Full cause object

---

### `PATCH /api/causes/:id`

**Auth:** Admin  
**Response `200`:** Full updated cause object

---

### `DELETE /api/causes/:id`

Soft-deactivates the cause.

**Auth:** Admin

**Response `422`:** If cause is assigned to active products. Returns `affectedProducts` array with product IDs and titles. To resolve this blocker, remove the cause from each affected product's assignments via `PUT /api/products/:productId/causes` before retrying deactivation.

**Response `200`:** `{ "data": { "id": "...", "status": "inactive" } }`

---

## 8. Product Cause Assignment

Cause assignments are stored as Shopify product metafields. These endpoints read and write metafields via the Admin API.

### `GET /api/products/:productId/causes`

**Auth:** Admin

**Response `200`:**
```json
{
  "data": {
    "productId": "gid://shopify/Product/456",
    "productTitle": "Acrylic Earring",
    "totalDonationPercentage": "100.00",
    "assignments": [
      {
        "causeId": "gid://shopify/Metaobject/789",
        "causeName": "Ocean Conservancy",
        "is501c3": true,
        "percentage": "60.00"
      },
      {
        "causeId": "gid://shopify/Metaobject/790",
        "causeName": "Local Wildlife Trust",
        "is501c3": false,
        "percentage": "40.00"
      }
    ]
  }
}
```

---

### `PUT /api/products/:productId/causes`

Full replacement of all cause assignments for a product.

**Auth:** Admin

**Request body:**
```json
{
  "assignments": [
    {
      "causeId": "gid://shopify/Metaobject/789",
      "percentage": "60.00"
    },
    {
      "causeId": "gid://shopify/Metaobject/790",
      "percentage": "40.00"
    }
  ]
}
```

**Validation:**
- All `causeId` values must exist and be active for this shop
- Sum of percentages must not exceed 100.00
- Empty `assignments` array is valid — clears all assignments (product donates 0%)

**Response `200`:** Full cause assignment object

---

## 9. Reporting Periods

### `GET /api/periods`

**Auth:** Admin

**Query params:** `?status=open|closing|closed|all`, `?cursor=`, `?pageSize=`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "per_01J...",
      "status": "open",
      "startDate": "2026-03-01",
      "endDate": null,
      "payoutId": "pay_01J...",
      "totalNetContribution": "4821.50",
      "totalDonationPool": "3200.00",
      "totalCauseAllocations": [
        {
          "causeId": "gid://shopify/Metaobject/789",
          "causeName": "Ocean Conservancy",
          "allocated": "1920.00",
          "disbursed": "0.00"
        }
      ],
      "totalTaxReserve": "412.00",
      "totalShopifyCharges": "209.50",
      "orderCount": 142,
      "closedAt": null,
      "createdAt": "2026-03-01T00:00:00Z"
    }
  ],
  "pagination": { "cursor": null, "hasNextPage": false, "pageSize": 50 }
}
```

---

### `GET /api/periods/:id`

Returns full period detail including business expense summary and track 1/track 2 breakdown.

**Auth:** Admin

**Response `200`:**
```json
{
  "data": {
    "id": "per_01J...",
    "status": "open",
    "track1": {
      "cumulativeNetContribution": "4821.50",
      "donationPool": "3200.00",
      "shopifyCharges": "209.50",
      "taxReserve": "412.00",
      "causeAllocations": [...]
    },
    "track2": {
      "deductionPool": "1950.00",
      "cumulativeNetContribution": "4821.50",
      "taxableExposure": "2871.50",
      "widgetTaxSuppressed": false,
      "effectiveTaxRate": "25.00",
      "taxDeductionMode": "non_501c3_only",
      "businessExpenseTotal": "850.00",
      "501c3AllocationTotal": "1100.00"
    }
  }
}
```

---

### `POST /api/periods/:id/close`

Initiates period close. Materialises `CauseAllocation`, locks all related records.

**Auth:** Admin

**Response `200`:**
```json
{
  "data": {
    "id": "per_01J...",
    "status": "closed",
    "closedAt": "2026-03-31T23:59:00Z"
  }
}
```

**Response `409`:** If period is already closed.  
**Response `422`:** If period has undisbursed cause allocations and merchant has not confirmed they wish to proceed.

---

### `GET /api/periods/:id/export`

Returns a signed URL to download the period export (CSV or PDF).

**Auth:** Admin

**Query params:** `?format=csv|pdf`

**Response `200`:**
```json
{
  "data": {
    "downloadUrl": "https://s3.amazonaws.com/...",
    "expiresAt": "2026-03-31T14:00:00Z"
  }
}
```

---

## 10. Business Expenses

### `GET /api/periods/:periodId/expenses`

**Auth:** Admin

**Response `200`:**
```json
{
  "data": [
    {
      "id": "exp_01J...",
      "category": "inventory_materials",
      "subType": "material_purchase",
      "name": "A4 Sticker Paper (case of 500)",
      "amount": "24.99",
      "expenseDate": "2026-03-10",
      "notes": "Restock",
      "createdAt": "2026-03-10T12:00:00Z"
    }
  ],
  "summary": {
    "totalExpenses": "850.00",
    "taxReserveReduction": "212.50",
    "byCategory": {
      "inventory_materials": "450.00",
      "software_subscriptions": "89.00",
      "equipment_purchases": "311.00"
    }
  }
}
```

---

### `POST /api/periods/:periodId/expenses`

**Auth:** Admin

**Request body:**
```json
{
  "category": "inventory_materials",
  "subType": "material_purchase",
  "name": "A4 Sticker Paper (case of 500)",
  "amount": "24.99",
  "expenseDate": "2026-03-10",
  "notes": "Restock"
}
```

**Validation:**
- `category`: required, one of `inventory_materials` | `software_subscriptions` | `equipment_purchases` | `professional_services` | `bank_payment_fees` | `home_office` | `other`
- `subType`: required if `category = inventory_materials`, one of `material_purchase` | `cogs_adjustment`; must be null for all other categories
- `name`: required, non-empty
- `amount`: required, NUMERIC string > 0
- `expenseDate`: required, ISO 8601 date
- Period must be in `open` status — blocked with `422` if closed

**Response `201`:** Full expense object

---

### `PATCH /api/periods/:periodId/expenses/:id`

**Auth:** Admin  
**Response `200`:** Full updated expense object

---

### `DELETE /api/periods/:periodId/expenses/:id`

**Auth:** Admin

**Response `200`:** `{ "data": { "id": "...", "deleted": true } }`  
**Response `422`:** If period is closed

---

## 11. Disbursements

### `GET /api/periods/:periodId/disbursements`

**Auth:** Admin

**Response `200`:**
```json
{
  "data": [
    {
      "id": "dis_01J...",
      "causeId": "gid://shopify/Metaobject/789",
      "causeName": "Ocean Conservancy",
      "amount": "500.00",
      "paidAt": "2026-03-20",
      "paymentMethod": "wire_transfer",
      "referenceId": "TXN-98765",
      "receiptFileKey": "receipts/dis_01J.../receipt.pdf",
      "receiptPresignedUrl": "https://s3.amazonaws.com/...",
      "createdAt": "2026-03-20T14:00:00Z"
    }
  ]
}
```

---

### `POST /api/periods/:periodId/disbursements`

**Auth:** Admin

**Request body (`multipart/form-data`):**

| Field | Type | Required |
| --- | --- | --- |
| `causeId` | string | Yes |
| `amount` | string (NUMERIC) | Yes |
| `paidAt` | string (date) | Yes |
| `paymentMethod` | string | Yes |
| `referenceId` | string | No |
| `receipt` | file (image or PDF) | No |

**Validation:**
- `causeId`: must be assigned to this period
- `amount`: must be > 0 and ≤ remaining undisbursed amount for this cause
- `paymentMethod`: one of `check` | `wire_transfer` | `online_transfer` | `cash` | `other`
- `receipt`: max 10MB, accepted types: `image/jpeg`, `image/png`, `application/pdf`

**Response `201`:** Full disbursement object with presigned receipt URL if receipt uploaded.

---

### `DELETE /api/periods/:periodId/disbursements/:id`

**Auth:** Admin

**Response `200`:** `{ "data": { "id": "...", "deleted": true } }`  
**Response `422`:** If period is closed

---

### `POST /api/periods/:periodId/disbursements/:id/receipt`

Upload or replace a receipt for an existing disbursement.

**Auth:** Admin

**Request body (`multipart/form-data`):** `receipt` file

**Response `200`:** Updated disbursement with new presigned URL

---

## 12. Tax True-Up

### `GET /api/periods/:periodId/trueup`

**Auth:** Admin

**Response `200`:**
```json
{
  "data": {
    "periodId": "per_01J...",
    "estimatedTax": "412.00",
    "actualTax": null,
    "delta": null,
    "redistributionNotes": null,
    "filedAt": null,
    "createdAt": null
  }
}
```

Returns `null` fields if true-up not yet submitted.

---

### `POST /api/periods/:periodId/trueup`

**Auth:** Admin

**Request body:**
```json
{
  "actualTax": "388.00",
  "redistributionNotes": "Surplus of $24 added to Ocean Conservancy allocation.",
  "filedAt": "2026-04-15"
}
```

**Validation:**
- `actualTax`: required, NUMERIC string ≥ 0
- `filedAt`: required, ISO 8601 date, must not be in the future
- Period must be `closed`

**Response `201`:** Full true-up object with computed `delta`

---

## 13. Order Snapshots

### `GET /api/snapshots`

**Auth:** Admin

**Query params:**
- `?periodId=` — filter by period
- `?origin=webhook|reconciliation` — filter by origin
- `?flags=pod_cost_estimated,pod_cost_missing` — filter by snapshot flags
- `?cursor=`, `?pageSize=`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "snap_01J...",
      "shopifyOrderId": "gid://shopify/Order/999",
      "origin": "webhook",
      "periodId": "per_01J...",
      "flags": [],
      "totalNetContribution": "24.64",
      "totalDonationAmount": "24.64",
      "causeAllocations": [
        {
          "causeId": "gid://shopify/Metaobject/789",
          "causeName": "Ocean Conservancy",
          "amount": "14.78"
        }
      ],
      "createdAt": "2026-03-15T10:32:00Z"
    }
  ],
  "pagination": { "cursor": null, "hasNextPage": false, "pageSize": 50 }
}
```

---

### `GET /api/snapshots/:id`

Returns full snapshot detail including all child table line items.

**Auth:** Admin

**Response `200`:**
```json
{
  "data": {
    "id": "snap_01J...",
    "shopifyOrderId": "gid://shopify/Order/999",
    "origin": "webhook",
    "periodId": "per_01J...",
    "flags": [],
    "lines": [
      {
        "id": "snl_01J...",
        "variantId": "gid://shopify/ProductVariant/123",
        "variantTitle": "Red / Small",
        "quantity": 2,
        "price": "28.00",
        "laborCost": "6.00",
        "laborMinutes": "15.00",
        "laborRate": "12.00",
        "materialCost": "0.36",
        "equipmentCost": "0.05",
        "packagingCost": "0.30",
        "podCost": "0.00",
        "mistakeBufferPercentage": "5.00",
        "mistakeBufferAmount": "0.018",
        "taxableExposureAtOrderTime": "1200.50",
        "surplusAbsorbed": "0.00",
        "taxablePortion": "24.636",
        "estimatedTaxReserve": "6.159",
        "effectiveTaxRate": "25.00",
        "taxDeductionMode": "non_501c3_only",
        "taxableWeight": "0.4000",
        "netContribution": "18.477",
        "materialLines": [...],
        "equipmentLines": [...],
        "podLines": [...],
        "causeAllocations": [...]
      }
    ],
    "adjustments": [
      {
        "id": "adj_01J...",
        "type": "refund",
        "amount": "-9.238",
        "createdAt": "2026-03-16T09:00:00Z"
      }
    ],
    "createdAt": "2026-03-15T10:32:00Z"
  }
}
```

---

## 14. Recalculation

### `POST /api/recalculation`

Triggers an analytical recalculation run for a period. Async — returns a job ID.

**Auth:** Admin

**Request body:**
```json
{
  "periodId": "per_01J..."
}
```

**Response `202`:**
```json
{
  "data": {
    "jobId": "rcalc_01J...",
    "status": "queued",
    "periodId": "per_01J..."
  }
}
```

---

### `GET /api/recalculation/:jobId`

Poll for recalculation job status and results.

**Auth:** Admin

**Response `200`:**
```json
{
  "data": {
    "jobId": "rcalc_01J...",
    "status": "completed",
    "completedAt": "2026-03-15T11:00:00Z",
    "delta": {
      "totalNetContributionDelta": "12.50",
      "causeAllocationDeltas": [
        {
          "causeId": "gid://shopify/Metaobject/789",
          "snapshotAmount": "1920.00",
          "recalculatedAmount": "1932.50",
          "delta": "12.50"
        }
      ]
    }
  }
}
```

`status` values: `queued` | `running` | `completed` | `failed`

---

## 15. Storefront Widget

This endpoint is called by the Theme App Extension in lazy-load mode. It is also the source of data for the pre-load JSON block rendered server-side. Both paths use the same response shape.

### `GET /api/widget/products/:productId`

**Auth:** Public (App Proxy HMAC or session token from extension)

**Rate limiting:** 60 requests per minute per shop. Returns `429` with `Retry-After` header if exceeded.

**Response `200`:**
```json
{
  "data": {
    "productId": "gid://shopify/Product/456",
    "deliveryMode": "lazy",
    "variants": [
      {
        "variantId": "gid://shopify/ProductVariant/123",
        "price": "28.00",
        "currencyCode": "USD",
        "laborCost": "3.00",
        "materialLines": [
          {
            "name": "Acrylic Sheet 3mm",
            "type": "production",
            "lineCost": "0.18"
          }
        ],
        "equipmentLines": [
          {
            "name": "Cricut Maker 3",
            "lineCost": "0.025"
          }
        ],
        "shippingMaterialLines": [
          {
            "name": "Kraft Mailer",
            "lineCost": "0.15"
          }
        ],
        "podCostTotal": "0.00",
        "mistakeBufferAmount": "0.009",
        "shopifyFees": {
          "processingRate": "2.90",
          "processingFlatFee": "0.30",
          "managedMarketsRate": "3.50",
          "managedMarketsApplicable": false
        },
        "causes": [
          {
            "causeId": "gid://shopify/Metaobject/789",
            "name": "Ocean Conservancy",
            "iconUrl": "https://cdn.shopify.com/...",
            "donationPercentage": "60.00",
            "estimatedDonationAmount": "14.78",
            "donationCurrencyCode": "USD",
            "donationLink": "https://oceanconservancy.org/donate"
          }
        ],
        "taxReserve": {
          "suppressed": false,
          "estimatedRate": "25.00",
          "estimatedAmount": "3.08"
        }
      }
    ]
  }
}
```

**Security:** This response must never include `netContribution`, profit margins, `purchasePrice` of any material, or any other field not in the above schema. `CostEngine` display-safe projection is enforced server-side before this response is assembled.

**Staleness:**
- Material and equipment costs: live on each request
- POD costs: up to 24 hours stale (from `ProviderCostCache`)
- Tax suppression flag: up to 1 hour stale (from `TaxOffsetCache`)

---

## 16. Post-Purchase Extension

### `GET /api/orders/:orderId/donation`

Called by the Thank You page and Order Status page Checkout UI Extensions to retrieve donation summary for a completed order.

**Auth:** Extension (session token from `sessionToken` API in Checkout UI Extension)

**Rate limiting:** 10 requests per minute per order ID (polling guard).

**Response `200` — snapshot confirmed:**
```json
{
  "data": {
    "orderId": "gid://shopify/Order/999",
    "status": "confirmed",
    "totalDonated": "29.56",
    "currencyCode": "USD",
    "causes": [
      {
        "causeId": "gid://shopify/Metaobject/789",
        "name": "Ocean Conservancy",
        "iconUrl": "https://cdn.shopify.com/...",
        "amount": "17.74",
        "donationLink": "https://oceanconservancy.org/donate"
      }
    ]
  }
}
```

**Response `202` — snapshot not yet created:**
```json
{
  "data": {
    "orderId": "gid://shopify/Order/999",
    "status": "pending",
    "estimated": {
      "totalDonated": "28.00",
      "causes": [...]
    }
  }
}
```

The extension polls on `202` (up to 30 seconds at 3-second intervals). On `200`, the extension replaces estimated amounts with confirmed amounts. On timeout, it shows the estimated amounts with the "Estimated — we'll confirm this shortly" label.

**Response `404`:** Order ID not found or belongs to a different shop.

---

## 17. App Proxy — Donation Receipts

The App Proxy serves the public-facing donation receipts page at `/apps/donation-receipts`. All requests pass through Shopify's proxy and include HMAC-signed query parameters.

### `GET /apps/donation-receipts`

**Auth:** Public (App Proxy HMAC-SHA256 — `signature` query param, verified server-side)

**Note:** App Proxy strips all `Cookie` headers. Rate limiting is IP-based, not session-based.

**Query params (Shopify-appended):**
- `shop` — shop domain
- `path_prefix` — app proxy path prefix
- `timestamp` — Unix timestamp
- `signature` — HMAC-SHA256 of all other params
- `logged_in_customer_id` — customer ID if logged in, empty string if not

**Rate limiting:** 30 requests per minute per IP. Returns `429` with `Retry-After` header.

**Response:** Server-rendered HTML page. Not a JSON API endpoint.

**Page content:**
- Closed reporting periods in reverse chronological order
- Per-period: date range, total donated, cause breakdown
- Per-cause: disbursements with amount, date, payment method, and presigned receipt link (1hr expiry, refreshed on each page load)
- Empty state if no closed periods with disbursements
- WCAG 2.1 AA compliant markup

---

## 18. Webhooks

All webhook endpoints share the same base path `/webhooks`. The HMAC verification middleware runs before any handler.

### `POST /webhooks`

Receives all Shopify event webhooks. Verified via `X-Shopify-Hmac-Sha256` header (HMAC-SHA256 of raw request body using app secret). Returns `200` immediately; processing is async.

| `X-Shopify-Topic` | Handler | Notes |
| --- | --- | --- |
| `orders/create` | `SnapshotService` | Idempotent — no action if snapshot exists |
| `orders/updated` | `AdjustmentService` | Subtotal and line item changes only |
| `refunds/create` | `AdjustmentService` | Proportional negative adjustment |
| `products/update` | `CatalogSync` | |
| `variants/update` | `CatalogSync` | |
| `payouts/create` | `ChargeSyncService` + `ReportingPeriod` | Anchors new period |
| `app/uninstalled` | Deletion scheduler | Immediate metafield/metaobject delete; DB deletion in 48 hours |

**Response `200`:** Empty body — always, even if processing fails (Shopify retries on non-2xx)  
**Response `401`:** HMAC verification failed — logged and discarded

---

### `POST /webhooks/compliance`

Receives mandatory GDPR compliance webhooks. Separate route from event webhooks. Same HMAC verification.

| `X-Shopify-Topic` | Handler | SLA |
| --- | --- | --- |
| `customers/data_request` | Retrieve all `OrderSnapshot` records for customer's order IDs; provide to merchant | Within 30 days |
| `customers/redact` | Null `shopify_order_id` on relevant `OrderSnapshotLine` records; preserve financial totals | Within 30 days |
| `shop/redact` | Delete all merchant data and S3 files | Within 48 hours |

**Response `200`:** Always — processing is async

---

## Appendix A — Audit log

All financial mutations automatically create an `AuditLog` entry server-side. There is no API endpoint to write to the audit log directly. The following endpoints trigger audit log entries:

| Endpoint | Event logged |
| --- | --- |
| `PATCH /api/settings` | Settings change with before/after values |
| `POST/PATCH/DELETE /api/materials` | Material created, updated, or deactivated |
| `POST/PATCH/DELETE /api/equipment` | Equipment created, updated, or deactivated |
| `POST/PATCH/DELETE /api/templates` | Template created, updated, or deactivated |
| `PUT/DELETE /api/variants/costs/:id` | Variant config created, updated, or removed |
| `POST/PATCH/DELETE /api/causes` | Cause created, updated, or deactivated |
| `PUT /api/products/:id/causes` | Cause assignment changed |
| `POST /api/periods/:id/close` | Period closed |
| `POST/DELETE /api/periods/:id/expenses` | Expense added or deleted |
| `POST /api/periods/:id/disbursements` | Disbursement logged |
| `POST /api/periods/:id/trueup` | Tax true-up submitted |
| Webhook: `orders/create` | Snapshot created |
| Webhook: `refunds/create` | Adjustment created |

---

---

## Appendix C — Display-safe projection: excluded fields

The storefront widget endpoint (`GET /api/widget/products/:productId`) and `CostEngine` in preview mode must never return the following fields. This list is the authoritative reference for what is excluded from any customer-facing or public-facing response.

| Field | Reason for exclusion |
| --- | --- |
| `netContribution` | Reveals merchant profit margin after all costs |
| `purchasePrice` of any material | Reveals merchant's raw material cost |
| `purchaseQuantity` of any material | Reveals order volumes and supplier relationships |
| `perUnitCost` of any material | Derivable from purchase price/quantity — same risk |
| `laborRate` | Reveals merchant's effective hourly wage |
| `hourlyRate` of equipment | Reveals equipment cost basis |
| `perUseCost` of equipment | Reveals equipment cost basis |
| `totalNetContribution` (period or order level) | Reveals merchant profitability |
| `taxableExposureAtOrderTime` | Internal financial state |
| `surplusAbsorbed` | Internal tax calculation detail |
| `taxablePortion` | Internal tax calculation detail |
| Any `AuditLog` data | Internal operational record |

The widget payload shows only: labor cost total, per-material line cost (not purchase price), per-equipment line cost (not rate), shipping material line costs, POD cost total, Shopify fee rates, cause donation amounts, mistake buffer amount, and tax reserve display flag. All other cost structure data is admin-only.

| Endpoint group | Limit | Scope |
| --- | --- | --- |
| All admin endpoints | 300 requests/minute | Per shop |
| `GET /api/widget/products/:id` | 60 requests/minute | Per shop |
| `GET /api/orders/:id/donation` | 10 requests/minute | Per order ID |
| `GET /apps/donation-receipts` | 30 requests/minute | Per IP |

All rate-limited responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `Retry-After` headers.
