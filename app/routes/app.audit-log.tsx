import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useNavigate, useRouteError, useSearchParams } from "@remix-run/react";
import { prisma } from "../db.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";
import {
  AUDIT_LOG_ALL_ACTIONS,
  endOfAuditDay,
  formatAuditPayload,
  normalizeAuditAction,
  normalizeAuditDate,
} from "../utils/audit-log";

type AuditLogRow = {
  id: string;
  entity: string;
  entityId: string | null;
  action: string;
  actor: string;
  payload: string;
  createdAt: string;
};

const PAGE_SIZE = 50;

function buildAuditLogHref({
  action,
  startDate,
  endDate,
  cursor,
}: {
  action: string;
  startDate?: string;
  endDate?: string;
  cursor?: string | null;
}) {
  const params = new URLSearchParams();
  if (action && action !== AUDIT_LOG_ALL_ACTIONS) params.set("action", action);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `/app/audit-log?${query}` : "/app/audit-log";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const url = new URL(request.url);
  const action = normalizeAuditAction(url.searchParams.get("action"));
  const startDate = normalizeAuditDate(url.searchParams.get("startDate"));
  const endDate = normalizeAuditDate(url.searchParams.get("endDate"));
  const cursor = url.searchParams.get("cursor")?.trim() || "";

  const where = {
    shopId,
    ...(action === AUDIT_LOG_ALL_ACTIONS ? {} : { action }),
    ...((startDate || endDate)
      ? {
          createdAt: {
            ...(startDate ? { gte: new Date(`${startDate}T00:00:00.000Z`) } : {}),
            ...(endDate ? { lte: endOfAuditDay(endDate) } : {}),
          },
        }
      : {}),
  };

  const [actions, logs] = await Promise.all([
    prisma.auditLog.findMany({
      where: { shopId },
      distinct: ["action"],
      orderBy: { action: "asc" },
      select: { action: true },
    }),
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: PAGE_SIZE + 1,
    }),
  ]);

  const hasNextPage = logs.length > PAGE_SIZE;
  const pageLogs = hasNextPage ? logs.slice(0, PAGE_SIZE) : logs;
  const nextCursor = hasNextPage ? pageLogs.at(-1)?.id ?? null : null;

  return Response.json({
    action,
    startDate,
    endDate,
    nextCursor,
    actions: actions.map((entry) => entry.action),
    logs: pageLogs.map<AuditLogRow>((log) => ({
      id: log.id,
      entity: log.entity,
      entityId: log.entityId,
      action: log.action,
      actor: log.actor,
      payload: formatAuditPayload(log.payload),
      createdAt: log.createdAt.toISOString(),
    })),
  });
};

export default function AuditLogPage() {
  const { action, actions, startDate, endDate, nextCursor, logs } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  function applyFilters(form: HTMLFormElement) {
    const formData = new FormData(form);
    const params = new URLSearchParams(searchParams);
    const nextAction = normalizeAuditAction(formData.get("action")?.toString() ?? "");
    const nextStartDate = normalizeAuditDate(formData.get("startDate")?.toString() ?? "");
    const nextEndDate = normalizeAuditDate(formData.get("endDate")?.toString() ?? "");

    params.delete("cursor");

    if (nextAction !== AUDIT_LOG_ALL_ACTIONS) params.set("action", nextAction);
    else params.delete("action");

    if (nextStartDate) params.set("startDate", nextStartDate);
    else params.delete("startDate");

    if (nextEndDate) params.set("endDate", nextEndDate);
    else params.delete("endDate");

    navigate(`?${params.toString()}`);
  }

  return (
    <>
      <ui-title-bar title="Audit Log" />

      <s-page>
        <s-section heading="Financial audit log">
          <div style={{ display: "grid", gap: "1rem" }}>
            <s-text>
              Review financial mutations in reverse chronological order. Use the filters to narrow by event type or date.
            </s-text>

            <form
              method="get"
              style={{ display: "grid", gap: "0.75rem" }}
              onSubmit={(event) => {
                event.preventDefault();
                applyFilters(event.currentTarget);
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "0.75rem",
                  alignItems: "end",
                }}
              >
                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <span>Event type</span>
                  <select
                    name="action"
                    defaultValue={action}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "0.75rem",
                      borderRadius: "0.75rem",
                      border: "1px solid var(--p-color-border, #c9cccf)",
                      background: "var(--p-color-bg-surface, #fff)",
                      color: "var(--p-color-text, #303030)",
                      font: "inherit",
                    }}
                  >
                    <option value={AUDIT_LOG_ALL_ACTIONS}>All events</option>
                    {actions.map((entry: string) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <span>Start date</span>
                  <input
                    type="date"
                    name="startDate"
                    defaultValue={startDate}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "0.75rem",
                      borderRadius: "0.75rem",
                      border: "1px solid var(--p-color-border, #d2d5d8)",
                    }}
                  />
                </label>

                <label style={{ display: "grid", gap: "0.35rem" }}>
                  <span>End date</span>
                  <input
                    type="date"
                    name="endDate"
                    defaultValue={endDate}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "0.75rem",
                      borderRadius: "0.75rem",
                      border: "1px solid var(--p-color-border, #d2d5d8)",
                    }}
                  />
                </label>

                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                  <s-button type="submit" variant="secondary">
                    Apply filters
                  </s-button>
                  <Link to="/app/audit-log" style={{ alignSelf: "center" }}>
                    Clear filters
                  </Link>
                </div>
              </div>
            </form>

            {logs.length === 0 ? (
              <s-banner tone="warning">
                <s-text>No audit events found for the selected filter.</s-text>
              </s-banner>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="secondary">Created</s-table-header>
                  <s-table-header listSlot="secondary">Event</s-table-header>
                  <s-table-header listSlot="secondary">Entity</s-table-header>
                  <s-table-header listSlot="secondary">Actor</s-table-header>
                  <s-table-header listSlot="primary">Details</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {logs.map((log: AuditLogRow) => (
                    <s-table-row key={log.id}>
                      <s-table-cell>{new Date(log.createdAt).toLocaleString()}</s-table-cell>
                      <s-table-cell>{log.action}</s-table-cell>
                      <s-table-cell>{log.entityId ? `${log.entity} (${log.entityId})` : log.entity}</s-table-cell>
                      <s-table-cell>{log.actor}</s-table-cell>
                      <s-table-cell>
                        {log.payload ? (
                          <details>
                            <summary>View payload</summary>
                            <pre
                              style={{
                                marginTop: "0.5rem",
                                padding: "0.75rem",
                                borderRadius: "0.75rem",
                                background: "var(--p-color-bg-surface-secondary, #f6f6f7)",
                                overflowX: "auto",
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {log.payload}
                            </pre>
                          </details>
                        ) : (
                          "No payload"
                        )}
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}

            {nextCursor ? (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Link
                  to={buildAuditLogHref({
                    action,
                    startDate,
                    endDate,
                    cursor: nextCursor,
                  })}
                >
                  Next page
                </Link>
              </div>
            ) : null}
          </div>
        </s-section>
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[AuditLog] ErrorBoundary caught:", error);

  return (
    <>
      <ui-title-bar title="Audit Log" />
      <s-page>
        <s-banner tone="critical">
          <s-text>Something went wrong loading Audit Log. Please refresh the page.</s-text>
        </s-banner>
      </s-page>
    </>
  );
}
