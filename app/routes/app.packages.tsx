import { jsonResponse } from "~/utils/json-response.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.server";
import { calculatePackageMaterialCost } from "../services/packaging.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { useAppLocalization } from "../utils/use-app-localization";

const ZERO = new Prisma.Decimal(0);

type PackageRow = {
  id: string;
  name: string;
  status: string;
  source: string;
  dimensions: string;
  length: string;
  width: string;
  height: string;
  emptyWeightGrams: string;
  maxWeightGrams: string;
  notes: string;
  materialCost: string;
  materialLines: Array<{
    id: string;
    materialId: string;
    materialName: string;
    quantity: string;
    perUnitCost: string;
    lineCost: string;
  }>;
};

type ShippingMaterialRow = {
  id: string;
  name: string;
  perUnitCost: string;
};

type ReviewItemRow = {
  id: string;
  reason: string;
  severity: string;
  createdAt: string;
  orderNumber: string;
  snapshotId: string;
  payload: unknown;
};

const packageFormSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(1, "Package name is required."),
  length: z.string().trim().min(1, "Length is required."),
  width: z.string().trim().min(1, "Width is required."),
  height: z.string().trim().min(1, "Height is required."),
  emptyWeightGrams: z.string().trim().optional(),
  maxWeightGrams: z.string().trim().optional(),
  status: z.enum(["active", "inactive"]),
  notes: z.string().trim().optional(),
});

function parsePositiveDecimal(value: string, label: string) {
  const decimal = new Prisma.Decimal(value);
  if (decimal.lte(ZERO)) {
    throw new Response(`${label} must be greater than zero.`, { status: 400 });
  }
  return decimal;
}

