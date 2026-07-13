import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import { prisma, type DbClient, type TransactionCapableDbClient } from "../db.server";
import { createArtistSubmissionStorage } from "./artistSubmissionStorage.server";

export const artistSubmissionLocalConnections = [
  "Twin Cities",
  "Elsewhere in Minnesota",
  "Minnesota connection, but not currently local",
  "Outside Minnesota",
  "Prefer not to say",
] as const;

export const artistSubmissionProductFormats = [
  "Full-color stickers",
  "Buttons",
  "Laser-cut acrylic earrings",
  "Laser-cut acrylic pins",
  "Single-tone silhouette acrylic designs",
  "Two-tone acrylic designs",
  "Full-color sublimated earrings or pins",
  "Future formats like magnets, keychains, shirts, or bags",
  "Not sure yet",
] as const;

export const artistSharePreferences = [
  "Donate my artist share to my selected cause",
  "Receive artist payment",
  "Not sure yet / discuss later",
] as const;

export const proofApprovalPreferences = [
  "Yes, I want to approve proofs before launch",
  "No, Sparkly Rocketship can handle production adaptation",
  "Not sure yet / discuss later",
] as const;

export const causePreferences = [
  "I have specific causes in mind",
  "Sparkly Rocketship can choose aligned causes",
  "Not sure yet / discuss later",
] as const;

export const contactMethodPreferences = [
  "Email",
  "Phone / text",
  "Instagram DM",
  "Signal",
  "Discord",
  "Other",
] as const;

export const DEFAULT_ARTIST_SUBMISSION_TERMS_VERSION = "artist-collaboration-terms-2026-05";
export const ARTIST_SUBMISSION_MAX_FILES = 5;
export const ARTIST_SUBMISSION_MAX_FILE_BYTES = 10 * 1024 * 1024;

const allowedUploadTypes = new Map([
  ["image/png", "png"],
  ["image/svg+xml", "svg"],
  ["application/pdf", "pdf"],
  ["image/webp", "webp"],
]);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null));

