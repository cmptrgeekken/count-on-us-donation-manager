import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import { z } from "zod";
import { prisma } from "../db.server";
import { recomputeTaxOffsetCache } from "../services/taxOffsetCache.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import { useAppLocalization } from "../utils/use-app-localization";

const expenseSchema = z.object({
  category: z.string().trim().min(1, "Category is required."),
  subType: z.string().trim().optional(),
  name: z.string().trim().min(1, "Name is required."),
  amount: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Number(value)) && Number(value) > 0, "Amount must be greater than 0."),
  expenseDate: z.string().trim().min(1, "Expense date is required."),
  notes: z.string().trim().optional(),
});

const SUBTYPE_OPTIONS: Record<string, Array<{ label: string; value: string }>> = {
  inventory_materials: [
    { label: "Material purchase", value: "material_purchase" },
    { label: "COGS adjustment", value: "cogs_adjustment" },
  ],
  operations: [
    { label: "Platform / ops", value: "platform_ops" },
    { label: "Shipping / fulfillment", value: "shipping_ops" },
  ],
  other: [
    { label: "General", value: "general" },
  ],
};

type ExpenseRow = {
  id: string;
  category: string;
  subType: string;
  name: string;
  amount: string;
  expenseDate: string;
  notes: string;
};

type ExpenseFormState = {
  category: string;
  subType: string;
  name: string;
  amount: string;
  expenseDate: string;
  notes: string;
};

const EMPTY_FORM: ExpenseFormState = {
  category: "inventory_materials",
  subType: "material_purchase",
  name: "",
  amount: "",
  expenseDate: new Date().toISOString().slice(0, 10),
  notes: "",
};

