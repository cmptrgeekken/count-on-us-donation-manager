import { describe, expect, it, vi } from "vitest";
import { sendArtistSubmissionNotificationEmail } from "./artistSubmissionNotification.server";

function createDb(overrides?: {
  notificationEmail?: string | null;
  priorSend?: { id: string } | null;
}) {
  const hasNotificationEmailOverride = overrides ? "notificationEmail" in overrides : false;

  return {
    shop: {
      findUnique: vi.fn().mockResolvedValue({
        shopifyDomain: "sparkly-rocketship-dev.myshopify.com",
        artistSubmissionNotificationEmail: hasNotificationEmailOverride ? overrides?.notificationEmail : "owner@example.com",
      }),
    },
    artistSubmission: {
      findFirst: vi.fn().mockResolvedValue({
        id: "submission-1",
        submitterName: "Ada Artist",
        email: "ada@example.com",
        artistName: "Ada Studio",
        publicLinks: ["https://example.com/portfolio"],
        causeLinks: ["https://example.org/cause"],
        preferredContactMethod: "Email",
        contactDetail: null,
        localConnection: "Twin Cities",
        artworkIdea: "Tiny joyful spaceships.",
        interestedFormats: ["Buttons"],
        causePreference: "I have specific causes in mind",
        artistSharePreference: "Donate my artist share to my selected cause",
        proofApprovalPreference: "Yes, I want to approve proofs before launch",
        notes: "Available in July.",
        createdAt: new Date("2026-06-05T12:00:00Z"),
        files: [
          {
            originalFileName: "sample.png",
            contentType: "image/png",
            byteSize: 2048,
            scanStatus: "accepted",
          },
        ],
      }),
    },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(overrides?.priorSend ?? null),
      create: vi.fn().mockResolvedValue({ id: "audit-1" }),
    },
  };
}

describe("sendArtistSubmissionNotificationEmail", () => {
  it("sends the notification to the shop-configured recipient", async () => {
    const db = createDb();
    const transport = { send: vi.fn().mockResolvedValue(undefined) };

    const result = await sendArtistSubmissionNotificationEmail(
      {
        shopId: "shop-1",
        submissionId: "submission-1",
      },
      db as any,
      transport,
    );

    expect(result).toEqual({ status: "sent" });
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
        subject: "New artist submission: Ada Studio",
        text: expect.stringContaining("Tiny joyful spaceships."),
      }),
    );
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "ARTIST_SUBMISSION_NOTIFICATION_SENT",
          entityId: "submission-1",
        }),
      }),
    );
  });

  it("skips when the shop has no notification recipient", async () => {
    const db = createDb({ notificationEmail: null });
    const transport = { send: vi.fn().mockResolvedValue(undefined) };

    const result = await sendArtistSubmissionNotificationEmail(
      {
        shopId: "shop-1",
        submissionId: "submission-1",
      },
      db as any,
      transport,
    );

    expect(result).toEqual({ status: "skipped_no_recipient" });
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("skips when a notification was already sent", async () => {
    const db = createDb({ priorSend: { id: "audit-1" } });
    const transport = { send: vi.fn().mockResolvedValue(undefined) };

    const result = await sendArtistSubmissionNotificationEmail(
      {
        shopId: "shop-1",
        submissionId: "submission-1",
      },
      db as any,
      transport,
    );

    expect(result).toEqual({ status: "skipped_already_sent" });
    expect(transport.send).not.toHaveBeenCalled();
  });
});
