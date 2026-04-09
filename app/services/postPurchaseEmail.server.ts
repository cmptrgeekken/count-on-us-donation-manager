import { prisma } from "../db.server";
import { DONATION_RECEIPTS_APP_PROXY_PATH } from "../utils/public-routes";

type EmailTransport = {
  send(input: {
    to: string;
    from: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void>;
};

type SnapshotEmailContext = {
  snapshotId: string;
  shopId: string;
  shopifyDomain: string;
  orderNumber: string | null;
  postPurchaseEmailEnabled: boolean;
  lines: Array<{
    causeAllocations: Array<{
      causeId: string;
      causeName: string;
      amount: { toString(): string };
      cause: {
        iconUrl: string | null;
        donationLink: string | null;
      };
    }>;
  }>;
};

function getEmailDriver() {
  return (process.env.POST_PURCHASE_EMAIL_DRIVER || "log").trim().toLowerCase();
}

function getEmailFromAddress() {
  return (process.env.POST_PURCHASE_EMAIL_FROM || "donations@count-on-us.local").trim();
}

function formatMoney(value: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
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
          throw new Error(`Resend email request failed with ${response.status}.`);
        }
      },
    };
  }

  return {
    async send(input) {
      console.log("[post-purchase-email]", JSON.stringify(input));
    },
  };
}

function buildEmailCopy(input: {
  shopifyDomain: string;
  orderNumber: string | null;
  causes: Array<{
    causeId: string;
    causeName: string;
    iconUrl: string | null;
    donationLink: string | null;
    amount: string;
  }>;
  totalDonated: string;
}) {
  const storefrontReceiptsUrl = `https://${input.shopifyDomain}${DONATION_RECEIPTS_APP_PROXY_PATH}`;
  const orderLabel = input.orderNumber || "your recent order";
  const subject = `Your donation impact from ${input.shopifyDomain} - ${orderLabel}`;

  const causeRows = input.causes
    .map(
      (cause) => `
        <tr>
          <td style="padding:8px 0;">
            <strong>${cause.causeName}</strong>
            ${cause.donationLink ? `<div><a href="${cause.donationLink}">Donate direct</a></div>` : ""}
          </td>
          <td style="padding:8px 0; text-align:right;">${formatMoney(cause.amount)}</td>
        </tr>
      `,
    )
    .join("");

  const html = `
    <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5;">
      <h1 style="font-size:24px;margin-bottom:8px;">Your donation impact</h1>
      <p>Thanks for supporting causes through ${input.shopifyDomain}. Here is the donation summary for ${orderLabel}.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tbody>${causeRows}</tbody>
        <tfoot>
          <tr>
            <td style="padding-top:12px;border-top:1px solid #e5e7eb;"><strong>Total donated</strong></td>
            <td style="padding-top:12px;border-top:1px solid #e5e7eb;text-align:right;"><strong>${formatMoney(input.totalDonated)}</strong></td>
          </tr>
        </tfoot>
      </table>
      <p><a href="${storefrontReceiptsUrl}">View donation receipts</a></p>
    </div>
  `;

  const text = [
    "Your donation impact",
    `Thanks for supporting causes through ${input.shopifyDomain}.`,
    "",
    ...input.causes.map((cause) => `${cause.causeName}: ${formatMoney(cause.amount)}`),
    "",
    `Total donated: ${formatMoney(input.totalDonated)}`,
    `View donation receipts: ${storefrontReceiptsUrl}`,
  ].join("\n");

  return { subject, html, text };
}

async function loadSnapshotEmailContext(snapshotId: string, db = prisma): Promise<SnapshotEmailContext | null> {
  const snapshot = await db.orderSnapshot.findUnique({
    where: { id: snapshotId },
    select: {
      id: true,
      shopId: true,
      orderNumber: true,
      lines: {
        select: {
          causeAllocations: {
            select: {
              causeId: true,
              causeName: true,
              amount: true,
              cause: {
                select: {
                  iconUrl: true,
                  donationLink: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!snapshot) {
    return null;
  }

  const shop = await db.shop.findUnique({
    where: { shopId: snapshot.shopId },
    select: {
      shopifyDomain: true,
      postPurchaseEmailEnabled: true,
    },
  });

  if (!shop) {
    return null;
  }

  return {
    snapshotId: snapshot.id,
    shopId: snapshot.shopId,
    shopifyDomain: shop.shopifyDomain,
    orderNumber: snapshot.orderNumber,
    postPurchaseEmailEnabled: shop.postPurchaseEmailEnabled,
    lines: snapshot.lines,
  };
}

export async function sendPostPurchaseDonationEmail(
  input: {
    snapshotId: string;
    contactEmail?: string | null;
  },
  db = prisma,
  transport: EmailTransport = createEmailTransport(),
) {
  const contactEmail = input.contactEmail?.trim();
  if (!contactEmail) {
    return { status: "skipped_no_email" as const };
  }

  const context = await loadSnapshotEmailContext(input.snapshotId, db);
  if (!context) {
    return { status: "skipped_missing_snapshot" as const };
  }

  if (!context.postPurchaseEmailEnabled) {
    return { status: "skipped_disabled" as const };
  }

  const priorSend = await db.auditLog.findFirst({
    where: {
      shopId: context.shopId,
      entity: "OrderSnapshot",
      entityId: context.snapshotId,
      action: "POST_PURCHASE_EMAIL_SENT",
    },
    select: { id: true },
  });

  if (priorSend) {
    return { status: "skipped_already_sent" as const };
  }

  const causeMap = new Map<
    string,
    {
      causeId: string;
      causeName: string;
      iconUrl: string | null;
      donationLink: string | null;
      amount: number;
    }
  >();

  for (const line of context.lines) {
    for (const allocation of line.causeAllocations) {
      const current = causeMap.get(allocation.causeId) ?? {
        causeId: allocation.causeId,
        causeName: allocation.causeName,
        iconUrl: allocation.cause.iconUrl ?? null,
        donationLink: allocation.cause.donationLink ?? null,
        amount: 0,
      };
      current.amount += Number(allocation.amount.toString());
      causeMap.set(allocation.causeId, current);
    }
  }

  if (causeMap.size === 0) {
    return { status: "skipped_no_donation" as const };
  }

  const causes = Array.from(causeMap.values())
    .map((cause) => ({
      causeId: cause.causeId,
      causeName: cause.causeName,
      iconUrl: cause.iconUrl,
      donationLink: cause.donationLink,
      amount: cause.amount.toFixed(2),
    }))
    .sort((left, right) => Number(right.amount) - Number(left.amount) || left.causeName.localeCompare(right.causeName));
  const totalDonated = causes.reduce((sum, cause) => sum + Number(cause.amount), 0).toFixed(2);
  const email = buildEmailCopy({
    shopifyDomain: context.shopifyDomain,
    orderNumber: context.orderNumber,
    causes: causes.map((cause) => ({
      causeId: cause.causeId,
      causeName: cause.causeName,
      iconUrl: cause.iconUrl,
      donationLink: cause.donationLink,
      amount: cause.amount,
    })),
    totalDonated,
  });

  await transport.send({
    to: contactEmail,
    from: getEmailFromAddress(),
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  await db.auditLog.create({
    data: {
      shopId: context.shopId,
      entity: "OrderSnapshot",
      entityId: context.snapshotId,
      action: "POST_PURCHASE_EMAIL_SENT",
      actor: "system",
      payload: {
        to: contactEmail,
        totalDonated,
      },
    },
  });

  return { status: "sent" as const };
}
