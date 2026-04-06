import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRouteError } from "@remix-run/react";
import { z } from "zod";
import { HelpText } from "../components/HelpText";
import { prisma } from "../db.server";
import {
  createCauseMetaobject,
  ensureCauseMetaobjectDefinition,
  updateCauseMetaobject,
} from "../services/causeMetaobjectService.server";
import { authenticateAdminRequest, isPlaywrightBypassRequest } from "../utils/admin-auth.server";

const causeSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  legalName: z.string().trim().optional(),
  description: z.string().trim().optional(),
  iconUrl: z.union([z.literal(""), z.string().url("Icon URL must be a valid URL.")]).optional(),
  donationLink: z.union([z.literal(""), z.string().url("Donation link must be a valid URL.")]).optional(),
  websiteUrl: z.union([z.literal(""), z.string().url("Website URL must be a valid URL.")]).optional(),
  instagramUrl: z.union([z.literal(""), z.string().url("Instagram URL must be a valid URL.")]).optional(),
  is501c3: z.boolean(),
});

const causeIdSchema = z.object({
  id: z.string().trim().cuid("Cause id is invalid."),
});

function normalizeOptional(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

type CauseFormState = {
  id: string;
  name: string;
  legalName: string;
  description: string;
  iconUrl: string;
  donationLink: string;
  websiteUrl: string;
  instagramUrl: string;
  is501c3: boolean;
};

type CauseRecord = {
  id: string;
  name: string;
  legalName: string;
  description: string;
  iconUrl: string;
  donationLink: string;
  websiteUrl: string;
  instagramUrl: string;
  is501c3: boolean;
  status: string;
  metaobjectId: string | null;
  assignmentCount: number;
};

type CauseActionData = {
  ok: boolean;
  message: string;
  fieldErrors?: Partial<Record<keyof Omit<CauseFormState, "id">, string[]>>;
};

const EMPTY_FORM: CauseFormState = {
  id: "",
  name: "",
  legalName: "",
  description: "",
  iconUrl: "",
  donationLink: "",
  websiteUrl: "",
  instagramUrl: "",
  is501c3: false,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;

  const causes = await prisma.cause.findMany({
    where: { shopId },
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: { productAssignments: true },
      },
    },
  });

  return Response.json({
    causes: causes.map((cause) => ({
      id: cause.id,
      name: cause.name,
      legalName: cause.legalName ?? "",
      description: cause.description ?? "",
      iconUrl: cause.iconUrl ?? "",
      donationLink: cause.donationLink ?? "",
      websiteUrl: cause.websiteUrl ?? "",
      instagramUrl: cause.instagramUrl ?? "",
      is501c3: cause.is501c3,
      status: cause.status,
      metaobjectId: cause.shopifyMetaobjectId,
      assignmentCount: cause._count.productAssignments,
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const isPlaywrightBypass = isPlaywrightBypassRequest(request);

  if (!admin && !isPlaywrightBypass) {
    return Response.json({ ok: false, message: "Shopify admin context is required." }, { status: 500 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  if (intent === "create" || intent === "update") {
    const parsed = causeSchema.safeParse({
      name: formData.get("name")?.toString() ?? "",
      legalName: formData.get("legalName")?.toString() ?? "",
      description: formData.get("description")?.toString() ?? "",
      iconUrl: formData.get("iconUrl")?.toString() ?? "",
      donationLink: formData.get("donationLink")?.toString() ?? "",
      websiteUrl: formData.get("websiteUrl")?.toString() ?? "",
      instagramUrl: formData.get("instagramUrl")?.toString() ?? "",
      is501c3: formData.get("is501c3")?.toString() === "true",
    });

    if (!parsed.success) {
      return Response.json(
        {
          ok: false,
          message: parsed.error.issues[0]?.message ?? "Invalid cause details.",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const causeInput = {
      name: parsed.data.name,
      legalName: normalizeOptional(parsed.data.legalName),
      description: normalizeOptional(parsed.data.description),
      iconUrl: normalizeOptional(parsed.data.iconUrl),
      donationLink: normalizeOptional(parsed.data.donationLink),
      websiteUrl: normalizeOptional(parsed.data.websiteUrl),
      instagramUrl: normalizeOptional(parsed.data.instagramUrl),
      is501c3: parsed.data.is501c3,
      status: "active",
    };

    try {
      if (intent === "create") {
        const cause = await prisma.cause.create({
          data: {
            shopId,
            name: causeInput.name,
            legalName: causeInput.legalName,
            is501c3: causeInput.is501c3,
            description: causeInput.description,
            iconUrl: causeInput.iconUrl,
            donationLink: causeInput.donationLink,
            websiteUrl: causeInput.websiteUrl,
            instagramUrl: causeInput.instagramUrl,
            status: "active",
            shopifyMetaobjectId: null,
          },
        });

        await prisma.auditLog.create({
          data: {
            shopId,
            entity: "Cause",
            entityId: cause.id,
            action: "CAUSE_CREATED",
            actor: "merchant",
          },
        });

        try {
          if (admin) {
            await ensureCauseMetaobjectDefinition(admin);
            const metaobject = await createCauseMetaobject(admin, causeInput);
            await prisma.cause.update({
              where: { id: cause.id, shopId },
              data: { shopifyMetaobjectId: metaobject.id },
            });
            await prisma.auditLog.create({
              data: {
                shopId,
                entity: "Cause",
                entityId: cause.id,
                action: "CAUSE_SHOPIFY_SYNCED",
                actor: "merchant",
                payload: { shopifyMetaobjectId: metaobject.id },
              },
            });
          }
          return Response.json({ ok: true, message: "Cause created." });
        } catch (error) {
          await prisma.auditLog.create({
            data: {
              shopId,
              entity: "Cause",
              entityId: cause.id,
              action: "CAUSE_SHOPIFY_SYNC_FAILED",
              actor: "merchant",
              payload: {
                message: error instanceof Error ? error.message : "Unknown Shopify sync failure",
              },
            },
          });
          return Response.json(
            { ok: false, message: "Cause saved locally, but Shopify sync failed. Retry by editing the Cause again." },
            { status: 502 },
          );
        }
      }

      const idParsed = causeIdSchema.safeParse({
        id: formData.get("id")?.toString() ?? "",
      });

      if (!idParsed.success) {
        return Response.json(
          { ok: false, message: idParsed.error.issues[0]?.message ?? "Invalid Cause." },
          { status: 400 },
        );
      }

      const id = idParsed.data.id;
      const existing = await prisma.cause.findFirst({
        where: { id, shopId },
        select: { shopifyMetaobjectId: true },
      });

      if (!existing) {
        return Response.json({ ok: false, message: "Cause not found." }, { status: 404 });
      }

      await prisma.cause.update({
        where: { id, shopId },
        data: {
          name: causeInput.name,
          legalName: causeInput.legalName,
          is501c3: causeInput.is501c3,
          description: causeInput.description,
          iconUrl: causeInput.iconUrl,
          donationLink: causeInput.donationLink,
          websiteUrl: causeInput.websiteUrl,
          instagramUrl: causeInput.instagramUrl,
        },
      });

      await prisma.auditLog.create({
        data: {
            shopId,
            entity: "Cause",
            entityId: id,
            action: "CAUSE_UPDATED",
            actor: "merchant",
          },
        });

      try {
        if (admin) {
          await ensureCauseMetaobjectDefinition(admin);
          let metaobjectId = existing.shopifyMetaobjectId;
          if (metaobjectId) {
            await updateCauseMetaobject(admin, metaobjectId, causeInput);
          } else {
            const metaobject = await createCauseMetaobject(admin, causeInput);
            metaobjectId = metaobject.id;
          }

          await prisma.cause.update({
            where: { id, shopId },
            data: { shopifyMetaobjectId: metaobjectId },
          });

          await prisma.auditLog.create({
            data: {
              shopId,
              entity: "Cause",
              entityId: id,
              action: "CAUSE_SHOPIFY_SYNCED",
              actor: "merchant",
              payload: { shopifyMetaobjectId: metaobjectId },
            },
          });
        }

        return Response.json({ ok: true, message: "Cause updated." });
      } catch (error) {
        await prisma.auditLog.create({
          data: {
            shopId,
            entity: "Cause",
            entityId: id,
            action: "CAUSE_SHOPIFY_SYNC_FAILED",
            actor: "merchant",
            payload: {
              message: error instanceof Error ? error.message : "Unknown Shopify sync failure",
            },
          },
        });
        return Response.json(
          { ok: false, message: "Cause saved locally, but Shopify sync failed. Retry by editing the Cause again." },
          { status: 502 },
        );
      }
    } catch (error) {
      console.error("[Causes] Failed to sync cause metaobject:", error);
      return Response.json(
        { ok: false, message: error instanceof Error ? error.message : "Unable to sync Cause with Shopify." },
        { status: 502 },
      );
    }
  }

  if (intent === "deactivate" || intent === "reactivate") {
    const idParsed = causeIdSchema.safeParse({
      id: formData.get("id")?.toString() ?? "",
    });

    if (!idParsed.success) {
      return Response.json(
        { ok: false, message: idParsed.error.issues[0]?.message ?? "Invalid Cause." },
        { status: 400 },
      );
    }

    const id = idParsed.data.id;
    const nextStatus = intent === "deactivate" ? "inactive" : "active";

    const cause = await prisma.cause.findFirst({
      where: { id, shopId },
      include: {
        _count: {
          select: { productAssignments: true },
        },
      },
    });

    if (!cause) {
      return Response.json({ ok: false, message: "Cause not found." }, { status: 404 });
    }

    if (intent === "deactivate" && cause._count.productAssignments > 0) {
      return Response.json(
        {
          ok: false,
          message: `Remove this Cause from ${cause._count.productAssignments} product assignment(s) before deactivating it.`,
        },
        { status: 400 },
      );
    }

    try {
      const metaobjectInput = {
        name: cause.name,
        legalName: cause.legalName,
        description: cause.description,
        iconUrl: cause.iconUrl,
        donationLink: cause.donationLink,
        websiteUrl: cause.websiteUrl,
        instagramUrl: cause.instagramUrl,
        is501c3: cause.is501c3,
        status: nextStatus,
      };

      await prisma.cause.update({
        where: { id, shopId },
        data: {
          status: nextStatus,
        },
      });

      await prisma.auditLog.create({
        data: {
            shopId,
            entity: "Cause",
            entityId: id,
            action: intent === "deactivate" ? "CAUSE_DEACTIVATED" : "CAUSE_REACTIVATED",
            actor: "merchant",
          },
        });

      try {
        if (admin) {
          await ensureCauseMetaobjectDefinition(admin);
          let metaobjectId = cause.shopifyMetaobjectId;
          if (metaobjectId) {
            await updateCauseMetaobject(admin, metaobjectId, metaobjectInput);
          } else {
            const metaobject = await createCauseMetaobject(admin, metaobjectInput);
            metaobjectId = metaobject.id;
          }

          await prisma.cause.update({
            where: { id, shopId },
            data: { shopifyMetaobjectId: metaobjectId },
          });

          await prisma.auditLog.create({
            data: {
              shopId,
              entity: "Cause",
              entityId: id,
              action: "CAUSE_SHOPIFY_SYNCED",
              actor: "merchant",
              payload: { shopifyMetaobjectId: metaobjectId },
            },
          });
        }

        return Response.json({
          ok: true,
          message: intent === "deactivate" ? "Cause deactivated." : "Cause reactivated.",
        });
      } catch (error) {
        await prisma.auditLog.create({
          data: {
            shopId,
            entity: "Cause",
            entityId: id,
            action: "CAUSE_SHOPIFY_SYNC_FAILED",
            actor: "merchant",
            payload: {
              message: error instanceof Error ? error.message : "Unknown Shopify sync failure",
            },
          },
        });

        return Response.json(
          {
            ok: false,
            message:
              intent === "deactivate"
                ? "Cause deactivated locally, but Shopify sync failed."
                : "Cause reactivated locally, but Shopify sync failed.",
          },
          { status: 502 },
        );
      }
    } catch (error) {
      console.error("[Causes] Failed to sync Cause status to Shopify:", error);
      return Response.json(
        { ok: false, message: error instanceof Error ? error.message : "Unable to sync Cause status with Shopify." },
        { status: 502 },
      );
    }
  }

  return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
};

export default function CausesPage() {
  const { causes } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<CauseActionData>();
  const causeDialogRef = useRef<HTMLDialogElement>(null);
  const deactivateDialogRef = useRef<HTMLDialogElement>(null);

  const [form, setForm] = useState<CauseFormState>(EMPTY_FORM);
  const [causeDialogOpen, setCauseDialogOpen] = useState(false);
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<CauseRecord | null>(null);
  const [lastSubmittedIntent, setLastSubmittedIntent] = useState<string | null>(null);

  useEffect(() => {
    const dialog = causeDialogRef.current;
    if (!dialog) return;

    if (causeDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!causeDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [causeDialogOpen]);

  useEffect(() => {
    const dialog = deactivateDialogRef.current;
    if (!dialog) return;

    if (deactivateDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!deactivateDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [deactivateDialogOpen]);

  function updateForm<K extends keyof CauseFormState>(key: K, value: CauseFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setCauseDialogOpen(true);
  }

  function openEdit(cause: CauseRecord) {
    setForm({
      id: cause.id,
      name: cause.name,
      legalName: cause.legalName,
      description: cause.description,
      iconUrl: cause.iconUrl,
      donationLink: cause.donationLink,
      websiteUrl: cause.websiteUrl,
      instagramUrl: cause.instagramUrl,
      is501c3: cause.is501c3,
    });
    setCauseDialogOpen(true);
  }

  const closeCauseDialog = useCallback(() => {
    setCauseDialogOpen(false);
    setForm(EMPTY_FORM);
    if (lastSubmittedIntent === "create" || lastSubmittedIntent === "update") {
      setLastSubmittedIntent(null);
    }
  }, [lastSubmittedIntent]);

  function confirmDeactivate(cause: CauseRecord) {
    setDeactivateTarget(cause);
    setDeactivateDialogOpen(true);
  }

  const closeDeactivateDialog = useCallback(() => {
    setDeactivateDialogOpen(false);
    setDeactivateTarget(null);
    if (lastSubmittedIntent === "deactivate") {
      setLastSubmittedIntent(null);
    }
  }, [lastSubmittedIntent]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.ok) return;

    if (lastSubmittedIntent === "create" || lastSubmittedIntent === "update") {
      closeCauseDialog();
    }

    if (lastSubmittedIntent === "deactivate" || lastSubmittedIntent === "reactivate") {
      closeDeactivateDialog();
    }
  }, [fetcher.state, fetcher.data, lastSubmittedIntent, closeCauseDialog, closeDeactivateDialog]);

  const isSubmitting = fetcher.state !== "idle";
  const statusMessage = fetcher.data?.message ?? "";
  const modalFieldErrors = useMemo(
    () => ((lastSubmittedIntent === "create" || lastSubmittedIntent === "update") ? fetcher.data?.fieldErrors ?? {} : {}),
    [fetcher.data?.fieldErrors, lastSubmittedIntent],
  );
  const showPageError =
    fetcher.data && !fetcher.data.ok && !(lastSubmittedIntent === "create" || lastSubmittedIntent === "update" || lastSubmittedIntent === "deactivate");
  const showPageSuccess = fetcher.data?.ok && lastSubmittedIntent === "reactivate";

  function fieldError(name: keyof Omit<CauseFormState, "id">) {
    return modalFieldErrors[name]?.[0] ?? null;
  }

  return (
    <>
      <ui-title-bar title="Causes">
        <button type="button" onClick={openCreate}>New cause</button>
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
        {statusMessage}
      </div>

      <s-page>
        {showPageError && (
          <s-banner tone="critical">
            <s-text>{fetcher.data?.message}</s-text>
          </s-banner>
        )}
        {showPageSuccess && (
          <s-banner tone="success">
            <s-text>{fetcher.data?.message}</s-text>
          </s-banner>
        )}

        {causes.length === 0 ? (
          <s-section heading="No causes yet">
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <s-text>Create Causes to map products to charities and later allocate donation amounts in snapshots.</s-text>
              <div>
                <s-button variant="primary" onClick={openCreate}>Add first Cause</s-button>
              </div>
            </div>
          </s-section>
        ) : (
          <s-section padding="none">
            <s-table>
              <div
                slot="filters"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                  alignItems: "center",
                  flexWrap: "wrap",
                  padding: "1rem",
                }}
              >
                <div style={{ display: "grid", gap: "0.2rem" }}>
                  <strong>Cause Library</strong>
                  <HelpText>Nonprofit and impact recipients used for product-level donation assignment and later order-level allocations.</HelpText>
                </div>
                <s-button variant="primary" onClick={openCreate}>New cause</s-button>
              </div>

              <s-table-header-row>
                <s-table-header listSlot="primary">Name</s-table-header>
                <s-table-header listSlot="inline">501(c)(3)</s-table-header>
                <s-table-header listSlot="secondary" format="numeric">Assigned products</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>

              <s-table-body>
                {causes.map((cause: CauseRecord) => (
                  <s-table-row key={cause.id}>
                    <s-table-cell>
                      <div style={{ display: "grid", gap: "0.2rem" }}>
                        <strong>{cause.name}</strong>
                        {cause.legalName ? <s-text color="subdued">{cause.legalName}</s-text> : null}
                      </div>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={cause.is501c3 ? "success" : "enabled"}>
                        {cause.is501c3 ? "Yes" : "No"}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>{cause.assignmentCount}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={cause.status === "active" ? "success" : "enabled"}>
                        {cause.status === "active" ? "Active" : "Inactive"}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <s-button variant="secondary" onClick={() => openEdit(cause)}>Edit</s-button>
                        {cause.status === "active" ? (
                          <s-button variant="secondary" tone="critical" onClick={() => confirmDeactivate(cause)}>
                            Deactivate
                          </s-button>
                        ) : (
                          <fetcher.Form method="post">
                            <input type="hidden" name="intent" value="reactivate" />
                            <input type="hidden" name="id" value={cause.id} />
                            <s-button
                              type="submit"
                              variant="secondary"
                              disabled={isSubmitting}
                              onClick={() => setLastSubmittedIntent("reactivate")}
                            >
                              Reactivate
                            </s-button>
                          </fetcher.Form>
                        )}
                      </div>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
        )}
      </s-page>

      <dialog
        ref={causeDialogRef}
        onClose={closeCauseDialog}
        style={{
          border: "none",
          borderRadius: "1rem",
          padding: 0,
          maxWidth: "44rem",
          width: "calc(100% - 2rem)",
        }}
      >
        <div style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
            <div style={{ display: "grid", gap: "0.25rem" }}>
              <strong>{form.id ? "Edit cause" : "New cause"}</strong>
              <s-text color="subdued">Store Cause details locally and mirror them to Shopify metaobjects for later storefront use.</s-text>
            </div>
            <button
              type="button"
              aria-label="Close dialog"
              onClick={closeCauseDialog}
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

          {fetcher.data && !fetcher.data.ok && (lastSubmittedIntent === "create" || lastSubmittedIntent === "update") ? (
            <s-banner tone="critical">
              <s-text>{fetcher.data.message}</s-text>
            </s-banner>
          ) : null}

          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor="cause-name">Display name *</label>
            <HelpText>The merchant-facing name used in assignments, order snapshots, and future storefront displays.</HelpText>
            <input
              id="cause-name"
              type="text"
              value={form.name}
              onChange={(event) => updateForm("name", event.currentTarget.value)}
              aria-invalid={fieldError("name") ? true : undefined}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "0.75rem",
                borderRadius: "0.75rem",
                border: `1px solid ${fieldError("name") ? "#8e1f1f" : "var(--p-color-border, #d2d5d8)"}`,
                background: "var(--p-color-bg-surface, #fff)",
                color: "var(--p-color-text, #303030)",
                font: "inherit",
              }}
            />
            {fieldError("name") ? <div style={{ color: "#8e1f1f", fontSize: "0.875rem" }}>{fieldError("name")}</div> : null}
          </div>
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor="cause-legal-name">Legal nonprofit name</label>
            <HelpText>Use the registered legal entity name if it differs from the shorter display name.</HelpText>
            <input
              id="cause-legal-name"
              type="text"
              value={form.legalName}
              onChange={(event) => updateForm("legalName", event.currentTarget.value)}
              aria-invalid={fieldError("legalName") ? true : undefined}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "0.75rem",
                borderRadius: "0.75rem",
                border: `1px solid ${fieldError("legalName") ? "#8e1f1f" : "var(--p-color-border, #d2d5d8)"}`,
                background: "var(--p-color-bg-surface, #fff)",
                color: "var(--p-color-text, #303030)",
                font: "inherit",
              }}
            />
            {fieldError("legalName") ? <div style={{ color: "#8e1f1f", fontSize: "0.875rem" }}>{fieldError("legalName")}</div> : null}
          </div>

          <div style={{ display: "grid", gap: "0.35rem" }}>
            <label htmlFor="cause-description">Description</label>
            <HelpText>Optional internal summary for merchants and future storefront/metaobject use.</HelpText>
            <textarea
              id="cause-description"
              rows={4}
              value={form.description}
              onChange={(event) => updateForm("description", event.currentTarget.value)}
              aria-invalid={fieldError("description") ? true : undefined}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "0.75rem",
                borderRadius: "0.75rem",
                border: `1px solid ${fieldError("description") ? "#8e1f1f" : "var(--p-color-border, #d2d5d8)"}`,
                background: "var(--p-color-bg-surface, #fff)",
                color: "var(--p-color-text, #303030)",
                font: "inherit",
                resize: "vertical",
              }}
            />
            {fieldError("description") ? <div style={{ color: "#8e1f1f", fontSize: "0.875rem" }}>{fieldError("description")}</div> : null}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1rem",
            }}
          >
            {[
              { key: "iconUrl", label: "Icon URL" },
              { key: "donationLink", label: "Donation link" },
              { key: "websiteUrl", label: "Website URL" },
              { key: "instagramUrl", label: "Instagram URL" },
            ].map(({ key, label }) => (
              <div key={key} style={{ display: "grid", gap: "0.35rem" }}>
                <label htmlFor={`cause-${key}`}>{label}</label>
                <input
                  id={`cause-${key}`}
                  type="url"
                  value={form[key as keyof Omit<CauseFormState, "id" | "is501c3">] as string}
                  onChange={(event) => updateForm(key as keyof CauseFormState, event.currentTarget.value as never)}
                  aria-invalid={fieldError(key as keyof Omit<CauseFormState, "id">) ? true : undefined}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "0.75rem",
                    borderRadius: "0.75rem",
                    border: `1px solid ${fieldError(key as keyof Omit<CauseFormState, "id">) ? "#8e1f1f" : "var(--p-color-border, #d2d5d8)"}`,
                    background: "var(--p-color-bg-surface, #fff)",
                    color: "var(--p-color-text, #303030)",
                    font: "inherit",
                  }}
                />
                {fieldError(key as keyof Omit<CauseFormState, "id">) ? (
                  <div style={{ color: "#8e1f1f", fontSize: "0.875rem" }}>
                    {fieldError(key as keyof Omit<CauseFormState, "id">)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <label style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={form.is501c3}
              onChange={(event) => updateForm("is501c3", event.currentTarget.checked)}
            />
            <span>Registered 501(c)(3)</span>
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
            <s-button variant="secondary" onClick={closeCauseDialog}>Cancel</s-button>
            <s-button
              variant="primary"
              disabled={isSubmitting}
              onClick={() => {
                const fd = new FormData();
                fd.append("intent", form.id ? "update" : "create");
                if (form.id) fd.append("id", form.id);
                fd.append("name", form.name);
                fd.append("legalName", form.legalName);
                fd.append("description", form.description);
                fd.append("iconUrl", form.iconUrl);
                fd.append("donationLink", form.donationLink);
                fd.append("websiteUrl", form.websiteUrl);
                fd.append("instagramUrl", form.instagramUrl);
                fd.append("is501c3", String(form.is501c3));
                setLastSubmittedIntent(form.id ? "update" : "create");
                fetcher.submit(fd, { method: "post" });
              }}
            >
              {form.id ? "Save" : "Create"}
            </s-button>
          </div>
        </div>
      </dialog>

      <dialog
        ref={deactivateDialogRef}
        onClose={closeDeactivateDialog}
        style={{
          border: "none",
          borderRadius: "1rem",
          padding: 0,
          maxWidth: "34rem",
          width: "calc(100% - 2rem)",
        }}
      >
        <div style={{ padding: "1.5rem", display: "grid", gap: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "start" }}>
            <div style={{ display: "grid", gap: "0.25rem" }}>
              <strong>Deactivate cause</strong>
              <s-text color="subdued">Inactive Causes cannot be assigned to products, but historical records remain intact.</s-text>
            </div>
            <button
              type="button"
              aria-label="Close dialog"
              onClick={closeDeactivateDialog}
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

          {fetcher.data && !fetcher.data.ok && lastSubmittedIntent === "deactivate" ? (
            <s-banner tone="critical">
              <s-text>{fetcher.data.message}</s-text>
            </s-banner>
          ) : null}

          <s-text>
            {deactivateTarget
              ? `Deactivating ${deactivateTarget.name} will remove it from new product assignments.`
              : "Deactivating this Cause will remove it from new product assignments."}
          </s-text>

          {deactivateTarget && deactivateTarget.assignmentCount > 0 && (
            <s-banner tone="warning">
              <s-text>
                This Cause is still assigned to {deactivateTarget.assignmentCount} product(s) and cannot be deactivated yet.
              </s-text>
            </s-banner>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}>
            <s-button variant="secondary" onClick={closeDeactivateDialog}>Cancel</s-button>
            <s-button
              variant="primary"
              tone="critical"
              disabled={isSubmitting || (deactivateTarget?.assignmentCount ?? 0) > 0}
              onClick={() => {
                if (!deactivateTarget) return;
                const fd = new FormData();
                fd.append("intent", "deactivate");
                fd.append("id", deactivateTarget.id);
                setLastSubmittedIntent("deactivate");
                fetcher.submit(fd, { method: "post" });
              }}
            >
              Deactivate
            </s-button>
          </div>
        </div>
      </dialog>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[Causes] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Causes" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading Causes. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
