import { jsonResponse } from "~/utils/json-response.server";
import type { ActionFunctionArgs } from "@remix-run/node";
import { Prisma } from "@prisma/client";

import {
  attachArtistSubmissionFiles,
  createArtistSubmission,
  ArtistSubmissionSpamError,
  ArtistSubmissionUploadError,
  ArtistSubmissionValidationError,
  type ArtistSubmissionUpload,
} from "../services/artistSubmission.server";
import { prisma } from "../db.server";
import { DEFAULT_JOB_OPTIONS, jobQueue } from "../jobs/queue.server";
import { authenticatePublicAppProxyRequest } from "../utils/public-auth.server";
import { checkRateLimit } from "../utils/rate-limit.server";

function getClientIpAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "anonymous";
  }

  return request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "anonymous";
}

function errorResponse(status: number, code: string, message: string, headers?: Headers, fieldErrors?: Record<string, string[] | undefined>) {
  return jsonResponse(
    {
      error: {
        code,
        message,
        fieldErrors,
      },
    },
    {
      status,
      headers,
    },
  );
}

function readBoolean(value: FormDataEntryValue | null) {
  return value === "true" || value === "on" || value === "1";
}

async function readSubmissionPayload(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return {
      payload: (await request.json()) as Record<string, unknown>,
      uploads: [] as ArtistSubmissionUpload[],
    };
  }

  const formData = await request.formData();
  const uploads: ArtistSubmissionUpload[] = [];
  for (const value of formData.getAll("artworkFiles")) {
    if (
      value &&
      typeof value === "object" &&
      "arrayBuffer" in value &&
      "name" in value &&
      "type" in value &&
      "size" in value
    ) {
      const file = value as File;
      if (file.size > 0) {
        uploads.push({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
      }
    }
  }

  return {
    payload: {
      publicCreditName: formData.get("publicCreditName")?.toString() ?? "",
      name: formData.get("name")?.toString() ?? "",
      email: formData.get("email")?.toString() ?? "",
      artistName: formData.get("artistName")?.toString() ?? "",
      publicLinks: formData.getAll("publicLinks").map((value) => value.toString()),
      causeLinks: formData.getAll("causeLinks").map((value) => value.toString()),
      preferredContactMethod: formData.get("preferredContactMethod")?.toString() ?? "",
      contactDetail: formData.get("contactDetail")?.toString() ?? "",
      phoneNumber: formData.get("phoneNumber")?.toString() ?? "",
      instagramHandle: formData.get("instagramHandle")?.toString() ?? "",
      otherContact: formData.get("otherContact")?.toString() ?? "",
      localConnection: formData.get("localConnection")?.toString() ?? "",
      artworkIdea: formData.get("artworkIdea")?.toString() ?? "",
      interestedFormats: formData.getAll("interestedFormats").map((value) => value.toString()),
      formatRestrictions: formData.get("formatRestrictions")?.toString() ?? "",
      salesChannelRestrictions: formData.get("salesChannelRestrictions")?.toString() ?? "",
      causePreference: formData.get("causePreference")?.toString() ?? "",
      causeInterests: formData.get("causeInterests")?.toString() ?? "",
      artistSharePreference: formData.get("artistSharePreference")?.toString() ?? "",
      proofApprovalPreference: formData.get("proofApprovalPreference")?.toString() ?? "",
      notes: formData.get("notes")?.toString() ?? "",
      termsAcknowledged: readBoolean(formData.get("termsAcknowledged")),
      termsVersion: formData.get("termsVersion")?.toString() ?? "",
      termsText: formData.get("termsText")?.toString() ?? "",
      paymentAcknowledged: readBoolean(formData.get("paymentAcknowledged")),
      honeypot: formData.get("company")?.toString() ?? "",
    },
    uploads,
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shopifyDomain } = await authenticatePublicAppProxyRequest(request);
  const ipAddress = getClientIpAddress(request);
  const rateLimit = checkRateLimit({
    key: `artist-submission:${shopifyDomain}:${ipAddress}`,
    limit: 5,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "Too many artist submission attempts. Please try again shortly.",
      rateLimit.headers,
    );
  }

  const [shop] = await prisma.$queryRaw<Array<{ shopId: string }>>(
    Prisma.sql`SELECT "shopId" FROM "Shop" WHERE "shopifyDomain" = ${shopifyDomain} LIMIT 1`,
  );

  if (!shop) {
    return errorResponse(404, "NOT_FOUND", "Shop not found for artist submission request.", rateLimit.headers);
  }

  try {
    const { payload, uploads } = await readSubmissionPayload(request);
    const submission = await createArtistSubmission(shop.shopId, payload, {
      ipAddress,
      userAgent: request.headers.get("user-agent"),
    });
    await attachArtistSubmissionFiles(shop.shopId, submission.id, uploads);
    try {
      await jobQueue.send(
        "artist-submission.notification",
        {
          shopId: shop.shopId,
          submissionId: submission.id,
        },
        DEFAULT_JOB_OPTIONS,
      );
    } catch (error) {
      console.error("[artist-submission.notification] Failed to enqueue:", error);
      await prisma.auditLog.create({
        data: {
          shopId: shop.shopId,
          entity: "ArtistSubmission",
          entityId: submission.id,
          action: "ARTIST_SUBMISSION_NOTIFICATION_ENQUEUE_FAILED",
          actor: "system",
          payload: {
            message: error instanceof Error ? error.message : "Unknown artist submission notification enqueue failure",
          },
        },
      });
    }

    const headers = new Headers(rateLimit.headers);
    headers.set("Cache-Control", "private, no-store");

    return jsonResponse(
      {
        data: {
          id: submission.id,
          status: submission.status,
          createdAt: submission.createdAt,
        },
      },
      {
        status: 201,
        headers,
      },
    );
  } catch (error) {
    if (error instanceof ArtistSubmissionValidationError) {
      return errorResponse(400, "VALIDATION_ERROR", error.message, rateLimit.headers, error.fieldErrors);
    }

    if (error instanceof ArtistSubmissionSpamError) {
      return errorResponse(400, "VALIDATION_ERROR", "Submission rejected.", rateLimit.headers);
    }

    if (error instanceof ArtistSubmissionUploadError) {
      return errorResponse(400, "UPLOAD_ERROR", error.message, rateLimit.headers);
    }

    throw error;
  }
};
