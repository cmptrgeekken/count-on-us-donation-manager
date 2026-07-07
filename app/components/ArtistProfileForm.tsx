import { Form, useNavigation } from "@remix-run/react";
import { useMemo, useState } from "react";
import { AssignmentPicker, CompactAssignmentList } from "./AssignmentControls";
import { HelpText } from "./HelpText";
import type { ArtistProfileActionData } from "../services/artistProfile.server";

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

const twoColumnStyle = {
  display: "grid",
  gap: "0.9rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))",
};

type CauseOption = {
  id: string;
  name: string;
};

type ArtistFormValue = {
  id: string;
  displayName: string;
  creditName: string;
  creditPreference: string;
  publicBio: string;
  websiteUrl: string;
  instagramUrl: string;
  contactName: string;
  contactEmail: string;
  status: string;
  paymentEnabled: boolean;
  defaultPayoutRate: string;
  taxStatus: string;
  paymentNotes: string;
  restrictedChannels: string;
  restrictedFormats: string;
  internalNotes: string;
  causeAssignments: Array<{
    causeId: string;
    percentage: string;
  }>;
};

export function ArtistProfileForm({
  artist,
  causes,
  actionData,
  intent,
}: {
  artist?: ArtistFormValue;
  causes: CauseOption[];
  actionData?: ArtistProfileActionData;
  intent: "create" | "update";
}) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const [causeRows, setCauseRows] = useState<Array<{ causeId: string; percentage: string }>>(
    () => artist?.causeAssignments.map((assignment) => ({ causeId: assignment.causeId, percentage: assignment.percentage })) ?? [],
  );
  const idPrefix = `${intent}-${artist?.id ?? "new"}`;
  const selectedCauseIds = useMemo(() => new Set(causeRows.map((assignment) => assignment.causeId)), [causeRows]);
  const causeMap = useMemo(() => new Map(causes.map((cause) => [cause.id, cause])), [causes]);
  const causeTotal = causeRows.reduce((sum, assignment) => sum + (Number(assignment.percentage) || 0), 0);

  function addCauses(causeIds: string[]) {
    setCauseRows((current) => [
      ...current,
      ...causeIds
        .filter((causeId) => !current.some((assignment) => assignment.causeId === causeId))
        .map((causeId) => ({ causeId, percentage: "" })),
    ]);
  }

  function updateCauseRow(index: number, percentage: string) {
    setCauseRows((current) =>
      current.map((assignment, rowIndex) => (rowIndex === index ? { ...assignment, percentage } : assignment)),
    );
  }

  function removeCauseRow(index: number) {
    setCauseRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  return (
    <Form method="post" style={{ display: "grid", gap: "1rem" }}>
      <input type="hidden" name="intent" value={intent} />
      {artist ? <input type="hidden" name="id" value={artist.id} /> : null}

      <div style={twoColumnStyle}>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <label htmlFor={`${idPrefix}-display-name`}>Display name</label>
          <input id={`${idPrefix}-display-name`} name="displayName" defaultValue={artist?.displayName ?? ""} style={fieldStyle} />
        </div>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <label htmlFor={`${idPrefix}-credit-name`}>Credit name</label>
          <input id={`${idPrefix}-credit-name`} name="creditName" defaultValue={artist?.creditName ?? ""} style={fieldStyle} />
        </div>
      </div>

      <div style={twoColumnStyle}>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <label htmlFor={`${idPrefix}-credit-preference`}>Credit preference</label>
          <select id={`${idPrefix}-credit-preference`} name="creditPreference" defaultValue={artist?.creditPreference ?? "artist_name"} style={fieldStyle}>
            <option value="public_name">Public name</option>
            <option value="artist_name">Artist name</option>
            <option value="studio_name">Studio name</option>
            <option value="handle_only">Handle only</option>
            <option value="pseudonym">Pseudonym</option>
            <option value="anonymous">Anonymous</option>
            <option value="uncredited">Uncredited</option>
          </select>
        </div>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <label htmlFor={`${idPrefix}-status`}>Status</label>
          <select id={`${idPrefix}-status`} name="status" defaultValue={artist?.status ?? "draft"} style={fieldStyle}>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="revoked">Revoked</option>
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gap: "0.35rem" }}>
        <label htmlFor={`${idPrefix}-bio`}>Public bio</label>
        <textarea id={`${idPrefix}-bio`} name="publicBio" rows={3} defaultValue={artist?.publicBio ?? ""} style={{ ...fieldStyle, minHeight: "6rem" }} />
      </div>

      <div style={twoColumnStyle}>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <label htmlFor={`${idPrefix}-website`}>Website URL</label>
          <input id={`${idPrefix}-website`} name="websiteUrl" defaultValue={artist?.websiteUrl ?? ""} style={fieldStyle} />
        </div>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <label htmlFor={`${idPrefix}-instagram`}>Instagram URL</label>
          <input id={`${idPrefix}-instagram`} name="instagramUrl" defaultValue={artist?.instagramUrl ?? ""} style={fieldStyle} />
        </div>
      </div>

      <div style={twoColumnStyle}>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <label htmlFor={`${idPrefix}-contact-name`}>Private contact name</label>
          <input id={`${idPrefix}-contact-name`} name="contactName" defaultValue={artist?.contactName ?? ""} style={fieldStyle} />
        </div>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <label htmlFor={`${idPrefix}-contact-email`}>Private contact email</label>
          <input id={`${idPrefix}-contact-email`} name="contactEmail" defaultValue={artist?.contactEmail ?? ""} style={fieldStyle} />
        </div>
      </div>

      <div style={twoColumnStyle}>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input type="checkbox" name="paymentEnabled" value="true" defaultChecked={artist?.paymentEnabled ?? false} />
          <span>Artist receives payout</span>
        </label>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <label htmlFor={`${idPrefix}-payout-rate`}>Default payout rate</label>
          <input id={`${idPrefix}-payout-rate`} name="defaultPayoutRate" type="number" min="0" max="100" step="0.01" defaultValue={artist?.defaultPayoutRate ?? "10"} style={fieldStyle} />
        </div>
      </div>

      <div style={twoColumnStyle}>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <label htmlFor={`${idPrefix}-tax-status`}>Payment/tax status</label>
          <select id={`${idPrefix}-tax-status`} name="taxStatus" defaultValue={artist?.taxStatus ?? "not_required"} style={fieldStyle}>
            <option value="not_required">Not required</option>
            <option value="w9_requested">W-9 requested</option>
            <option value="w9_received">W-9 received</option>
            <option value="blocked">Payment blocked</option>
          </select>
        </div>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <label htmlFor={`${idPrefix}-payment-notes`}>Payment notes</label>
          <input id={`${idPrefix}-payment-notes`} name="paymentNotes" defaultValue={artist?.paymentNotes ?? ""} style={fieldStyle} />
        </div>
      </div>

      <div style={{ display: "grid", gap: "0.5rem" }}>
        <strong>Artist-selected Causes</strong>
        <HelpText>Optional preferred routing for this Artist&apos;s donated share. Percentages may total 100% or less.</HelpText>
        {causes.length === 0 ? (
          <s-text color="subdued">Create active Causes before assigning artist donation routing.</s-text>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ color: causeTotal > 100 ? "var(--p-color-text-critical, #8e1f1f)" : "var(--p-color-text-subdued, #6d7175)" }}>
                Selected routing: {causeTotal.toFixed(2)}%
              </span>
              <AssignmentPicker
                id={`${idPrefix}-cause-picker`}
                label="Add artist-selected Causes"
                triggerLabel="Add Causes"
                options={causes.map((cause) => ({ id: cause.id, label: cause.name }))}
                selectedIds={selectedCauseIds}
                onAdd={addCauses}
                searchPlaceholder="Search Causes"
                emptyText="No Causes match that search."
              />
            </div>
            <CompactAssignmentList
              emptyText="No preferred Causes selected."
              searchPlaceholder="Filter selected Causes"
              items={causeRows.map((assignment, index) => {
                const cause = causeMap.get(assignment.causeId);
                return {
                  id: assignment.causeId,
                  title: cause?.name ?? "Unknown Cause",
                  subtitle: "Artist preference",
                  summary: `${Number(assignment.percentage || 0).toFixed(2)}%`,
                  tone: causeTotal > 100 ? "critical" : "default",
                  defaultExpanded: !assignment.percentage,
                  details: (
                    <div style={twoColumnStyle}>
                      <input type="hidden" name={`causeId:${assignment.causeId}`} value={assignment.causeId} />
                      <div style={{ display: "grid", gap: "0.35rem" }}>
                        <label htmlFor={`${idPrefix}-cause-${index}`}>Percentage</label>
                        <input
                          id={`${idPrefix}-cause-${index}`}
                          name={`cause:${assignment.causeId}`}
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={assignment.percentage}
                          onChange={(event) => updateCauseRow(index, event.currentTarget.value)}
                          style={fieldStyle}
                        />
                      </div>
                    </div>
                  ),
                  actions: (
                    <button type="button" onClick={() => removeCauseRow(index)} style={{ ...fieldStyle, width: "auto", padding: "0.55rem 0.75rem", color: "var(--p-color-text-critical, #8e1f1f)" }}>
                      Remove
                    </button>
                  ),
                };
              })}
            />
          </>
        )}
      </div>

      <div style={twoColumnStyle}>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <label htmlFor={`${idPrefix}-restricted-channels`}>Restricted channels</label>
          <input id={`${idPrefix}-restricted-channels`} name="restrictedChannels" defaultValue={artist?.restrictedChannels ?? ""} style={fieldStyle} />
        </div>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <label htmlFor={`${idPrefix}-restricted-formats`}>Restricted formats</label>
          <input id={`${idPrefix}-restricted-formats`} name="restrictedFormats" defaultValue={artist?.restrictedFormats ?? ""} style={fieldStyle} />
        </div>
      </div>

      <div style={{ display: "grid", gap: "0.35rem" }}>
        <label htmlFor={`${idPrefix}-internal-notes`}>Internal notes</label>
        <textarea id={`${idPrefix}-internal-notes`} name="internalNotes" rows={3} defaultValue={artist?.internalNotes ?? ""} style={{ ...fieldStyle, minHeight: "6rem" }} />
      </div>

      {actionData && !actionData.ok ? (
        <s-banner tone="critical">
          <s-text>{actionData.message}</s-text>
        </s-banner>
      ) : null}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <s-button type="submit" variant="primary" disabled={isSubmitting}>
          {intent === "create" ? "Create Artist" : "Save Artist"}
        </s-button>
      </div>
    </Form>
  );
}