const requiredText = (fieldName: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${fieldName} is required.`)
    .max(max, `${fieldName} must be ${max} characters or fewer.`);

const textList = (maxItems: number, maxItemLength: number) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      const rawItems = Array.isArray(value) ? value : value?.split(/\r?\n|,/);
      return (rawItems ?? [])
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, maxItems)
        .map((item) => item.slice(0, maxItemLength));
    });

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function isPrivateOrLocalHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;

  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;

  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;

  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function normalizeArtistSubmissionUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || hasControlCharacters(trimmed) || /\s/.test(trimmed)) return null;

  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname || parsed.hostname.length > 253) return null;
  if (!parsed.hostname.includes(".") || isPrivateOrLocalHostname(parsed.hostname)) return null;

  return parsed.toString();
}

const publicLinksSchema = (label: string) =>
  z
    .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value, ctx) => {
    const rawItems = Array.isArray(value) ? value : value?.split(/\r?\n|,/);
    const normalizedLinks: string[] = [];

    for (const item of (rawItems ?? []).map((raw) => raw.trim()).filter(Boolean).slice(0, 8)) {
      if (item.length > 500) {
        ctx.addIssue({
          code: "custom",
          message: `${label} must be 500 characters or fewer.`,
        });
        continue;
      }

      const normalized = normalizeArtistSubmissionUrl(item);
      if (!normalized) {
        ctx.addIssue({
          code: "custom",
          message: `${label} must be valid public http or https URLs.`,
        });
        continue;
      }

      normalizedLinks.push(normalized);
    }

    return Array.from(new Set(normalizedLinks));
  });

function isReasonableEmailAddress(value: string) {
  if (hasControlCharacters(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;

  const [localPart, domain] = parts;
  if (!localPart || !domain || localPart.length > 64 || domain.length > 253) return false;
  if (!domain.includes(".") || domain.endsWith(".")) return false;

  return domain.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function optionalEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .union([z.enum(values), z.literal("")])
    .optional()
    .transform((value) => (value ? value : null));
}

const artistSubmissionInputSchema = z.object({
  publicCreditName: requiredText("Public credit name", 120).optional(),
  name: optionalText(120),
  email: z
    .string()
    .trim()
    .max(254, "Email must be 254 characters or fewer.")
    .pipe(z.email("Email must be a valid email address."))
    .refine(isReasonableEmailAddress, "Email must use a valid public email domain.")
    .transform((value) => value.toLowerCase()),
  artistName: optionalText(120),
  publicLinks: publicLinksSchema("Portfolio links"),
  causeLinks: publicLinksSchema("Cause links"),
  preferredContactMethod: z.enum(contactMethodPreferences, {
    error: "Preferred communication method is required.",
  }),
  contactDetail: optionalText(500),
  phoneNumber: optionalText(80),
  instagramHandle: optionalText(120),
  otherContact: optionalText(500),
  localConnection: optionalEnum(artistSubmissionLocalConnections),
  artworkIdea: z
    .string()
    .trim()
    .min(1, "Tell us about your artwork or idea.")
    .max(5000, "Artwork or idea must be 5,000 characters or fewer."),
  interestedFormats: textList(12, 120).transform((values) =>
    values.filter((value) => artistSubmissionProductFormats.includes(value as (typeof artistSubmissionProductFormats)[number])),
  ),
  formatRestrictions: optionalText(2000),
  salesChannelRestrictions: optionalText(2000),
  causePreference: optionalEnum(causePreferences),
  causeInterests: optionalText(2000),
  artistSharePreference: optionalEnum(artistSharePreferences),
  proofApprovalPreference: optionalEnum(proofApprovalPreferences),
  artworkSampleLinks: optionalText(3000),
  notes: optionalText(3000),
  termsAcknowledged: z.literal(true, {
    error: "Collaboration terms acknowledgement is required.",
  }),
  termsVersion: optionalText(120),
  termsText: optionalText(5000),
  paymentAcknowledged: z.boolean().optional().default(false),
  honeypot: z.string().trim().optional().default(""),
});

export type ArtistSubmissionInput = z.input<typeof artistSubmissionInputSchema>;
export type ValidArtistSubmissionInput = z.output<typeof artistSubmissionInputSchema> & {
  publicCreditName: string;
};

export class ArtistSubmissionValidationError extends Error {
  constructor(
    message: string,
    public fieldErrors: Record<string, string[] | undefined>,
  ) {
    super(message);
    this.name = "ArtistSubmissionValidationError";
  }
}

export class ArtistSubmissionSpamError extends Error {
  constructor() {
    super("Submission rejected.");
    this.name = "ArtistSubmissionSpamError";
  }
}

export class ArtistSubmissionUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtistSubmissionUploadError";
  }
}

export function validateArtistSubmissionInput(input: unknown): ValidArtistSubmissionInput {
  const parsed = artistSubmissionInputSchema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    throw new ArtistSubmissionValidationError(
      parsed.error.issues[0]?.message ?? "Invalid artist submission.",
      fieldErrors,
    );
  }

  if (parsed.data.honeypot) {
    throw new ArtistSubmissionSpamError();
  }

  const publicCreditName = parsed.data.publicCreditName || parsed.data.artistName || parsed.data.name;
  if (!publicCreditName) {
    throw new ArtistSubmissionValidationError("Public credit name is required.", {
      publicCreditName: ["Public credit name is required."],
    });
  }

  if (parsed.data.preferredContactMethod !== "Email" && !parsed.data.contactDetail) {
    throw new ArtistSubmissionValidationError("Contact detail is required for the selected communication method.", {
      contactDetail: ["Please enter the contact detail for your preferred communication method."],
    });
  }

  return {
    ...parsed.data,
    publicCreditName,
    artistName: publicCreditName,
    name: parsed.data.name ?? publicCreditName,
  };
}

export function hashSubmissionIp(ipAddress: string | null | undefined) {
  if (!ipAddress) return null;
  return createHash("sha256").update(ipAddress).digest("hex");
}

export async function createArtistSubmission(
  shopId: string,
  input: unknown,
  options?: {
    db?: TransactionCapableDbClient;
    ipAddress?: string | null;
    userAgent?: string | null;
    now?: Date;
  },
) {
  const db = options?.db ?? prisma;
  const now = options?.now ?? new Date();
  const data = validateArtistSubmissionInput(input);

  const submission = await db.artistSubmission.create({
    data: {
      shopId,
      submitterName: data.publicCreditName,
      email: data.email,
      artistName: data.artistName,
      publicLinks: data.publicLinks,
      causeLinks: data.causeLinks,
      preferredContactMethod: data.preferredContactMethod,
      contactDetail: data.contactDetail,
      phoneNumber: data.phoneNumber,
      instagramHandle: data.instagramHandle,
      otherContact: data.otherContact,
      localConnection: data.localConnection,
      artworkIdea: data.artworkIdea,
      interestedFormats: data.interestedFormats,
      formatRestrictions: data.formatRestrictions,
      salesChannelRestrictions: data.salesChannelRestrictions,
      causePreference: data.causePreference,
      causeInterests: data.causeInterests,
      artistSharePreference: data.artistSharePreference,
      proofApprovalPreference: data.proofApprovalPreference,
      artworkSampleLinks: data.artworkSampleLinks,
      notes: data.notes,
      termsAcknowledgedAt: now,
      termsVersion: data.termsVersion ?? DEFAULT_ARTIST_SUBMISSION_TERMS_VERSION,
      termsText: data.termsText,
      paymentAcknowledgedAt: data.paymentAcknowledged ? now : null,
      submitterIpHash: hashSubmissionIp(options?.ipAddress),
      userAgent: options?.userAgent?.slice(0, 500) ?? null,
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
    },
  });

  await db.auditLog.create({
    data: {
      shopId,
      entity: "ArtistSubmission",
      entityId: submission.id,
      action: "ARTIST_SUBMISSION_CREATED",
      actor: "storefront",
      payload: {
        email: data.email,
        artistName: data.artistName,
        preferredContactMethod: data.preferredContactMethod,
        hasContactDetail: Boolean(data.contactDetail),
        localConnection: data.localConnection,
        interestedFormats: data.interestedFormats,
        artistSharePreference: data.artistSharePreference,
        proofApprovalPreference: data.proofApprovalPreference,
        causeLinks: data.causeLinks,
        causePreference: data.causePreference,
      },
    },
  });

  return submission;
}

function safeFileName(filename: string) {
  return (
    filename
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/\.{2,}/g, "-")
      .replace(/^\.+/, "")
      .replace(/^[-_]+/, "")
      .replace(/[-_]+\./g, ".")
      .slice(0, 120) || "artwork"
  );
}

export function buildArtistSubmissionFileKey(input: {
  shopId: string;
  submissionId: string;
  fileId: string;
  filename: string;
}) {
  return [
    input.shopId.replace(/[^a-zA-Z0-9._-]/g, "-"),
    "artist-submissions",
    input.submissionId,
    input.fileId,
    safeFileName(input.filename),
  ].join("/");
}

export type ArtistSubmissionUpload = {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
};

export async function attachArtistSubmissionFiles(
  shopId: string,
  submissionId: string,
  uploads: ArtistSubmissionUpload[],
  options?: {
    db?: DbClient;
  },
) {
  if (uploads.length === 0) return [];
  if (uploads.length > ARTIST_SUBMISSION_MAX_FILES) {
    throw new ArtistSubmissionUploadError(`Upload at most ${ARTIST_SUBMISSION_MAX_FILES} files.`);
  }

  const db = options?.db ?? prisma;
  const storage = createArtistSubmissionStorage();
  const rows = [];

  for (const upload of uploads) {
    const contentType = upload.contentType.toLowerCase();
    if (!allowedUploadTypes.has(contentType)) {
      throw new ArtistSubmissionUploadError("Uploads must be PNG, SVG, PDF, or WebP files.");
    }

    if (upload.bytes.byteLength > ARTIST_SUBMISSION_MAX_FILE_BYTES) {
      throw new ArtistSubmissionUploadError("Each uploaded file must be 10 MB or smaller.");
    }

    const fileId = randomUUID();
    const storageKey = buildArtistSubmissionFileKey({
      shopId,
      submissionId,
      fileId,
      filename: upload.filename,
    });

    await storage.put({
      key: storageKey,
      body: upload.bytes,
      contentType,
    });

    rows.push({
      id: fileId,
      shopId,
      submissionId,
      originalFileName: safeFileName(upload.filename),
      contentType,
      byteSize: upload.bytes.byteLength,
      storageKey,
      scanStatus: "accepted",
      scanResult: "Validated by upload allowlist. Malware scanning provider not configured.",
    });
  }

  await db.artistSubmissionFile.createMany({ data: rows });

  await db.auditLog.create({
    data: {
      shopId,
      entity: "ArtistSubmission",
      entityId: submissionId,
      action: "ARTIST_SUBMISSION_FILES_ATTACHED",
      actor: "storefront",
      payload: {
        fileCount: rows.length,
        files: rows.map((row) => ({
          id: row.id,
          originalFileName: row.originalFileName,
          contentType: row.contentType,
          byteSize: row.byteSize,
          scanStatus: row.scanStatus,
        })),
      },
    },
  });

  return rows;
}

export async function updateArtistSubmissionStatus(
  shopId: string,
  input: {
    submissionId: string;
    status: string;
    internalNotes?: string | null;
  },
  options?: {
    db?: TransactionCapableDbClient;
    actor?: string;
  },
) {
  const allowedStatuses = new Set(["new", "reviewing", "contacted", "converted", "declined", "spam", "archived"]);
  if (!allowedStatuses.has(input.status)) {
    throw new Error("Unsupported submission status.");
  }

  const db = options?.db ?? prisma;
  const submission = await db.artistSubmission.update({
    where: {
      id: input.submissionId,
      shopId,
    },
    data: {
      status: input.status,
      internalNotes: input.internalNotes?.trim() || null,
    },
    select: {
      id: true,
      status: true,
      submitterName: true,
    },
  });

  await db.auditLog.create({
    data: {
      shopId,
      entity: "ArtistSubmission",
      entityId: submission.id,
      action: "ARTIST_SUBMISSION_STATUS_UPDATED",
      actor: options?.actor ?? "merchant",
      payload: {
        status: submission.status,
      },
    },
  });

  return submission;
}

function firstUrl(publicLinks: string[]) {
  return publicLinks.find((link) => /^https?:\/\//i.test(link)) ?? null;
}

export async function convertArtistSubmissionToDraftArtist(
  shopId: string,
  submissionId: string,
  options?: {
    db?: TransactionCapableDbClient;
    actor?: string;
  },
) {
  const db = options?.db ?? prisma;
  const actor = options?.actor ?? "merchant";

  return db.$transaction(async (tx) => {
    const submission = await tx.artistSubmission.findFirst({
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
        causePreference: true,
        preferredContactMethod: true,
        contactDetail: true,
        phoneNumber: true,
        instagramHandle: true,
        otherContact: true,
        artistSharePreference: true,
        formatRestrictions: true,
        salesChannelRestrictions: true,
        notes: true,
        artworkIdea: true,
        convertedArtistId: true,
      },
    });

    if (!submission) {
      throw new Error("Artist submission not found.");
    }

    if (submission.convertedArtistId) {
      throw new Error("Artist submission has already been converted.");
    }

    const publicLink = firstUrl(submission.publicLinks);
    const paymentEnabled = submission.artistSharePreference === "Receive artist payment";
    const artist = await tx.artist.create({
      data: {
        shopId,
        displayName: submission.artistName || submission.submitterName,
        creditName: submission.artistName || submission.submitterName,
        contactName: submission.submitterName,
        contactEmail: submission.email,
        websiteUrl: publicLink,
        status: "draft",
        paymentEnabled,
        taxStatus: paymentEnabled ? "w9_requested" : "not_required",
        restrictedChannels: submission.salesChannelRestrictions,
        restrictedFormats: submission.formatRestrictions,
        internalNotes: [
          "Created from artist submission.",
          submission.preferredContactMethod ? `Preferred contact: ${submission.preferredContactMethod}` : "",
          submission.contactDetail ? `Contact detail: ${submission.contactDetail}` : "",
          submission.phoneNumber ? `Phone/text: ${submission.phoneNumber}` : "",
          submission.instagramHandle ? `Instagram: ${submission.instagramHandle}` : "",
          submission.otherContact ? `Other contact: ${submission.otherContact}` : "",
          submission.causePreference ? `Cause preference: ${submission.causePreference}` : "",
          submission.causeLinks.length > 0 ? `Cause links: ${submission.causeLinks.join(", ")}` : "",
          submission.artworkIdea ? `Idea: ${submission.artworkIdea}` : "",
          submission.notes ? `Submission notes: ${submission.notes}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
      select: {
        id: true,
        displayName: true,
      },
    });

    await tx.artistSubmission.update({
      where: {
        id: submission.id,
        shopId,
      },
      data: {
        status: "converted",
        convertedArtistId: artist.id,
        convertedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        shopId,
        entity: "ArtistSubmission",
        entityId: submission.id,
        action: "ARTIST_SUBMISSION_CONVERTED",
        actor,
        payload: {
          artistId: artist.id,
          displayName: artist.displayName,
        },
      },
    });

    return artist;
  });
}
