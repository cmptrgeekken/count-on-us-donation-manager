import { prisma, type TransactionCapableDbClient } from "../db.server";

type EmailTransport = {
  send(input: {
    to: string;
    from: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void>;
};

type SubmissionNotificationContext = {
  shopId: string;
  shopifyDomain: string;
  recipientEmail: string | null;
  submission: {
    id: string;
    submitterName: string;
    email: string;
    artistName: string | null;
    publicLinks: string[];
    causeLinks: string[];
    preferredContactMethod: string | null;
    contactDetail: string | null;
    localConnection: string | null;
    artworkIdea: string;
    interestedFormats: string[];
    causePreference: string | null;
    artistSharePreference: string | null;
    proofApprovalPreference: string | null;
    notes: string | null;
    createdAt: Date;
    files: Array<{
      originalFileName: string;
      contentType: string;
      byteSize: number;
      scanStatus: string;
    }>;
  };
};

function getEmailDriver() {
  return (process.env.POST_PURCHASE_EMAIL_DRIVER || "log").trim().toLowerCase();
}

function getEmailFromAddress() {
  return (
    process.env.ARTIST_SUBMISSION_NOTIFICATION_FROM ||
    process.env.POST_PURCHASE_EMAIL_FROM ||
    "artists@count-on-us.local"
  ).trim();
}

function createEmailTransport(): EmailTransport {
  const driver = getEmailDriver();

  if (driver === "resend") {
    return {
      async send(input) {
        const apiKey = process.env.RESEND_API_KEY?.trim();
        if (!apiKey) {
          throw new Error("RESEND_API_KEY is required when POST_PURCHASE_EMAIL_DRIVER=resend.");
        }

        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: input.from,
            to: [input.to],
            subject: input.subject,
            html: input.html,
            text: input.text,
          }),
        });

        if (!response.ok) {
          throw new Error(`Resend artist submission notification failed with ${response.status}.`);
        }
      },
    };
  }

  return {
    async send(input) {
      console.log("[artist-submission-notification]", JSON.stringify(input));
    },
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function formatFileSize(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(bytes / 1024, 1).toFixed(0)} KB`;
}

function getAdminReviewUrl() {
  const baseUrl = process.env.SHOPIFY_APP_URL?.trim().replace(/\/+$/, "");
  return baseUrl ? `${baseUrl}/app/artist-submissions?status=new` : null;
}

async function loadSubmissionNotificationContext(
  shopId: string,
  submissionId: string,
  db: TransactionCapableDbClient,
): Promise<SubmissionNotificationContext | null> {
  const [shop, submission] = await Promise.all([
    db.shop.findUnique({
      where: { shopId },
      select: {
        shopifyDomain: true,
        artistSubmissionNotificationEmail: true,
      },
    }),
    db.artistSubmission.findFirst({
      where: {
        id: submissionId,
        shopId,
      },
      select: {
        id: true,
        submitterName: true,
        email: true,
        artistName: true,
        publicLinks: true,
        causeLinks: true,
        preferredContactMethod: true,
        contactDetail: true,
        localConnection: true,
        artworkIdea: true,
        interestedFormats: true,
        causePreference: true,
        artistSharePreference: true,
        proofApprovalPreference: true,
        notes: true,
        createdAt: true,
        files: {
          orderBy: { uploadedAt: "asc" },
          select: {
            originalFileName: true,
            contentType: true,
            byteSize: true,
            scanStatus: true,
          },
        },
      },
    }),
  ]);

  if (!shop || !submission) return null;

  return {
    shopId,
    shopifyDomain: shop.shopifyDomain,
    recipientEmail: shop.artistSubmissionNotificationEmail?.trim() || null,
    submission,
  };
}

function buildNotificationEmail(context: SubmissionNotificationContext) {
  const { submission } = context;
  const artistName = submission.artistName || submission.submitterName;
  const subject = `New artist submission: ${artistName}`;
  const adminReviewUrl = getAdminReviewUrl();
  const ideaExcerpt = truncate(submission.artworkIdea, 700);
  const links = [...submission.publicLinks, ...submission.causeLinks];

  const htmlRows = [
    ["Artist", artistName],
    ["Submitter", submission.submitterName],
    ["Email", submission.email],
    ["Preferred contact", submission.preferredContactMethod ?? "Not provided"],
    ["Contact detail", submission.contactDetail ?? "Not provided"],
    ["Local connection", submission.localConnection ?? "Not provided"],
    ["Artist share", submission.artistSharePreference ?? "Not provided"],
    ["Proof approval", submission.proofApprovalPreference ?? "Not provided"],
    ["Cause preference", submission.causePreference ?? "Not provided"],
    ["Formats", submission.interestedFormats.length > 0 ? submission.interestedFormats.join(", ") : "Not provided"],
  ]
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:6px 12px 6px 0;color:#6b7280;">${escapeHtml(label)}</td>
          <td style="padding:6px 0;"><strong>${escapeHtml(value)}</strong></td>
        </tr>
      `,
    )
    .join("");

  const fileRows = submission.files
    .map(
      (file) => `
        <li>${escapeHtml(file.originalFileName)} (${escapeHtml(file.contentType)}, ${formatFileSize(file.byteSize)}, ${escapeHtml(file.scanStatus)})</li>
      `,
    )
    .join("");

  const linkRows = links
    .map((link) => `<li><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></li>`)
    .join("");

  const html = `
    <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5;">
      <h1 style="font-size:22px;margin-bottom:8px;">New artist submission</h1>
      <p>${escapeHtml(context.shopifyDomain)} received a new Artist Submission form.</p>
      <table style="border-collapse:collapse;margin:16px 0;">
        <tbody>${htmlRows}</tbody>
      </table>
      <h2 style="font-size:16px;">Artwork or idea</h2>
      <p style="white-space:pre-wrap;">${escapeHtml(ideaExcerpt)}</p>
      ${submission.notes ? `<h2 style="font-size:16px;">Notes</h2><p style="white-space:pre-wrap;">${escapeHtml(truncate(submission.notes, 500))}</p>` : ""}
      ${links.length > 0 ? `<h2 style="font-size:16px;">Links</h2><ul>${linkRows}</ul>` : ""}
      ${submission.files.length > 0 ? `<h2 style="font-size:16px;">Uploaded files</h2><ul>${fileRows}</ul>` : ""}
      ${adminReviewUrl ? `<p><a href="${escapeHtml(adminReviewUrl)}">Open artist submissions</a></p>` : ""}
    </div>
  `;

  const text = [
    "New artist submission",
    `${context.shopifyDomain} received a new Artist Submission form.`,
    "",
    `Artist: ${artistName}`,
    `Submitter: ${submission.submitterName}`,
    `Email: ${submission.email}`,
    `Preferred contact: ${submission.preferredContactMethod ?? "Not provided"}`,
    `Contact detail: ${submission.contactDetail ?? "Not provided"}`,
    `Local connection: ${submission.localConnection ?? "Not provided"}`,
    `Artist share: ${submission.artistSharePreference ?? "Not provided"}`,
    `Proof approval: ${submission.proofApprovalPreference ?? "Not provided"}`,
    `Cause preference: ${submission.causePreference ?? "Not provided"}`,
    `Formats: ${submission.interestedFormats.length > 0 ? submission.interestedFormats.join(", ") : "Not provided"}`,
    "",
    "Artwork or idea:",
    ideaExcerpt,
    ...(submission.notes ? ["", "Notes:", truncate(submission.notes, 500)] : []),
    ...(links.length > 0 ? ["", "Links:", ...links] : []),
    ...(submission.files.length > 0
      ? [
          "",
          "Uploaded files:",
          ...submission.files.map(
            (file) =>
              `${file.originalFileName} (${file.contentType}, ${formatFileSize(file.byteSize)}, ${file.scanStatus})`,
          ),
        ]
      : []),
    ...(adminReviewUrl ? ["", `Open artist submissions: ${adminReviewUrl}`] : []),
  ].join("\n");

  return { subject, html, text };
}