function categoryLabel(category: string) {
  switch (category) {
    case "inventory_materials":
      return "Inventory & materials";
    case "operations":
      return "Operations";
    default:
      return "Other";
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const [expenses, taxOffsetCache] = await Promise.all([
    prisma.businessExpense.findMany({
      where: { shopId },
      orderBy: { expenseDate: "desc" },
    }),
    prisma.taxOffsetCache.findUnique({
      where: { shopId },
    }),
  ]);

  return Response.json({
    expenses: expenses.map((expense) => ({
      id: expense.id,
      category: expense.category,
      subType: expense.subType ?? "",
      name: expense.name,
      amount: expense.amount.toString(),
      expenseDate: expense.expenseDate.toISOString().slice(0, 10),
      notes: expense.notes ?? "",
    })),
    summary: {
      deductionPool: taxOffsetCache?.deductionPool.toString() ?? "0.00",
      taxableExposure: taxOffsetCache?.taxableExposure.toString() ?? "0.00",
      cumulativeNetContrib: taxOffsetCache?.cumulativeNetContrib.toString() ?? "0.00",
      widgetTaxSuppressed: taxOffsetCache?.widgetTaxSuppressed ?? true,
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "create") {
    const parsed = expenseSchema.safeParse({
      category: formData.get("category")?.toString() ?? "",
      subType: formData.get("subType")?.toString() ?? "",
      name: formData.get("name")?.toString() ?? "",
      amount: formData.get("amount")?.toString() ?? "",
      expenseDate: formData.get("expenseDate")?.toString() ?? "",
      notes: formData.get("notes")?.toString() ?? "",
    });

    if (!parsed.success) {
      return Response.json(
        { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid expense." },
        { status: 400 },
      );
    }

    const expense = await prisma.businessExpense.create({
      data: {
        shopId,
        category: parsed.data.category,
        subType: parsed.data.subType?.trim() || null,
        name: parsed.data.name,
        amount: Number(parsed.data.amount),
        expenseDate: new Date(parsed.data.expenseDate),
        notes: parsed.data.notes?.trim() || null,
      },
    });

    const summary = await recomputeTaxOffsetCache(shopId);

    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "BusinessExpense",
        entityId: expense.id,
        action: "BUSINESS_EXPENSE_CREATED",
        actor: "merchant",
      },
    });

    return Response.json({
      ok: true,
      message: "Expense created.",
      summary: {
        deductionPool: summary.deductionPool.toString(),
        taxableExposure: summary.taxableExposure.toString(),
        cumulativeNetContrib: summary.cumulativeNetContrib.toString(),
        widgetTaxSuppressed: summary.widgetTaxSuppressed,
      },
    });
  }

  if (intent === "delete") {
    const id = formData.get("id")?.toString() ?? "";
    const expense = await prisma.businessExpense.findFirst({
      where: { id, shopId },
      select: { id: true },
    });

    if (!expense) {
      return Response.json({ ok: false, message: "Expense not found." }, { status: 404 });
    }

    await prisma.businessExpense.delete({
      where: { id },
    });

    const summary = await recomputeTaxOffsetCache(shopId);

    await prisma.auditLog.create({
      data: {
        shopId,
        entity: "BusinessExpense",
        entityId: id,
        action: "BUSINESS_EXPENSE_DELETED",
        actor: "merchant",
      },
    });

    return Response.json({
      ok: true,
      message: "Expense deleted.",
      summary: {
        deductionPool: summary.deductionPool.toString(),
        taxableExposure: summary.taxableExposure.toString(),
        cumulativeNetContrib: summary.cumulativeNetContrib.toString(),
        widgetTaxSuppressed: summary.widgetTaxSuppressed,
      },
    });
  }

  return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
};

export default function ExpensesPage() {
  const { expenses, summary } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{
    ok: boolean;
    message: string;
    summary?: {
      deductionPool: string;
      taxableExposure: string;
      cumulativeNetContrib: string;
      widgetTaxSuppressed: boolean;
    };
  }>();
  const { formatMoney } = useAppLocalization();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ExpenseFormState>(EMPTY_FORM);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialogOpen && !dialog.open) dialog.showModal();
    if (!dialogOpen && dialog.open) dialog.close();
  }, [dialogOpen]);

  const liveSummary = fetcher.data?.summary ?? summary;
  const isSubmitting = fetcher.state !== "idle";

  function updateForm<K extends keyof ExpenseFormState>(key: K, value: ExpenseFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setForm(EMPTY_FORM);
  }

  const subTypeOptions = SUBTYPE_OPTIONS[form.category] ?? SUBTYPE_OPTIONS.other;

  return (
    <>
      <ui-title-bar title="Expenses">
        <button type="button" onClick={openCreate}>Add expense</button>
      </ui-title-bar>

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

      <s-page>
        {fetcher.data && !fetcher.data.ok && (
          <s-banner tone="critical">
            <s-text>{fetcher.data.message}</s-text>
          </s-banner>
        )}

        <s-section heading="Tax offset summary">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1rem",
            }}
          >
            <div style={{ border: "1px solid var(--p-color-border, #d2d5d8)", borderRadius: "1rem", padding: "1rem", display: "grid", gap: "0.35rem" }}>
              <strong>Deduction pool</strong>
              <s-text>{formatMoney(liveSummary.deductionPool)}</s-text>
            </div>
            <div style={{ border: "1px solid var(--p-color-border, #d2d5d8)", borderRadius: "1rem", padding: "1rem", display: "grid", gap: "0.35rem" }}>
              <strong>Cumulative net contribution</strong>
              <s-text>{formatMoney(liveSummary.cumulativeNetContrib)}</s-text>
            </div>
            <div style={{ border: "1px solid var(--p-color-border, #d2d5d8)", borderRadius: "1rem", padding: "1rem", display: "grid", gap: "0.35rem" }}>
              <strong>Taxable exposure</strong>
              <s-text>{formatMoney(liveSummary.taxableExposure)}</s-text>
            </div>
          </div>

          <div style={{ marginTop: "1rem" }}>
            <s-banner tone={liveSummary.widgetTaxSuppressed ? "success" : "warning"}>
              <s-text>
                {liveSummary.widgetTaxSuppressed
                  ? "Current deduction pool fully suppresses widget tax reserve."
                  : "Widget tax reserve is currently active because taxable exposure is above zero."}
              </s-text>
            </s-banner>
          </div>
        </s-section>

        <s-section heading="Business expenses">
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <s-text color="subdued">
              Count On Us currently assumes cash-basis expense timing. This view is operational support and not tax advice.
            </s-text>

            {expenses.length === 0 ? (
              <s-banner tone="warning">
                <s-text>No expenses recorded yet.</s-text>
              </s-banner>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Expense</s-table-header>
                  <s-table-header listSlot="inline">Category</s-table-header>
                  <s-table-header listSlot="inline">Date</s-table-header>
                  <s-table-header listSlot="labeled" format="currency">Amount</s-table-header>
                  <s-table-header>Actions</s-table-header>
                </s-table-header-row>

                <s-table-body>
                  {expenses.map((expense: ExpenseRow) => (
                    <s-table-row key={expense.id}>
                      <s-table-cell>
                        <div style={{ display: "grid", gap: "0.2rem" }}>
                          <strong>{expense.name}</strong>
                          {expense.subType ? <s-text color="subdued">{expense.subType}</s-text> : null}
                        </div>
                      </s-table-cell>
                      <s-table-cell>{categoryLabel(expense.category)}</s-table-cell>
                      <s-table-cell>{expense.expenseDate}</s-table-cell>
                      <s-table-cell>{formatMoney(expense.amount)}</s-table-cell>
                      <s-table-cell>
                        <fetcher.Form method="post">
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="id" value={expense.id} />
                          <s-button type="submit" variant="secondary" tone="critical" disabled={isSubmitting}>
                            Delete
                          </s-button>
                        </fetcher.Form>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </div>
        </s-section>
      </s-page>

      <dialog
        ref={dialogRef}
        onClose={closeDialog}
        style={{
          border: "none",
          borderRadius: "1rem",
          padding: 0,
          maxWidth: "42rem",
          width: "calc(100% - 2rem)",
        }}
      >
        <div style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
            <div style={{ display: "grid", gap: "0.25rem" }}>
              <strong>Add expense</strong>
              <s-text color="subdued">Track deductible business expenses that reduce taxable exposure.</s-text>
            </div>
            <button
              type="button"
              aria-label="Close dialog"
              onClick={closeDialog}
              style={{
                border: "none",
                background: "transparent",
                fontSize: "1.5rem",
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>

          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor="expense-category">Category</label>
            <select
              id="expense-category"
              value={form.category}
              onChange={(event) => {
                const category = event.currentTarget.value;
                updateForm("category", category);
                updateForm("subType", (SUBTYPE_OPTIONS[category] ?? SUBTYPE_OPTIONS.other)[0]?.value ?? "");
              }}
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
              <option value="inventory_materials">Inventory & materials</option>
              <option value="operations">Operations</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor="expense-subtype">Sub-type</label>
            <select
              id="expense-subtype"
              value={form.subType}
              onChange={(event) => updateForm("subType", event.currentTarget.value)}
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
              {subTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <s-text-field
            label="Name"
            value={form.name}
            onChange={(event) => updateForm("name", (event.target as HTMLInputElement | null)?.value ?? "")}
          />
          <s-text-field
            label="Amount"
            type="number"
            min={0}
            step={0.01}
            value={form.amount}
            onChange={(event) => updateForm("amount", (event.target as HTMLInputElement | null)?.value ?? "")}
          />
          <s-text-field
            label="Expense date"
            type="date"
            value={form.expenseDate}
            onChange={(event) => updateForm("expenseDate", (event.target as HTMLInputElement | null)?.value ?? "")}
          />

          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor="expense-notes">Notes</label>
            <textarea
              id="expense-notes"
              rows={4}
              value={form.notes}
              onChange={(event) => updateForm("notes", event.currentTarget.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "0.75rem",
                borderRadius: "0.75rem",
                border: "1px solid var(--p-color-border, #d2d5d8)",
                background: "var(--p-color-bg-surface, #fff)",
                color: "var(--p-color-text, #303030)",
                font: "inherit",
                resize: "vertical",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
            <s-button variant="secondary" onClick={closeDialog}>Cancel</s-button>
            <s-button
              variant="primary"
              disabled={isSubmitting}
              onClick={() => {
                const fd = new FormData();
                fd.append("intent", "create");
                fd.append("category", form.category);
                fd.append("subType", form.subType);
                fd.append("name", form.name);
                fd.append("amount", form.amount);
                fd.append("expenseDate", form.expenseDate);
                fd.append("notes", form.notes);
                fetcher.submit(fd, { method: "post" });
                closeDialog();
              }}
            >
              Create
            </s-button>
          </div>
        </div>
      </dialog>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Expenses] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Expenses" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading Expenses. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
