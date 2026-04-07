import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { HelpText } from "../components/HelpText";
import { prisma } from "../db.server";
import { createManualAdjustment } from "../services/adjustmentService.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { useAppLocalization } from "../utils/use-app-localization";

const ZERO = new Prisma.Decimal(0);

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

function sumDecimals(values: Array<Prisma.Decimal | null | undefined>) {
  return values.reduce<Prisma.Decimal>((sum, value) => sum.add(value ?? ZERO), ZERO);
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const snapshotId = params.snapshotId ?? "";
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent !== "create-manual-adjustment") {
    return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
  }

  const snapshot = await prisma.orderSnapshot.findFirst({
    where: { id: snapshotId, shopId },
    select: { id: true },
  });

  if (!snapshot) {
    return Response.json({ ok: false, message: "Snapshot not found." }, { status: 404 });
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
    return Response.json(
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
    return Response.json({ ok: false, message: "Snapshot line not found for this order." }, { status: 404 });
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

  return Response.json({ ok: true, message: "Manual adjustment created." });
};

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
        const effectiveLaborCost = line.laborCost.add(
          sumDecimals(line.adjustments.map((adjustment) => adjustment.laborAdj ?? ZERO)),
        );
        const effectiveMaterialCost = line.materialCost.add(
          sumDecimals(line.adjustments.map((adjustment) => adjustment.materialAdj ?? ZERO)),
        );
        const effectivePackagingCost = line.packagingCost.add(
          sumDecimals(line.adjustments.map((adjustment) => adjustment.packagingAdj ?? ZERO)),
        );
        const effectiveEquipmentCost = line.equipmentCost.add(
          sumDecimals(line.adjustments.map((adjustment) => adjustment.equipmentAdj ?? ZERO)),
        );
        const effectiveNetContribution = line.netContribution.add(
          sumDecimals(line.adjustments.map((adjustment) => adjustment.netContribAdj ?? ZERO)),
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
          productTitle: line.productTitle,
          variantTitle: line.variantTitle,
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
  const adjustmentFetcher = useFetcher<{ ok: boolean; message: string }>();
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
        {adjustmentFetcher.data ? (
          <s-banner tone={adjustmentFetcher.data.ok ? "success" : "critical"}>
            <s-text>{adjustmentFetcher.data.message}</s-text>
          </s-banner>
        ) : null}

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
                  <HelpText>Subtotal is sales revenue for this line before costs. Net contribution is what remains after effective costs, POD cost, and buffer.</HelpText>
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
                  <SummaryTile label="Packaging" value={formatMoney(line.effectivePackagingCost)} />
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
