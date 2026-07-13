import { jsonResponse } from "~/utils/json-response.server";
import type { ActionFunctionArgs, LoaderFunctionArgs, SerializeFrom } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useRouteError } from "@remix-run/react";

import { prisma } from "../db.server";
import { createArtistSubmissionStorage } from "../services/artistSubmissionStorage.server";
import {
  convertArtistSubmissionToDraftArtist,
  updateArtistSubmissionStatus,
} from "../services/artistSubmission.server";
import { authenticateAdminRequest } from "../utils/admin-auth.server";

const submissionStatuses = ["new", "reviewing", "contacted", "converted", "declined", "spam", "archived"] as const;

function normalizeStatus(value: string | null): (typeof submissionStatuses)[number] {
  return submissionStatuses.find((status) => status === value) ?? "new";
}

type ActionData = {
  ok: boolean;
  message: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const url = new URL(request.url);
  const status = normalizeStatus(url.searchParams.get("status"));
  const storage = createArtistSubmissionStorage();

  const submissions = await prisma.artistSubmission.findMany({
    where: {
      shopId,
      status,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      files: {
        orderBy: { uploadedAt: "asc" },
      },
      convertedArtist: {
        select: {
          id: true,
          displayName: true,
        },
      },
    },
  });

  return jsonResponse({
    activeStatus: status,
    submissions: await Promise.all(
      submissions.map(async (submission) => ({
        id: submission.id,
        submitterName: submission.submitterName,
        email: submission.email,
        artistName: submission.artistName ?? "",
        publicLinks: submission.publicLinks,
        causeLinks: submission.causeLinks,
        preferredContactMethod: submission.preferredContactMethod ?? "",
        contactDetail: submission.contactDetail ?? "",
        phoneNumber: submission.phoneNumber ?? "",
        instagramHandle: submission.instagramHandle ?? "",
        otherContact: submission.otherContact ?? "",
        localConnection: submission.localConnection ?? "",
        artworkIdea: submission.artworkIdea,
        interestedFormats: submission.interestedFormats,
        formatRestrictions: submission.formatRestrictions ?? "",
        salesChannelRestrictions: submission.salesChannelRestrictions ?? "",
        causePreference: submission.causePreference ?? "",
        causeInterests: submission.causeInterests ?? "",
        artistSharePreference: submission.artistSharePreference ?? "",
        proofApprovalPreference: submission.proofApprovalPreference ?? "",
        artworkSampleLinks: submission.artworkSampleLinks ?? "",
        notes: submission.notes ?? "",
        termsAcknowledgedAt: submission.termsAcknowledgedAt.toISOString(),
        paymentAcknowledgedAt: submission.paymentAcknowledgedAt?.toISOString() ?? "",
        status: submission.status,
        source: submission.source,
        internalNotes: submission.internalNotes ?? "",
        convertedArtist: submission.convertedArtist,
        convertedAt: submission.convertedAt?.toISOString() ?? "",
        createdAt: submission.createdAt.toISOString(),
        files: await Promise.all(
          submission.files.map(async (file) => ({
            id: file.id,
            originalFileName: file.originalFileName,
            contentType: file.contentType,
            byteSize: file.byteSize,
            scanStatus: file.scanStatus,
            scanResult: file.scanResult ?? "",
            downloadUrl: await storage.getSignedReadUrl({
              key: file.storageKey,
              expiresInSeconds: 15 * 60,
            }),
          })),
        ),
      })),
    ),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminRequest(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();
  const submissionId = formData.get("submissionId")?.toString() ?? "";

  if (!submissionId) {
    return jsonResponse({ ok: false, message: "Submission ID is required." } satisfies ActionData, { status: 400 });
  }

  try {
    if (intent === "update-status") {
      const status = formData.get("status")?.toString() ?? "new";
      const internalNotes = formData.get("internalNotes")?.toString() ?? "";
      await updateArtistSubmissionStatus(shopId, { submissionId, status, internalNotes });
      return jsonResponse({ ok: true, message: "Submission updated." } satisfies ActionData);
    }

    if (intent === "convert") {
      const artist = await convertArtistSubmissionToDraftArtist(shopId, submissionId);
      return jsonResponse({ ok: true, message: `Created draft Artist ${artist.displayName}.` } satisfies ActionData);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update submission.";
    return jsonResponse({ ok: false, message } satisfies ActionData, { status: 400 });
  }

  return jsonResponse({ ok: false, message: "Unsupported action." } satisfies ActionData, { status: 400 });
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

const twoColumnStyle = {
  display: "grid",
  gap: "0.9rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function FileSize({ bytes }: { bytes: number }) {
  const mb = bytes / (1024 * 1024);
  return <span>{mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(bytes / 1024, 1).toFixed(0)} KB`}</span>;
}

function isPreviewableImage(contentType: string) {
  return ["image/png", "image/webp", "image/svg+xml"].includes(contentType);
}

function hasUnsafeUrlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 || /\s/.test(character);
  });
}

function safeExternalUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || hasUnsafeUrlCharacters(trimmed)) return null;

  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password || !parsed.hostname.includes(".")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export default function ArtistSubmissionsPage() {
  const { submissions, activeStatus } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <>
      <ui-title-bar title="Artist Submissions" />
      <s-page>
        {actionData?.ok ? (
          <s-banner tone="success">
            <s-text>{actionData.message}</s-text>
          </s-banner>
        ) : null}
        {actionData && !actionData.ok ? (
          <s-banner tone="critical">
            <s-text>{actionData.message}</s-text>
          </s-banner>
        ) : null}

        <s-section heading="Review Queue">
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            {submissionStatuses.map((status) => (
              <a
                key={status}
                href={`/app/artist-submissions?status=${status}`}
                style={{
                  padding: "0.45rem 0.7rem",
                  borderRadius: "999px",
                  border: "1px solid var(--p-color-border, #d2d5d8)",
                  background: activeStatus === status ? "var(--p-color-bg-fill-brand, #303030)" : "transparent",
                  color: activeStatus === status ? "#fff" : "inherit",
                  textDecoration: "none",
                }}
              >
                {status}
              </a>
            ))}
          </div>

          {submissions.length === 0 ? (
            <s-text>No artist submissions found for this view.</s-text>
          ) : (
            <div style={{ display: "grid", gap: "1rem" }}>
              {submissions.map((submission: SerializeFrom<typeof loader>["submissions"][number]) => (
                <details key={submission.id}>
                  <summary>
                    <strong>{submission.artistName || submission.submitterName}</strong> · {submission.status} · {formatDate(submission.createdAt)}
                  </summary>

                  <div style={{ display: "grid", gap: "1rem", paddingBlock: "1rem" }}>
                    <div style={twoColumnStyle}>
                      <div>
                        <strong>Contact</strong>
                        <p style={{ marginBlock: "0.35rem" }}>{submission.submitterName}</p>
                        {submission.email ? <a href={`mailto:${submission.email}`}>{submission.email}</a> : null}
                        {submission.localConnection ? <p>{submission.localConnection}</p> : null}
                        {submission.preferredContactMethod ? (
                          <p style={{ marginBottom: 0 }}>Prefers: {submission.preferredContactMethod}</p>
                        ) : null}
                        {submission.contactDetail ? <p style={{ whiteSpace: "pre-wrap" }}>{submission.contactDetail}</p> : null}
                        {submission.phoneNumber ? <p style={{ marginBlock: "0.25rem" }}>Phone/text: {submission.phoneNumber}</p> : null}
                        {submission.instagramHandle ? <p style={{ marginBlock: "0.25rem" }}>Instagram: {submission.instagramHandle}</p> : null}
                        {submission.otherContact ? <p style={{ whiteSpace: "pre-wrap" }}>{submission.otherContact}</p> : null}
                      </div>
                      <div>
                        <strong>Preferences</strong>
                        <p style={{ marginBlock: "0.35rem" }}>{submission.artistSharePreference || "No artist share preference"}</p>
                        <p>{submission.proofApprovalPreference || "No proof approval preference"}</p>
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: "0.4rem" }}>
                      <strong>Artwork or idea</strong>
                      <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{submission.artworkIdea}</p>
                    </div>

                    {submission.interestedFormats.length > 0 ? (
                      <div>
                        <strong>Interested formats</strong>
                        <p>{submission.interestedFormats.join(", ")}</p>
                      </div>
                    ) : null}

                    <div style={twoColumnStyle}>
                      <div>
                        <strong>Cause interests</strong>
                        <p style={{ marginBlock: "0.35rem" }}>
                          {submission.causePreference || "No cause routing preference"}
                        </p>
                        <p style={{ whiteSpace: "pre-wrap" }}>{submission.causeInterests || "Not provided"}</p>
                        {submission.causeLinks.length > 0 ? (
                          <ul>
                            {submission.causeLinks.map((link: string) => (
                              <li key={link}>
                                {safeExternalUrl(link) ? (
                                  <a href={safeExternalUrl(link) ?? "#"} target="_blank" rel="noreferrer">{link}</a>
                                ) : (
                                  <span>{link}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                      <div>
                        <strong>Restrictions</strong>
                        <p style={{ whiteSpace: "pre-wrap" }}>{submission.formatRestrictions || "No format restrictions"}</p>
                        <p style={{ whiteSpace: "pre-wrap" }}>{submission.salesChannelRestrictions || "No sales channel restrictions"}</p>
                      </div>
                    </div>

                    {submission.publicLinks.length > 0 ? (
                      <div>
                        <strong>Portfolio links</strong>
                        <ul>
                          {submission.publicLinks.map((link: string) => (
                            <li key={link}>
                              {safeExternalUrl(link) ? (
                                <a href={safeExternalUrl(link) ?? "#"} target="_blank" rel="noreferrer">{link}</a>
                              ) : (
                                <span>{link}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {submission.files.length > 0 ? (
                      <div>
                        <strong>Uploaded files</strong>
                        <div
                          style={{
                            display: "grid",
                            gap: "0.85rem",
                            gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))",
                            marginTop: "0.6rem",
                          }}
                        >
                          {submission.files.map((file: {
                            id: string;
                            originalFileName: string;
                            contentType: string;
                            byteSize: number;
                            scanStatus: string;
                            scanResult: string;
                            downloadUrl: string;
                          }) => (
                            <article
                              key={file.id}
                              style={{
                                display: "grid",
                                gap: "0.45rem",
                                border: "1px solid var(--p-color-border, #d2d5d8)",
                                borderRadius: "0.5rem",
                                padding: "0.65rem",
                              }}
                            >
                              {isPreviewableImage(file.contentType) ? (
                                <a href={file.downloadUrl} target="_blank" rel="noreferrer" aria-label={`Open ${file.originalFileName}`}>
                                  <img
                                    src={file.downloadUrl}
                                    alt={file.originalFileName}
                                    loading="lazy"
                                    style={{
                                      width: "100%",
                                      aspectRatio: "1 / 1",
                                      objectFit: "contain",
                                      borderRadius: "0.35rem",
                                      background: "var(--p-color-bg-surface-secondary, #f6f6f7)",
                                      border: "1px solid var(--p-color-border-secondary, #e4e5e7)",
                                    }}
                                  />
                                </a>
                              ) : null}
                              <div style={{ display: "grid", gap: "0.2rem" }}>
                                <a href={file.downloadUrl} target="_blank" rel="noreferrer">{file.originalFileName}</a>
                                <span>
                                  <FileSize bytes={file.byteSize} /> · {file.contentType} · {file.scanStatus}
                                </span>
                                {file.scanResult ? <span>{file.scanResult}</span> : null}
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {submission.notes ? (
                      <div>
                        <strong>Additional notes</strong>
                        <p style={{ whiteSpace: "pre-wrap" }}>{submission.notes}</p>
                      </div>
                    ) : null}

                    <div style={twoColumnStyle}>
                      <span>Terms acknowledged: {formatDate(submission.termsAcknowledgedAt)}</span>
                      <span>Payment acknowledgement: {submission.paymentAcknowledgedAt ? formatDate(submission.paymentAcknowledgedAt) : "Not accepted"}</span>
                    </div>

                    {submission.convertedArtist ? (
                      <s-banner tone="success">
                        <s-text>Converted to draft Artist: {submission.convertedArtist.displayName}</s-text>
                      </s-banner>
                    ) : null}

                    <Form method="post" style={{ display: "grid", gap: "0.75rem" }}>
                      <input type="hidden" name="intent" value="update-status" />
                      <input type="hidden" name="submissionId" value={submission.id} />
                      <div style={twoColumnStyle}>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor={`${submission.id}-status`}>Status</label>
                          <select id={`${submission.id}-status`} name="status" defaultValue={submission.status} style={fieldStyle}>
                            {submissionStatuses.map((status) => (
                              <option key={status} value={status}>{status}</option>
                            ))}
                          </select>
                        </div>
                        <div style={{ display: "grid", gap: "0.35rem" }}>
                          <label htmlFor={`${submission.id}-notes`}>Internal notes</label>
                          <textarea id={`${submission.id}-notes`} name="internalNotes" defaultValue={submission.internalNotes} rows={3} style={fieldStyle} />
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <s-button type="submit">Save review</s-button>
                      </div>
                    </Form>

                    {!submission.convertedArtist ? (
                      <Form method="post" style={{ display: "flex", justifyContent: "flex-end" }}>
                        <input type="hidden" name="intent" value="convert" />
                        <input type="hidden" name="submissionId" value={submission.id} />
                        <s-button type="submit" variant="primary">Convert to draft Artist</s-button>
                      </Form>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          )}
        </s-section>
      </s-page>
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[ArtistSubmissions] ErrorBoundary caught:", error);
  return (
    <>
      <ui-title-bar title="Artist Submissions" />
      <s-page>
        <s-section heading="Unable to load artist submissions">
          <s-text>Something went wrong loading artist submissions. Please refresh the page.</s-text>
        </s-section>
      </s-page>
    </>
  );
}
