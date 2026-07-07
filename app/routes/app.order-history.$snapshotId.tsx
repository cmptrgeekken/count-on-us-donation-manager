import { jsonResponse } from "~/utils/json-response.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { HelpText } from "../components/HelpText";
import { prisma } from "../db.server";
import { createManualAdjustment } from "../services/adjustmentService.server";
import { saveOrderArtistAttribution } from "../services/orderArtistAttribution.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { shopifyAdminOrderUrl, shopifyAdminVariantUrl } from "../utils/shopify-admin-url";
import { useAppLocalization } from "../utils/use-app-localization";

const decimalField = z
  .string()
  .trim()
  .optional()
  .transform((value) => value ?? "")
  .refine((value) => value === "" || !Number.isNaN(Number(value)), "Adjustments must be valid decimal values.");

const manualAdjustmentSchema = z.object({
  snapshotLineId: z.string().trim().min(1, "Snapshot line is required."),
  reason: z.string().trim().optional(),
  laborAdj: decimalField,
  materialAdj: decimalField,
  packagingAdj: decimalField,
  equipmentAdj: decimalField,
});

const artistAttributionSchema = z.object({
  artistId: z.string().trim(),
  notes: z.string().trim().max(500, "Notes must be 500 characters or fewer.").optional(),
  persistCustomerAssociation: z.enum(["on"]).optional(),
});

function sumDecimals(values: Array<Prisma.Decimal | null | undefined>, zero: Prisma.Decimal) {
  return values.reduce<Prisma.Decimal>((sum, value) => sum.add(value ?? zero), zero);
}

