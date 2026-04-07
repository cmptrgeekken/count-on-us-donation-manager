import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import { z } from "zod";
import { HelpText } from "../components/HelpText";
import { prisma } from "../db.server";
import { syncProductCauseAssignmentsMetafield } from "../services/productCauseAssignmentService.server";
import { authenticateAdminRequest, isPlaywrightBypassRequest } from "../utils/admin-auth.server";

const assignmentsSchema = z.object({
  assignments: z.array(
    z.object({
      causeId: z.string().min(1),
      percentage: z.string().min(1),
    }),
  ),
});

type AssignmentRow = {
  causeId: string;
  percentage: string;
};

const fieldStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  padding: "0.75rem",
  borderRadius: "0.75rem",
  border: "1px solid var(--p-color-border, #d2d5d8)",
  background: "var(--p-color-bg-surface, #fff)",
  color: "var(--p-color-text, #303030)",
  font: "inherit",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const productId = params.productId ?? "";

  const product = await prisma.product.findFirst({
    where: { id: productId, shopId },
    select: {
      id: true,
      shopifyId: true,
      title: true,
      handle: true,
      status: true,
      causeAssignments: {
        where: { shopId },
        orderBy: { createdAt: "asc" },
        select: {
          causeId: true,
          percentage: true,
          cause: {
            select: {
              id: true,
              name: true,
              shopifyMetaobjectId: true,
            },
          },
        },
      },
    },
  });

  if (!product) {
    throw new Response("Not found", { status: 404 });
  }

  const causes = await prisma.cause.findMany({
    where: { shopId, status: "active" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      shopifyMetaobjectId: true,
      is501c3: true,
    },
  });

  return Response.json({
    product: {
      id: product.id,
      shopifyId: product.shopifyId,
      title: product.title,
      handle: product.handle,
      status: product.status,
    },
    causes,
    assignments: product.causeAssignments.map((assignment) => ({
      causeId: assignment.causeId,
      percentage: assignment.percentage.toString(),
      causeName: assignment.cause.name,
      metaobjectId: assignment.cause.shopifyMetaobjectId,
    })),
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const productId = params.productId ?? "";
  const isPlaywrightBypass = isPlaywrightBypassRequest(request);

  if (!admin && !isPlaywrightBypass) {
    return Response.json({ ok: false, message: "Shopify admin context is required." }, { status: 500 });
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, shopId },
    select: { id: true, shopifyId: true, title: true },
  });

  if (!product) {
    return Response.json({ ok: false, message: "Product not found." }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent !== "save-assignments") {
    return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
  }

  const rawAssignments = formData.get("assignments")?.toString() ?? "[]";
  const parsed = assignmentsSchema.safeParse({ assignments: JSON.parse(rawAssignments) });

  if (!parsed.success) {
    return Response.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid assignments." },
      { status: 400 },
    );
  }

  const assignments = parsed.data.assignments;
  const causeIds = assignments.map((assignment) => assignment.causeId);

  if (new Set(causeIds).size !== causeIds.length) {
    return Response.json({ ok: false, message: "Each Cause can only be assigned once per product." }, { status: 400 });
  }

  const total = assignments.reduce((sum, assignment) => sum + Number(assignment.percentage), 0);
  if (Number.isNaN(total) || total > 100) {
    return Response.json({ ok: false, message: "Cause percentages must total 100% or less." }, { status: 400 });
  }

  if (assignments.some((assignment) => Number.isNaN(Number(assignment.percentage)) || Number(assignment.percentage) <= 0)) {
    return Response.json({ ok: false, message: "Each Cause percentage must be greater than 0." }, { status: 400 });
  }

  const causes = causeIds.length
    ? await prisma.cause.findMany({
        where: { id: { in: causeIds }, shopId, status: "active" },
        select: { id: true, name: true, shopifyMetaobjectId: true },
      })
    : [];

  if (causes.length !== causeIds.length) {
    return Response.json({ ok: false, message: "One or more selected Causes are unavailable." }, { status: 404 });
  }

  const causeMap = new Map(causes.map((cause) => [cause.id, cause]));

  try {
    await prisma.$transaction(async (tx) => {
      await tx.productCauseAssignment.deleteMany({
        where: {
          shopId,
          shopifyProductId: product.shopifyId,
        },
      });

      if (assignments.length > 0) {
        await tx.productCauseAssignment.createMany({
          data: assignments.map((assignment) => ({
            shopId,
            shopifyProductId: product.shopifyId,
            productId: product.id,
            causeId: assignment.causeId,
            percentage: Number(assignment.percentage),
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          shopId,
          entity: "Product",
          entityId: product.id,
          action: "PRODUCT_CAUSE_ASSIGNMENTS_SAVED",
          actor: "merchant",
          payload: {
            shopifyProductId: product.shopifyId,
            assignments: assignments.map((assignment) => ({
              causeId: assignment.causeId,
              percentage: Number(assignment.percentage).toFixed(2),
            })),
          },
        },
      });
    });

    try {
      if (admin) {
        await syncProductCauseAssignmentsMetafield(
          admin,
          product.shopifyId,
          assignments.map((assignment) => ({
            causeId: assignment.causeId,
            metaobjectId: causeMap.get(assignment.causeId)?.shopifyMetaobjectId ?? null,
            percentage: Number(assignment.percentage).toFixed(2),
          })),
        );

        await prisma.auditLog.create({
          data: {
            shopId,
            entity: "Product",
            entityId: product.id,
            action: "PRODUCT_CAUSE_ASSIGNMENTS_SHOPIFY_SYNCED",
            actor: "merchant",
            payload: {
              shopifyProductId: product.shopifyId,
            },
          },
        });
      }

      return Response.json({ ok: true, message: "Product Cause assignments saved." });
    } catch (error) {
      await prisma.auditLog.create({
        data: {
          shopId,
          entity: "Product",
          entityId: product.id,
          action: "PRODUCT_CAUSE_ASSIGNMENTS_SHOPIFY_SYNC_FAILED",
          actor: "merchant",
          payload: {
            message: error instanceof Error ? error.message : "Unknown Shopify sync failure",
          },
        },
      });

      return Response.json(
        { ok: false, message: "Assignments saved locally, but Shopify sync failed. Save again to retry." },
        { status: 502 },
      );
    }
  } catch (error) {
    console.error("[ProductDonations] Failed to save assignments:", error);
    return Response.json(
      { ok: false, message: error instanceof Error ? error.message : "Unable to save Cause assignments." },
      { status: 502 },
    );
  }
};

export default function ProductDetailPage() {
  const { product, causes, assignments } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const [rows, setRows] = useState<AssignmentRow[]>(() =>
    assignments.map((assignment: (typeof assignments)[number]) => ({
      causeId: assignment.causeId,
      percentage: assignment.percentage,
    })),
  );

  const handledRef = useRef<string>("");
  const selectedCauseIds = useMemo(() => new Set(rows.map((row) => row.causeId)), [rows]);
  const availableToAdd = causes.filter((cause: (typeof causes)[number]) => !selectedCauseIds.has(cause.id));
  const total = rows.reduce((sum, row) => sum + (Number(row.percentage) || 0), 0);
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (!fetcher.data?.ok) return;
    const nextSignature = JSON.stringify(rows);
    handledRef.current = nextSignature;
  }, [fetcher.data, rows]);

  function addCause() {
    if (rows.length >= causes.length) return;
    const nextCause = availableToAdd[0];
    setRows((current) => [...current, { causeId: nextCause?.id ?? "", percentage: "" }]);
  }

  function updateRow(index: number, patch: Partial<AssignmentRow>) {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  function saveAssignments() {
    const formData = new FormData();
    formData.append("intent", "save-assignments");
    formData.append("assignments", JSON.stringify(rows));
    fetcher.submit(formData, { method: "post" });
  }

  return (
    <>
      <ui-title-bar title={product.title} />
      <s-page>
        <div
          aria-live="polite"
          aria-atomic="true"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clip: "rect(0,0,0,0)",
            whiteSpace: "nowrap",
          }}
        >
          {fetcher.data?.message ?? ""}
        </div>

        {fetcher.data && !fetcher.data.ok && (
          <s-banner tone="critical">
            <s-text>{fetcher.data.message}</s-text>
          </s-banner>
        )}

        <s-section heading={product.title}>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <s-text color="subdued">/{product.handle}</s-text>
            <s-text color="subdued">Status: {product.status}</s-text>
          </div>
        </s-section>

        <s-section heading="Cause assignments">
          <div style={{ display: "grid", gap: "1rem" }}>
            <s-text>
              Assign one or more active Causes to this product. Total allocation must be 100% or less.
            </s-text>
            <HelpText>These percentages control how this product&apos;s future order-level net contribution is split across Causes when a snapshot is created.</HelpText>

            {rows.length === 0 ? (
              <s-banner tone="warning">
                <s-text>No Causes are assigned yet. Products without assignments donate 0%.</s-text>
              </s-banner>
            ) : (
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {rows.map((row, index) => {
                  const selectableCauses = causes.filter(
                    (cause: (typeof causes)[number]) =>
                      cause.id === row.causeId || !rows.some((entry, entryIndex) => entry.causeId === cause.id && entryIndex !== index),
                  );

                  return (
                    <div
                      key={`${row.causeId}-${index}`}
                      style={{
                        display: "grid",
                        gap: "0.75rem",
                        gridTemplateColumns: "minmax(260px, 2fr) minmax(180px, 1fr) auto",
                        alignItems: "end",
                      }}
                    >
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor={`cause-${index}`}>Cause</label>
                        <HelpText>The recipient that should receive a share of this product&apos;s future donation pool.</HelpText>
                        <select
                          id={`cause-${index}`}
                          value={row.causeId}
                          onChange={(event) => updateRow(index, { causeId: event.currentTarget.value })}
                          style={fieldStyle}
                        >
                          {!row.causeId ? <option value="">Select cause</option> : null}
                          {selectableCauses.map((cause: (typeof causes)[number]) => (
                            <option key={cause.id} value={cause.id}>
                              {cause.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor={`percentage-${index}`}>Percentage</label>
                        <HelpText>Percent of this product&apos;s net contribution allocated to the selected Cause.</HelpText>
                        <input
                          id={`percentage-${index}`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max="100"
                          step="0.01"
                          value={row.percentage}
                          onChange={(event) => updateRow(index, { percentage: event.currentTarget.value })}
                          style={fieldStyle}
                        />
                      </div>

                      <s-button variant="secondary" tone="critical" onClick={() => removeRow(index)}>
                        Remove
                      </s-button>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
              <s-text>
                <span style={{ color: total > 100 ? "var(--p-color-text-critical, #8e1f1f)" : "var(--p-color-text-subdued, #6d7175)" }}>
                  Total allocation: {total.toFixed(2)}%
                </span>
              </s-text>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <s-button variant="secondary" onClick={addCause} disabled={rows.length >= causes.length}>
                  Add cause
                </s-button>
                <s-button variant="primary" onClick={saveAssignments} disabled={isSubmitting}>
                  Save assignments
                </s-button>
              </div>
            </div>
          </div>
        </s-section>
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[ProductDetail] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Product donations" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading Product donations. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