export async function sendArtistSubmissionNotificationEmail(
  input: {
    shopId: string;
    submissionId: string;
  },
  db: TransactionCapableDbClient = prisma,
  transport: EmailTransport = createEmailTransport(),
) {
  const context = await loadSubmissionNotificationContext(input.shopId, input.submissionId, db);
  if (!context) {
    return { status: "skipped_missing_submission" as const };
  }

  if (!context.recipientEmail) {
    return { status: "skipped_no_recipient" as const };
  }

  const priorSend = await db.auditLog.findFirst({
    where: {
      shopId: context.shopId,
      entity: "ArtistSubmission",
      entityId: context.submission.id,
      action: "ARTIST_SUBMISSION_NOTIFICATION_SENT",
    },
    select: { id: true },
  });

  if (priorSend) {
    return { status: "skipped_already_sent" as const };
  }

  const email = buildNotificationEmail(context);

  await transport.send({
    to: context.recipientEmail,
    from: getEmailFromAddress(),
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  await db.auditLog.create({
    data: {
      shopId: context.shopId,
      entity: "ArtistSubmission",
      entityId: context.submission.id,
      action: "ARTIST_SUBMISSION_NOTIFICATION_SENT",
      actor: "system",
      payload: {
        to: context.recipientEmail,
      },
    },
  });

  return { status: "sent" as const };
}