function parseOptionalNonNegativeDecimal(value: string | undefined, label: string) {
  if (!value) return null;
  const decimal = new Prisma.Decimal(value);
  if (decimal.lt(ZERO)) {
    throw new Response(`${label} must not be negative.`, { status: 400 });
  }
  return decimal;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const [packages, shippingMaterials, reviewItems] = await Promise.all([
    prisma.shippingPackage.findMany({
      where: { shopId },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      include: {
        materialLines: {
          include: { material: { select: { id: true, name: true, perUnitCost: true } } },
          orderBy: { id: "asc" },
        },
      },
    }),
    prisma.materialLibraryItem.findMany({
      where: { shopId, type: "shipping", status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, perUnitCost: true },
    }),
    prisma.packagingReviewItem.findMany({
      where: { shopId, status: "open" },
      orderBy: [{ createdAt: "desc" }],
      take: 50,
      include: {
        snapshot: {
          select: { id: true, orderNumber: true, shopifyOrderId: true, createdAt: true },
        },
      },
    }),
  ]);

  return jsonResponse({
    packages: packages.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      status: pkg.status,
      source: pkg.source,
      dimensions: `${pkg.length} x ${pkg.width} x ${pkg.height}`,
      length: pkg.length.toString(),
      width: pkg.width.toString(),
      height: pkg.height.toString(),
      emptyWeightGrams: pkg.emptyWeightGrams?.toString() ?? "",
      maxWeightGrams: pkg.maxWeightGrams?.toString() ?? "",
      notes: pkg.notes ?? "",
      materialCost: calculatePackageMaterialCost(pkg).toString(),
      materialLines: pkg.materialLines.map((line) => ({
        id: line.id,
        materialId: line.materialId,
        materialName: line.material.name,
        quantity: line.quantity.toString(),
        perUnitCost: line.material.perUnitCost.toString(),
        lineCost: line.quantity.mul(line.material.perUnitCost).toString(),
      })),
    })),
    shippingMaterials: shippingMaterials.map((material) => ({
      id: material.id,
      name: material.name,
      perUnitCost: material.perUnitCost.toString(),
    })),
    reviewItems: reviewItems.map((item) => ({
      id: item.id,
      reason: item.reason,
      severity: item.severity,
      createdAt: item.createdAt.toISOString(),
      orderNumber: item.snapshot.orderNumber ?? "Unnumbered order",
      snapshotId: item.snapshotId,
      payload: item.payload,
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  try {
    if (intent === "save-package") {
      const parsed = packageFormSchema.safeParse({
        id: formData.get("id")?.toString() ?? "",
        name: formData.get("name")?.toString() ?? "",
        length: formData.get("length")?.toString() ?? "",
        width: formData.get("width")?.toString() ?? "",
        height: formData.get("height")?.toString() ?? "",
        emptyWeightGrams: formData.get("emptyWeightGrams")?.toString() ?? "",
        maxWeightGrams: formData.get("maxWeightGrams")?.toString() ?? "",
        status: formData.get("status")?.toString() ?? "active",
        notes: formData.get("notes")?.toString() ?? "",
      });
      if (!parsed.success) {
        return jsonResponse({ ok: false, message: parsed.error.issues[0]?.message ?? "Invalid package." }, { status: 400 });
      }

      const data = {
        name: parsed.data.name,
        length: parsePositiveDecimal(parsed.data.length, "Length"),
        width: parsePositiveDecimal(parsed.data.width, "Width"),
        height: parsePositiveDecimal(parsed.data.height, "Height"),
        emptyWeightGrams: parseOptionalNonNegativeDecimal(parsed.data.emptyWeightGrams, "Empty weight"),
        maxWeightGrams: parseOptionalNonNegativeDecimal(parsed.data.maxWeightGrams, "Max weight"),
        status: parsed.data.status,
        notes: parsed.data.notes || null,
      };

      if (parsed.data.id) {
        await prisma.shippingPackage.updateMany({
          where: { id: parsed.data.id, shopId },
          data,
        });
      } else {
        await prisma.shippingPackage.create({
          data: { shopId, ...data },
        });
      }

      return jsonResponse({ ok: true, message: "Package saved." });
    }

    if (intent === "add-material-line") {
      const packageId = formData.get("packageId")?.toString() ?? "";
      const materialId = formData.get("materialId")?.toString() ?? "";
      const quantity = parsePositiveDecimal(formData.get("quantity")?.toString() ?? "", "Quantity");
      const [pkg, material] = await Promise.all([
        prisma.shippingPackage.findFirst({ where: { id: packageId, shopId }, select: { id: true } }),
        prisma.materialLibraryItem.findFirst({ where: { id: materialId, shopId, type: "shipping" }, select: { id: true } }),
      ]);
      if (!pkg || !material) {
        return jsonResponse({ ok: false, message: "Package or material not found." }, { status: 404 });
      }

      await prisma.shippingPackageMaterialLine.upsert({
        where: { packageId_materialId: { packageId, materialId } },
        create: { shopId, packageId, materialId, quantity },
        update: { quantity },
      });
      return jsonResponse({ ok: true, message: "Package material saved." });
    }

    if (intent === "remove-material-line") {
      const lineId = formData.get("lineId")?.toString() ?? "";
      await prisma.shippingPackageMaterialLine.deleteMany({ where: { id: lineId, shopId } });
      return jsonResponse({ ok: true, message: "Package material removed." });
    }

    if (intent === "resolve-review-item") {
      const id = formData.get("id")?.toString() ?? "";
      await prisma.packagingReviewItem.updateMany({
        where: { id, shopId },
        data: { status: "resolved", resolvedAt: new Date() },
      });
      return jsonResponse({ ok: true, message: "Review item resolved." });
    }
  } catch (error) {
    if (error instanceof Response) {
      return jsonResponse({ ok: false, message: await error.text() }, { status: error.status });
    }
    throw error;
  }

  return jsonResponse({ ok: false, message: "Unsupported action." }, { status: 400 });
};

function Field({ label, name, defaultValue = "", type = "text" }: { label: string; name: string; defaultValue?: string; type?: string }) {
  return (
    <label style={{ display: "grid", gap: "0.25rem" }}>
      <span>{label}</span>
      <input name={name} type={type} step="0.001" defaultValue={defaultValue} style={{ padding: "0.65rem", border: "1px solid #d2d5d8", borderRadius: "0.5rem" }} />
    </label>
  );
}

export default function PackagesPage() {
  const { packages, shippingMaterials, reviewItems } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const { formatMoney } = useAppLocalization();
  const isSubmitting = fetcher.state !== "idle";

  return (
    <>
      <ui-title-bar title="Shipping Packages" />
      <s-page>
        {fetcher.data ? (
          <s-banner tone={fetcher.data.ok ? "success" : "critical"}>
            <s-text>{fetcher.data.message}</s-text>
          </s-banner>
        ) : null}

        <s-section heading="Package registry">
          <div style={{ display: "grid", gap: "1rem" }}>
            <fetcher.Form method="post" style={{ display: "grid", gap: "0.75rem", maxWidth: "760px" }}>
              <input type="hidden" name="intent" value="save-package" />
              <div style={{ display: "grid", gridTemplateColumns: "2fr repeat(3, 1fr)", gap: "0.75rem" }}>
                <Field label="Name" name="name" />
                <Field label="Length" name="length" type="number" />
                <Field label="Width" name="width" type="number" />
                <Field label="Height" name="height" type="number" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.75rem" }}>
                <Field label="Empty weight (g)" name="emptyWeightGrams" type="number" />
                <Field label="Max weight (g)" name="maxWeightGrams" type="number" />
                <label style={{ display: "grid", gap: "0.25rem" }}>
                  <span>Status</span>
                  <select name="status" defaultValue="active" style={{ padding: "0.65rem", border: "1px solid #d2d5d8", borderRadius: "0.5rem" }}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              </div>
              <label style={{ display: "grid", gap: "0.25rem" }}>
                <span>Notes</span>
                <textarea name="notes" rows={2} style={{ padding: "0.65rem", border: "1px solid #d2d5d8", borderRadius: "0.5rem" }} />
              </label>
              <div>
                <s-button type="submit" disabled={isSubmitting}>Create package</s-button>
              </div>
            </fetcher.Form>

            {packages.length === 0 ? (
              <s-text color="subdued">No packages configured yet.</s-text>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header>Package</s-table-header>
                  <s-table-header>Dimensions</s-table-header>
                  <s-table-header>Status</s-table-header>
                  <s-table-header format="currency">Material cost</s-table-header>
                  <s-table-header>Materials</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {packages.map((pkg: PackageRow) => (
                    <s-table-row key={pkg.id}>
                      <s-table-cell>
                        <strong>{pkg.name}</strong>
                        <div style={{ marginTop: "0.35rem" }}>
                          <fetcher.Form method="post" style={{ display: "grid", gap: "0.5rem" }}>
                            <input type="hidden" name="intent" value="save-package" />
                            <input type="hidden" name="id" value={pkg.id} />
                            <input type="hidden" name="name" value={pkg.name} />
                            <input type="hidden" name="length" value={pkg.length} />
                            <input type="hidden" name="width" value={pkg.width} />
                            <input type="hidden" name="height" value={pkg.height} />
                            <input type="hidden" name="emptyWeightGrams" value={pkg.emptyWeightGrams} />
                            <input type="hidden" name="maxWeightGrams" value={pkg.maxWeightGrams} />
                            <input type="hidden" name="notes" value={pkg.notes} />
                            <input type="hidden" name="status" value={pkg.status === "active" ? "inactive" : "active"} />
                            <s-button type="submit" variant="secondary" disabled={isSubmitting}>
                              {pkg.status === "active" ? "Deactivate" : "Activate"}
                            </s-button>
                          </fetcher.Form>
                        </div>
                      </s-table-cell>
                      <s-table-cell>{pkg.dimensions}</s-table-cell>
                      <s-table-cell>{pkg.status}</s-table-cell>
                      <s-table-cell>{formatMoney(pkg.materialCost)}</s-table-cell>
                      <s-table-cell>
                        <div style={{ display: "grid", gap: "0.5rem", minWidth: "280px" }}>
                          {pkg.materialLines.map((line: PackageRow["materialLines"][number]) => (
                            <div key={line.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
                              <span>{line.materialName} x {line.quantity}</span>
                              <span>{formatMoney(line.lineCost)}</span>
                              <fetcher.Form method="post">
                                <input type="hidden" name="intent" value="remove-material-line" />
                                <input type="hidden" name="lineId" value={line.id} />
                                <s-button type="submit" variant="secondary" disabled={isSubmitting}>Remove</s-button>
                              </fetcher.Form>
                            </div>
                          ))}
                          {shippingMaterials.length > 0 ? (
                            <fetcher.Form method="post" style={{ display: "grid", gridTemplateColumns: "1fr 90px auto", gap: "0.5rem" }}>
                              <input type="hidden" name="intent" value="add-material-line" />
                              <input type="hidden" name="packageId" value={pkg.id} />
                              <select name="materialId" style={{ padding: "0.5rem", border: "1px solid #d2d5d8", borderRadius: "0.5rem" }}>
                                {shippingMaterials.map((material: ShippingMaterialRow) => (
                                  <option key={material.id} value={material.id}>{material.name}</option>
                                ))}
                              </select>
                              <input name="quantity" type="number" step="0.001" defaultValue="1" style={{ padding: "0.5rem", border: "1px solid #d2d5d8", borderRadius: "0.5rem" }} />
                              <s-button type="submit" variant="secondary" disabled={isSubmitting}>Add</s-button>
                            </fetcher.Form>
                          ) : (
                            <s-text color="subdued">Create active shipping materials first.</s-text>
                          )}
                        </div>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </div>
        </s-section>

        <s-section heading="Packaging review queue">
          {reviewItems.length === 0 ? (
            <s-text color="subdued">No open packaging review items.</s-text>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header>Order</s-table-header>
                <s-table-header>Reason</s-table-header>
                <s-table-header>Severity</s-table-header>
                <s-table-header>Created</s-table-header>
                <s-table-header>Action</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {reviewItems.map((item: ReviewItemRow) => (
                  <s-table-row key={item.id}>
                    <s-table-cell><Link to={`/app/order-history/${item.snapshotId}`}>{item.orderNumber}</Link></s-table-cell>
                    <s-table-cell>{item.reason.replaceAll("_", " ")}</s-table-cell>
                    <s-table-cell>{item.severity}</s-table-cell>
                    <s-table-cell>{new Date(item.createdAt).toLocaleString()}</s-table-cell>
                    <s-table-cell>
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="resolve-review-item" />
                        <input type="hidden" name="id" value={item.id} />
                        <s-button type="submit" variant="secondary" disabled={isSubmitting}>Resolve</s-button>
                      </fetcher.Form>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
        </s-section>
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Packages] ErrorBoundary caught:", error);

  return (
    <>
      <ui-title-bar title="Shipping Packages" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading shipping packages. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
