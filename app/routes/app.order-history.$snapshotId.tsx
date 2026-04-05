import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useRouteError } from "@remix-run/react";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { useAppLocalization } from "../utils/use-app-localization";

const ZERO = new Prisma.Decimal(0);

function sumDecimals(values: Array<Prisma.Decimal | null | undefined>) {
  return values.reduce<Prisma.Decimal>((sum, value) => sum.add(value ?? ZERO), ZERO);
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const snapshotId = params.snapshotId ?? "";

  const snapshot = await prisma.orderSnapshot.findFirst({
    where: { id: snapshotId, shopId },
    include: {
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

  return Response.json({
    snapshot: {
      id: snapshot.id,
      orderNumber: snapshot.orderNumber ?? "Unnumbered order",
      origin: snapshot.origin,
      createdAt: snapshot.createdAt.toISOString(),
      lines: snapshot.lines.map((line) => {
        const effectiveNetContribution = line.netContribution.add(
          sumDecimals(line.adjustments.map((adjustment) => adjustment.netContribAdj ?? ZERO)),
        );

        return {
          id: line.id,
          shopifyLineItemId: line.shopifyLineItemId,
          productTitle: line.productTitle,
          variantTitle: line.variantTitle,
          quantity: line.quantity,
          subtotal: line.subtotal.toString(),
          laborCost: line.laborCost.toString(),
          materialCost: line.materialCost.toString(),
          packagingCost: line.packagingCost.toString(),
          equipmentCost: line.equipmentCost.toString(),
          podCost: line.podCost.toString(),
          mistakeBufferAmount: line.mistakeBufferAmount.toString(),
          totalCost: line.totalCost.toString(),
          netContribution: line.netContribution.toString(),
          effectiveNetContribution: effectiveNetContribution.toString(),
          laborMinutes: line.laborMinutes?.toString() ?? null,
          laborRate: line.laborRate?.toString() ?? null,
          podCostEstimated: line.podCostEstimated,
          podCostMissing: line.podCostMissing,
          materialLines: line.materialLines.map((materialLine) => ({
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

export default function OrderSnapshotDetailPage() {
  const { snapshot } = useLoaderData<typeof loader>();
  const { formatMoney } = useAppLocalization();
  const effectiveNetContributionTotal = snapshot.lines.reduce(
    (sum: Prisma.Decimal, line: (typeof snapshot.lines)[number]) =>
      sum.add(new Prisma.Decimal(line.effectiveNetContribution)),
    ZERO,
  );

  return (
    <>
      <ui-title-bar title={`Order ${snapshot.orderNumber}`} />

      <s-page>
        <s-section heading="Snapshot metadata">
          <div style={{ display: "grid", gap: "1rem" }}>
            <a href="/app/order-history">← Back to Order History</a>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "1rem",
              }}
            >
              <SummaryTile label="Origin" value={snapshot.origin === "webhook" ? "Webhook" : "Reconciliation"} />
              <SummaryTile label="Created" value={new Date(snapshot.createdAt).toLocaleString()} />
              <SummaryTile label="Line count" value={snapshot.lines.length.toString()} />
              <SummaryTile
                label="Effective net contribution"
                value={formatMoney(effectiveNetContributionTotal.toString())}
              />
            </div>
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
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: "0.75rem",
                  }}
                >
                  <SummaryTile label="Labor" value={formatMoney(line.laborCost)} />
                  <SummaryTile label="Materials" value={formatMoney(line.materialCost)} />
                  <SummaryTile label="Packaging" value={formatMoney(line.packagingCost)} />
                  <SummaryTile label="Equipment" value={formatMoney(line.equipmentCost)} />
                  <SummaryTile label="Buffer" value={formatMoney(line.mistakeBufferAmount)} />
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
                        <div key={materialLine.id} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
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
                        <div key={equipmentLine.id} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
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
                  <summary>Cause allocations ({line.causeAllocations.length})</summary>
                  <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
                    {line.causeAllocations.length === 0 ? (
                      <s-text color="subdued">No cause allocations for this line.</s-text>
                    ) : (
                      line.causeAllocations.map((allocation: (typeof line.causeAllocations)[number]) => (
                        <div key={allocation.id} style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
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
                    {line.adjustments.length === 0 ? (
                      <s-text color="subdued">No adjustments recorded yet.</s-text>
                    ) : (
                      line.adjustments.map((adjustment: (typeof line.adjustments)[number]) => (
                        <div key={adjustment.id} style={{ border: "1px solid var(--p-color-border, #d2d5d8)", borderRadius: "0.75rem", padding: "0.75rem", display: "grid", gap: "0.35rem" }}>
                          <strong>{adjustment.type === "refund" ? "Refund" : "Order update"}</strong>
                          <s-text color="subdued">{new Date(adjustment.createdAt).toLocaleString()}</s-text>
                          {adjustment.reason ? <s-text>{adjustment.reason}</s-text> : null}
                          <s-text>
                            Labor {formatMoney(adjustment.laborAdj)} · Materials {formatMoney(adjustment.materialAdj)} · Packaging {formatMoney(adjustment.packagingAdj)} · Equipment {formatMoney(adjustment.equipmentAdj)} · Net {formatMoney(adjustment.netContribAdj)}
                          </s-text>
                        </div>
                      ))
                    )}
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