function moneyNumber(value: string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const snapshotId = params.snapshotId ?? "";
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent !== "create-manual-adjustment" && intent !== "save-artist-attribution") {
    return jsonResponse({ ok: false, message: "Unknown action." }, { status: 400 });
  }

  const snapshot = await prisma.orderSnapshot.findFirst({
    where: { id: snapshotId, shopId },
    select: { id: true },
  });

  if (!snapshot) {
    return jsonResponse({ ok: false, message: "Snapshot not found." }, { status: 404 });
  }

  if (intent === "save-artist-attribution") {
    const parsed = artistAttributionSchema.safeParse({
      artistId: formData.get("artistId")?.toString() ?? "",
      notes: formData.get("notes")?.toString() ?? "",
      persistCustomerAssociation: formData.get("persistCustomerAssociation")?.toString(),
    });

    if (!parsed.success) {
      return jsonResponse(
        { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid artist attribution." },
        { status: 400 },
      );
    }

    try {
      await saveOrderArtistAttribution(
        {
          shopId,
          snapshotId,
          artistId: parsed.data.artistId || null,
          notes: parsed.data.notes,
          persistCustomerAssociation: parsed.data.persistCustomerAssociation === "on",
        },
        prisma,
      );
    } catch (error) {
      return jsonResponse(
        { ok: false, message: error instanceof Error ? error.message : "Unable to save artist association." },
        { status: 400 },
      );
    }

    return jsonResponse({ ok: true, message: parsed.data.artistId ? "Artist association saved." : "Artist association removed." });
  }

  const parsed = manualAdjustmentSchema.safeParse({
    snapshotLineId: formData.get("snapshotLineId")?.toString() ?? "",
    reason: formData.get("reason")?.toString() ?? "",
    laborAdj: formData.get("laborAdj")?.toString() ?? "",
    materialAdj: formData.get("materialAdj")?.toString() ?? "",
    packagingAdj: formData.get("packagingAdj")?.toString() ?? "",
    equipmentAdj: formData.get("equipmentAdj")?.toString() ?? "",
  });

  if (!parsed.success) {
    return jsonResponse(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid manual adjustment." },
      { status: 400 },
    );
  }

  const snapshotLine = await prisma.orderSnapshotLine.findFirst({
    where: {
      id: parsed.data.snapshotLineId,
      snapshotId,
      shopId,
    },
    select: { id: true },
  });

  if (!snapshotLine) {
    return jsonResponse({ ok: false, message: "Snapshot line not found for this order." }, { status: 404 });
  }

  await createManualAdjustment(
    shopId,
    {
      snapshotLineId: parsed.data.snapshotLineId,
      reason: parsed.data.reason,
      laborAdj: parsed.data.laborAdj,
      materialAdj: parsed.data.materialAdj,
      packagingAdj: parsed.data.packagingAdj,
      equipmentAdj: parsed.data.equipmentAdj,
    },
    prisma,
  );

  return jsonResponse({ ok: true, message: "Manual adjustment created." });
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const snapshotId = params.snapshotId ?? "";

  const snapshot = await prisma.orderSnapshot.findFirst({
    where: { id: snapshotId, shopId },
    include: {
      packageAllocations: {
        orderBy: { createdAt: "asc" },
      },
      artistAttribution: {
        include: {
          artist: {
            select: {
              displayName: true,
              creditName: true,
            },
          },
        },
      },
      packagingReviewItems: {
        orderBy: { createdAt: "desc" },
      },
      lines: {
        orderBy: { productTitle: "asc" },
        include: {
          materialLines: true,
          equipmentLines: true,
          podLines: true,
          causeAllocations: true,
          adjustments: {
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!snapshot) {
    throw new Response("Not Found", { status: 404 });
  }

  return jsonResponse({
    snapshot: {
      id: snapshot.id,
      orderNumber: snapshot.orderNumber ?? "Unnumbered order",
      customerDisplayName: snapshot.customerDisplayName ?? null,
      shopifyAdminUrl: shopifyAdminOrderUrl(shopId, snapshot.shopifyOrderId),
      origin: snapshot.origin,
      createdAt: snapshot.createdAt.toISOString(),
      subtotalAmount: snapshot.subtotalAmount.toString(),
      discountAmount: snapshot.discountAmount.toString(),
      shippingAmount: snapshot.shippingAmount.toString(),
      salesTaxCollected: snapshot.salesTaxCollected.toString(),
      totalAmount: snapshot.totalAmount.toString(),
      canPersistCustomerAssociation: Boolean(snapshot.shopifyCustomerId || snapshot.normalizedCustomerEmailHash),
      artistAttribution: snapshot.artistAttribution
        ? {
            artistId: snapshot.artistAttribution.artistId,
            artistName: snapshot.artistAttribution.artist.displayName,
            creditName: snapshot.artistAttribution.artist.creditName,
            source: snapshot.artistAttribution.source,
            notes: snapshot.artistAttribution.notes ?? "",
          }
        : null,
      packageAllocations: snapshot.packageAllocations.map((allocation) => ({
        id: allocation.id,
        packageName: allocation.packageName,
        quantity: allocation.quantity,
        materialCost: allocation.materialCost.toString(),
        source: allocation.source,
        confidence: allocation.confidence,
        reason: allocation.reason ?? "",
      })),
      packagingReviewItems: snapshot.packagingReviewItems.map((item) => ({
        id: item.id,
        status: item.status,
        reason: item.reason,
        severity: item.severity,
        createdAt: item.createdAt.toISOString(),
      })),
      lines: snapshot.lines.map((line) => {
        const zero = line.laborCost.mul(0);
        const effectiveLaborCost = line.laborCost.add(
          sumDecimals(line.adjustments.map((adjustment) => adjustment.laborAdj), zero),
        );
        const effectiveMaterialCost = line.materialCost.add(
          sumDecimals(line.adjustments.map((adjustment) => adjustment.materialAdj), zero),
        );
        const effectivePackagingCost = line.packagingCost.add(
          sumDecimals(line.adjustments.map((adjustment) => adjustment.packagingAdj), zero),
        );
        const effectiveEquipmentCost = line.equipmentCost.add(
          sumDecimals(line.adjustments.map((adjustment) => adjustment.equipmentAdj), zero),
        );
        const effectiveNetContribution = line.netContribution.add(
          sumDecimals(line.adjustments.map((adjustment) => adjustment.netContribAdj), zero),
        );
        const effectiveTotalCost = effectiveLaborCost
          .add(effectiveMaterialCost)
          .add(effectivePackagingCost)
          .add(effectiveEquipmentCost)
          .add(line.mistakeBufferAmount)
          .add(line.podCost);

        return {
          id: line.id,
          shopifyLineItemId: line.shopifyLineItemId,
          shopifyProductId: line.shopifyProductId,
          productTitle: line.productTitle,
          variantTitle: line.variantTitle,
          shopifyAdminUrl: shopifyAdminVariantUrl({
            shopDomain: shopId,
            shopifyProductId: line.shopifyProductId,
            shopifyVariantId: line.shopifyVariantId,
          }),
          quantity: line.quantity,
          subtotal: line.subtotal.toString(),
          laborCost: line.laborCost.toString(),
          materialCost: line.materialCost.toString(),
          packagingCost: line.packagingCost.toString(),
          equipmentCost: line.equipmentCost.toString(),
          effectiveLaborCost: effectiveLaborCost.toString(),
          effectiveMaterialCost: effectiveMaterialCost.toString(),
          effectivePackagingCost: effectivePackagingCost.toString(),
          effectiveEquipmentCost: effectiveEquipmentCost.toString(),
          podCost: line.podCost.toString(),
          mistakeBufferAmount: line.mistakeBufferAmount.toString(),
          totalCost: line.totalCost.toString(),
          effectiveTotalCost: effectiveTotalCost.toString(),
          netContribution: line.netContribution.toString(),
          effectiveNetContribution: effectiveNetContribution.toString(),
          laborMinutes: line.laborMinutes?.toString() ?? null,
          laborRate: line.laborRate?.toString() ?? null,
          podCostEstimated: line.podCostEstimated,
          podCostMissing: line.podCostMissing,
          materialLines: line.materialLines
            .filter((materialLine) => materialLine.materialType !== "shipping")
            .map((materialLine) => ({
              id: materialLine.id,
              materialName: materialLine.materialName,
              materialType: materialLine.materialType,
              costingModel: materialLine.costingModel,
              quantity: materialLine.quantity.toString(),
              usesPerVariant: materialLine.usesPerVariant?.toString() ?? null,
              lineCost: materialLine.lineCost.toString(),
            })),
          equipmentLines: line.equipmentLines.map((equipmentLine) => ({
            id: equipmentLine.id,
            equipmentName: equipmentLine.equipmentName,
            minutes: equipmentLine.minutes?.toString() ?? null,
            uses: equipmentLine.uses?.toString() ?? null,
            lineCost: equipmentLine.lineCost.toString(),
          })),
          podLines: line.podLines.map((podLine) => ({
            id: podLine.id,
            provider: podLine.provider,
            costLineType: podLine.costLineType,
            description: podLine.description,
            amount: podLine.amount.toString(),
          })),
          causeAllocations: line.causeAllocations.map((allocation) => ({
            id: allocation.id,
            causeName: allocation.causeName,
            percentage: allocation.percentage.toString(),
            amount: allocation.amount.toString(),
            is501c3: allocation.is501c3,
          })),
          adjustments: line.adjustments.map((adjustment) => ({
            id: adjustment.id,
            type: adjustment.type,
            reason: adjustment.reason ?? "",
            createdAt: adjustment.createdAt.toISOString(),
            laborAdj: adjustment.laborAdj.toString(),
            materialAdj: adjustment.materialAdj.toString(),
            packagingAdj: adjustment.packagingAdj.toString(),
            equipmentAdj: adjustment.equipmentAdj.toString(),
            netContribAdj: adjustment.netContribAdj.toString(),
          })),
        };
      }),
    },
    artists: (
      await prisma.artist.findMany({
        where: { shopId, status: { in: ["active", "draft"] } },
        orderBy: { displayName: "asc" },
        select: {
          id: true,
          displayName: true,
          creditName: true,
          status: true,
        },
      })
    ).map((artist) => ({
      id: artist.id,
      displayName: artist.displayName,
      creditName: artist.creditName,
      status: artist.status,
    })),
  });
};

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--p-color-border, #d2d5d8)",
        borderRadius: "1rem",
        padding: "1rem",
        display: "grid",
        gap: "0.35rem",
      }}
    >
      <strong>{label}</strong>
      <s-text>{value}</s-text>
    </div>
  );
}

function formatOrigin(origin: string) {
  if (origin === "webhook") return "Webhook";
  if (origin === "historical_import") return "Historical import";
  return "Reconciliation";
}

export default function OrderSnapshotDetailPage() {
  const { artists, snapshot } = useLoaderData<typeof loader>();
  const adjustmentFetcher = useFetcher<{ ok: boolean; message: string }>();
  const attributionFetcher = useFetcher<{ ok: boolean; message: string }>();
  const { formatMoney } = useAppLocalization();
  const effectiveNetContributionTotal = snapshot.lines.reduce(
    (sum: number, line: (typeof snapshot.lines)[number]) => sum + moneyNumber(line.effectiveNetContribution),
    0,
  ).toFixed(2);

  return (
    <>
      <ui-title-bar title={`Order ${snapshot.orderNumber}`} />

      <s-page>
        {adjustmentFetcher.data ? (
          <s-banner tone={adjustmentFetcher.data.ok ? "success" : "critical"}>
            <s-text>{adjustmentFetcher.data.message}</s-text>
          </s-banner>
        ) : null}
        {attributionFetcher.data ? (
          <s-banner tone={attributionFetcher.data.ok ? "success" : "critical"}>
            <s-text>{attributionFetcher.data.message}</s-text>
          </s-banner>
        ) : null}
        <div aria-live="polite" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
          {adjustmentFetcher.data?.message ?? attributionFetcher.data?.message ?? ""}
        </div>

        <s-section heading="Snapshot metadata">
          <div style={{ display: "grid", gap: "1rem" }}>
            <Link to="/app/order-history">Back to Order History</Link>
            <HelpText>Snapshot totals are immutable captures of the order&apos;s resolved financial picture. Effective values include any later adjustments recorded against the snapshot.</HelpText>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "1rem",
              }}
            >
              <SummaryTile label="Origin" value={formatOrigin(snapshot.origin)} />
              <SummaryTile label="Customer" value={snapshot.customerDisplayName ?? "-"} />
              <SummaryTile label="Created" value={new Date(snapshot.createdAt).toLocaleString()} />
              <SummaryTile label="Line count" value={snapshot.lines.length.toString()} />
              <SummaryTile
                label="Effective net contribution"
                value={formatMoney(effectiveNetContributionTotal)}
              />
            </div>
            {snapshot.shopifyAdminUrl ? (
              <div>
                <a href={snapshot.shopifyAdminUrl} target="_blank" rel="noreferrer">Open order in Shopify</a>
              </div>
            ) : null}
          </div>
        </s-section>

        <s-section heading="Shopify order totals">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "1rem",
            }}
          >
            <SummaryTile label="Subtotal" value={formatMoney(snapshot.subtotalAmount)} />
            <SummaryTile label="Discounts" value={formatMoney(snapshot.discountAmount)} />
            <SummaryTile label="Shipping" value={formatMoney(snapshot.shippingAmount)} />
            <SummaryTile label="Sales tax" value={formatMoney(snapshot.salesTaxCollected)} />
            <SummaryTile label="Total" value={formatMoney(snapshot.totalAmount)} />
          </div>
        </s-section>

        <s-section heading="Artist association">
          <div style={{ display: "grid", gap: "1rem" }}>
            <HelpText>Associate this order with the purchasing customer&apos;s artist relationship. If this order includes payout allocations for the same artist, reporting excludes those artist payouts as self-purchases.</HelpText>
            {snapshot.artistAttribution ? (
              <s-banner tone="info">
                <s-text>
                  Associated with {snapshot.artistAttribution.artistName} ({snapshot.artistAttribution.creditName}) via {snapshot.artistAttribution.source.replaceAll("_", " ")}.
                </s-text>
              </s-banner>
            ) : null}
            <attributionFetcher.Form method="post" style={{ display: "grid", gap: "0.75rem", maxWidth: "42rem" }}>
              <input type="hidden" name="intent" value="save-artist-attribution" />
              <div style={{ display: "grid", gap: "0.35rem" }}>
                <label htmlFor="artist-attribution">Artist</label>
                <select
                  id="artist-attribution"
                  name="artistId"
                  defaultValue={snapshot.artistAttribution?.artistId ?? ""}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "0.75rem",
                    borderRadius: "0.75rem",
                    border: "1px solid var(--p-color-border, #d2d5d8)",
                    background: "var(--p-color-bg-surface, #fff)",
                    color: "var(--p-color-text, #303030)",
                    font: "inherit",
                  }}
                >
                  <option value="">No artist association</option>
                  {artists.map((artist: (typeof artists)[number]) => (
                    <option key={artist.id} value={artist.id}>
                      {artist.displayName} ({artist.creditName}){artist.status === "draft" ? " - draft" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "grid", gap: "0.35rem" }}>
                <label htmlFor="artist-attribution-notes">Notes</label>
                <textarea
                  id="artist-attribution-notes"
                  name="notes"
                  defaultValue={snapshot.artistAttribution?.notes ?? ""}
                  rows={3}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "0.75rem",
                    borderRadius: "0.75rem",
                    border: "1px solid var(--p-color-border, #d2d5d8)",
                    background: "var(--p-color-bg-surface, #fff)",
                    color: "var(--p-color-text, #303030)",
                    font: "inherit",
                  }}
                />
              </div>
              {snapshot.canPersistCustomerAssociation ? (
                <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                  <input type="checkbox" name="persistCustomerAssociation" defaultChecked />
                  <span>Apply this artist association to this customer&apos;s future orders.</span>
                </label>
              ) : null}
              <div>
                <s-button type="submit" variant="primary" disabled={attributionFetcher.state !== "idle"}>
                  Save artist association
                </s-button>
              </div>
            </attributionFetcher.Form>
          </div>
        </s-section>

        <s-section heading="Package allocations">
          <div style={{ display: "grid", gap: "1rem" }}>
            {snapshot.packageAllocations.length === 0 ? (
              <s-text color="subdued">No package allocation has been recorded for this snapshot.</s-text>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header>Package</s-table-header>
                  <s-table-header>Qty</s-table-header>
                  <s-table-header>Source</s-table-header>
                  <s-table-header>Confidence</s-table-header>
                  <s-table-header format="currency">Material cost</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {snapshot.packageAllocations.map((allocation: (typeof snapshot.packageAllocations)[number]) => (
                    <s-table-row key={allocation.id}>
                      <s-table-cell>
                        <strong>{allocation.packageName}</strong>
                        {allocation.reason ? <div><s-text color="subdued">{allocation.reason}</s-text></div> : null}
                      </s-table-cell>
                      <s-table-cell>{allocation.quantity}</s-table-cell>
                      <s-table-cell>{allocation.source}</s-table-cell>
                      <s-table-cell>{allocation.confidence}</s-table-cell>
                      <s-table-cell>{formatMoney(allocation.materialCost)}</s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}

            {snapshot.packagingReviewItems.length > 0 ? (
              <s-banner tone="warning">
                <s-text>
                  Packaging review: {snapshot.packagingReviewItems.map((item: (typeof snapshot.packagingReviewItems)[number]) => item.reason.replaceAll("_", " ")).join(", ")}
                </s-text>
              </s-banner>
            ) : null}
          </div>
        </s-section>

        <s-section heading="Line details">
          <div style={{ display: "grid", gap: "1rem" }}>
            {snapshot.lines.map((line: (typeof snapshot.lines)[number]) => (
              <div
                key={line.id}
                style={{
                  border: "1px solid var(--p-color-border, #d2d5d8)",
                  borderRadius: "1rem",
                  padding: "1rem",
                  display: "grid",
                  gap: "1rem",
                }}
              >
                <div style={{ display: "grid", gap: "0.25rem" }}>
                  <strong>{line.productTitle}</strong>
                  <s-text color="subdued">
                    {line.variantTitle} · Qty {line.quantity} · Subtotal {formatMoney(line.subtotal)}
                  </s-text>
                  {line.shopifyAdminUrl ? (
                    <a href={line.shopifyAdminUrl} target="_blank" rel="noreferrer">Open variant in Shopify</a>
                  ) : null}
                  <HelpText>Subtotal is discounted sales revenue allocated to this line before costs. Net contribution is what remains after effective costs, POD cost, and buffer.</HelpText>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: "0.75rem",
                  }}
                >
                  <SummaryTile label="Labor" value={formatMoney(line.effectiveLaborCost)} />
                  <SummaryTile label="Materials" value={formatMoney(line.effectiveMaterialCost)} />
                  <SummaryTile label="Equipment" value={formatMoney(line.effectiveEquipmentCost)} />
                  <SummaryTile label="Buffer" value={formatMoney(line.mistakeBufferAmount)} />
                  <SummaryTile label="Effective total cost" value={formatMoney(line.effectiveTotalCost)} />
                  <SummaryTile label="Net contribution" value={formatMoney(line.effectiveNetContribution)} />
                </div>

                {line.podCostEstimated || line.podCostMissing ? (
                  <s-banner tone="warning">
                    <s-text>POD cost flags are set for this line item.</s-text>
                  </s-banner>
                ) : null}

                <details>
                  <summary>Materials ({line.materialLines.length})</summary>
                  <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
                    {line.materialLines.length === 0 ? (
                      <s-text color="subdued">No material lines captured.</s-text>
                    ) : (
                      line.materialLines.map((materialLine: (typeof line.materialLines)[number]) => (
                        <div
                          key={materialLine.id}
                          style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}
                        >
                          <span>
                            {materialLine.materialName} · {materialLine.materialType}
                          </span>
                          <span>
                            Qty {materialLine.quantity}
                            {materialLine.usesPerVariant ? ` · Uses ${materialLine.usesPerVariant}` : ""}
                            {` · ${formatMoney(materialLine.lineCost)}`}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </details>

                <details>
                  <summary>Equipment ({line.equipmentLines.length})</summary>
                  <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
                    {line.equipmentLines.length === 0 ? (
                      <s-text color="subdued">No equipment lines captured.</s-text>
                    ) : (
                      line.equipmentLines.map((equipmentLine: (typeof line.equipmentLines)[number]) => (
                        <div
                          key={equipmentLine.id}
                          style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}
                        >
                          <span>{equipmentLine.equipmentName}</span>
                          <span>
                            {equipmentLine.minutes ? `Minutes ${equipmentLine.minutes}` : ""}
                            {equipmentLine.minutes && equipmentLine.uses ? " · " : ""}
                            {equipmentLine.uses ? `Uses ${equipmentLine.uses}` : ""}
                            {` · ${formatMoney(equipmentLine.lineCost)}`}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </details>

                <details>
                  <summary>POD lines ({line.podLines.length})</summary>
                  <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
                    {line.podLines.length === 0 ? (
                      <s-text color="subdued">No POD lines captured.</s-text>
                    ) : (
                      line.podLines.map((podLine: (typeof line.podLines)[number]) => (
                        <div
                          key={podLine.id}
                          style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}
                        >
                          <span>
                            {podLine.provider} · {podLine.costLineType} · {podLine.description}
                          </span>
                          <span>{formatMoney(podLine.amount)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </details>

                <details>
                  <summary>Cause allocations ({line.causeAllocations.length})</summary>
                  <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
                    <HelpText>These amounts are the line&apos;s net contribution split by the product-level Cause percentages active when the snapshot was created.</HelpText>
                    {line.causeAllocations.length === 0 ? (
                      <s-text color="subdued">No cause allocations for this line.</s-text>
                    ) : (
                      line.causeAllocations.map((allocation: (typeof line.causeAllocations)[number]) => (
                        <div
                          key={allocation.id}
                          style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}
                        >
                          <span>
                            {allocation.causeName}
                            {allocation.is501c3 ? " · 501(c)(3)" : ""}
                          </span>
                          <span>{allocation.percentage}% · {formatMoney(allocation.amount)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </details>

                <details>
                  <summary>Adjustments ({line.adjustments.length})</summary>
                  <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
                    <HelpText>Adjustments capture changes after the original snapshot, such as refunds, order updates, or merchant-entered corrections.</HelpText>
                    {line.adjustments.length === 0 ? (
                      <s-text color="subdued">No adjustments recorded yet.</s-text>
                    ) : (
                      line.adjustments.map((adjustment: (typeof line.adjustments)[number]) => (
                        <div
                          key={adjustment.id}
                          style={{
                            border: "1px solid var(--p-color-border, #d2d5d8)",
                            borderRadius: "0.75rem",
                            padding: "0.75rem",
                            display: "grid",
                            gap: "0.35rem",
                          }}
                        >
                          <strong>
                            {adjustment.type === "refund"
                              ? "Refund"
                              : adjustment.reason === "orders/updated webhook"
                                ? "Order update"
                                : "Manual adjustment"}
                          </strong>
                          <s-text color="subdued">{new Date(adjustment.createdAt).toLocaleString()}</s-text>
                          {adjustment.reason ? <s-text>{adjustment.reason}</s-text> : null}
                          <s-text>
                            Labor {formatMoney(adjustment.laborAdj)} · Materials {formatMoney(adjustment.materialAdj)} · Packaging {formatMoney(adjustment.packagingAdj)} · Equipment {formatMoney(adjustment.equipmentAdj)} · Net {formatMoney(adjustment.netContribAdj)}
                          </s-text>
                        </div>
                      ))
                    )}

                    <adjustmentFetcher.Form method="post" style={{ display: "grid", gap: "0.75rem" }}>
                      <input type="hidden" name="intent" value="create-manual-adjustment" />
                      <input type="hidden" name="snapshotLineId" value={line.id} />

                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor={`reason-${line.id}`}>Reason</label>
                        <HelpText>Short explanation for why this manual correction is being added.</HelpText>
                        <input
                          id={`reason-${line.id}`}
                          name="reason"
                          type="text"
                          placeholder="e.g. Inventory true-up"
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            padding: "0.75rem",
                            borderRadius: "0.75rem",
                            border: "1px solid var(--p-color-border, #d2d5d8)",
                            background: "var(--p-color-bg-surface, #fff)",
                            color: "var(--p-color-text, #303030)",
                            font: "inherit",
                          }}
                        />
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                          gap: "0.75rem",
                        }}
                      >
                        {[
                          { name: "laborAdj", label: "Labor adj" },
                          { name: "materialAdj", label: "Material adj" },
                          { name: "packagingAdj", label: "Packaging adj" },
                          { name: "equipmentAdj", label: "Equipment adj" },
                        ].map((field) => (
                          <div key={field.name} style={{ display: "grid", gap: "0.35rem" }}>
                            <label htmlFor={`${field.name}-${line.id}`}>{field.label}</label>
                            <HelpText>Positive values add cost back in; negative values reduce that cost bucket.</HelpText>
                            <input
                              id={`${field.name}-${line.id}`}
                              name={field.name}
                              type="number"
                              step="0.01"
                              defaultValue="0"
                              style={{
                                width: "100%",
                                boxSizing: "border-box",
                                padding: "0.75rem",
                                borderRadius: "0.75rem",
                                border: "1px solid var(--p-color-border, #d2d5d8)",
                                background: "var(--p-color-bg-surface, #fff)",
                                color: "var(--p-color-text, #303030)",
                                font: "inherit",
                              }}
                            />
                          </div>
                        ))}
                      </div>

                      <div>
                        <s-button type="submit" variant="secondary" disabled={adjustmentFetcher.state !== "idle"}>
                          Add manual adjustment
                        </s-button>
                      </div>
                    </adjustmentFetcher.Form>
                  </div>
                </details>
              </div>
            ))}
          </div>
        </s-section>
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[OrderSnapshotDetail] ErrorBoundary caught:", error);

  return (
    <>
      <ui-title-bar title="Order Snapshot" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading this order snapshot. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
