import { z } from "zod";
import { prisma } from "../db.server";

export const artistProfileSchema = z.object({
  id: z.string().trim().optional(),
  displayName: z.string().trim().min(1, "Display name is required."),
  creditName: z.string().trim().min(1, "Credit name is required."),
  creditPreference: z.string().trim().min(1, "Credit preference is required."),
  publicBio: z.string().trim().optional(),
  websiteUrl: z.union([z.literal(""), z.url({ message: "Website URL must be a valid URL." })]).optional(),
  instagramUrl: z.union([z.literal(""), z.url({ message: "Instagram URL must be a valid URL." })]).optional(),
  contactName: z.string().trim().optional(),
  contactEmail: z.union([z.literal(""), z.email({ message: "Contact email must be a valid email." })]).optional(),
  status: z.enum(["draft", "active", "inactive", "revoked"]),
  paymentEnabled: z.boolean(),
  defaultPayoutRate: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Number(value)) && Number(value) >= 0 && Number(value) <= 100, "Payout rate must be between 0 and 100."),
  taxStatus: z.string().trim().min(1, "Tax status is required."),
  paymentNotes: z.string().trim().optional(),
  restrictedChannels: z.string().trim().optional(),
  restrictedFormats: z.string().trim().optional(),
  internalNotes: z.string().trim().optional(),
});

export type ArtistProfileActionData = {
  ok: boolean;
  message: string;
  fieldErrors?: Partial<Record<string, string[]>>;
};

function normalizeOptional(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readCauseAssignments(formData: FormData, causeIds: Set<string>) {
  return Array.from(causeIds)
    .map((causeId) => {
      const values = formData.getAll(`cause:${causeId}`);
      const raw = values.at(-1)?.toString().trim() ?? "";
      if (!raw) return null;
      const percentage = Number(raw);
      if (Number.isNaN(percentage) || percentage <= 0) {
        throw new Error("Cause percentages must be greater than 0.");
      }
      return { causeId, percentage };
    })
    .filter((assignment): assignment is { causeId: string; percentage: number } => Boolean(assignment));
}

export async function saveArtistProfileFromForm({
  shopId,
  formData,
  intent,
}: {
  shopId: string;
  formData: FormData;
  intent: "create" | "update";
}) {
  const causes = await prisma.cause.findMany({
    where: { shopId, status: "active" },
    select: { id: true },
  });
  const causeIds = new Set(causes.map((cause) => cause.id));

  const parsed = artistProfileSchema.safeParse({
    id: formData.get("id")?.toString() ?? "",
    displayName: formData.get("displayName")?.toString() ?? "",
    creditName: formData.get("creditName")?.toString() ?? "",
    creditPreference: formData.get("creditPreference")?.toString() ?? "",
    publicBio: formData.get("publicBio")?.toString() ?? "",
    websiteUrl: formData.get("websiteUrl")?.toString() ?? "",
    instagramUrl: formData.get("instagramUrl")?.toString() ?? "",
    contactName: formData.get("contactName")?.toString() ?? "",
    contactEmail: formData.get("contactEmail")?.toString() ?? "",
    status: formData.get("status")?.toString() ?? "draft",
    paymentEnabled: formData.get("paymentEnabled")?.toString() === "true",
    defaultPayoutRate: formData.get("defaultPayoutRate")?.toString() || "10",
    taxStatus: formData.get("taxStatus")?.toString() ?? "not_required",
    paymentNotes: formData.get("paymentNotes")?.toString() ?? "",
    restrictedChannels: formData.get("restrictedChannels")?.toString() ?? "",
    restrictedFormats: formData.get("restrictedFormats")?.toString() ?? "",
    internalNotes: formData.get("internalNotes")?.toString() ?? "",
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Invalid artist details.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    } satisfies ArtistProfileActionData;
  }

  let causeAssignments: Array<{ causeId: string; percentage: number }>;
  try {
    causeAssignments = readCauseAssignments(formData, causeIds);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Cause assignments.";
    return { ok: false, message, fieldErrors: { causes: [message] } } satisfies ArtistProfileActionData;
  }

  const totalCausePercentage = causeAssignments.reduce((sum, assignment) => sum + assignment.percentage, 0);
  if (totalCausePercentage > 100) {
    return {
      ok: false,
      message: "Cause percentages must total 100% or less.",
      fieldErrors: { causes: ["Cause percentages must total 100% or less."] },
    } satisfies ArtistProfileActionData;
  }

  const artistData = {
    displayName: parsed.data.displayName,
    creditName: parsed.data.creditName,
    creditPreference: parsed.data.creditPreference,
    publicBio: normalizeOptional(parsed.data.publicBio),
    websiteUrl: normalizeOptional(parsed.data.websiteUrl),
    instagramUrl: normalizeOptional(parsed.data.instagramUrl),
    contactName: normalizeOptional(parsed.data.contactName),
    contactEmail: normalizeOptional(parsed.data.contactEmail),
    status: parsed.data.status,
    paymentEnabled: parsed.data.paymentEnabled,
    defaultPayoutRate: Number(parsed.data.defaultPayoutRate),
    taxStatus: parsed.data.taxStatus,
    paymentNotes: normalizeOptional(parsed.data.paymentNotes),
    restrictedChannels: normalizeOptional(parsed.data.restrictedChannels),
    restrictedFormats: normalizeOptional(parsed.data.restrictedFormats),
    internalNotes: normalizeOptional(parsed.data.internalNotes),
  };

  const artist = await prisma.$transaction(async (tx) => {
    const savedArtist =
      intent === "create"
        ? await tx.artist.create({
            data: {
              shopId,
              ...artistData,
            },
          })
        : await tx.artist.update({
            where: {
              id: parsed.data.id,
              shopId,
            },
            data: artistData,
          });

    await tx.artistCauseAssignment.deleteMany({
      where: {
        shopId,
        artistId: savedArtist.id,
      },
    });

    if (causeAssignments.length > 0) {
      await tx.artistCauseAssignment.createMany({
        data: causeAssignments.map((assignment) => ({
          shopId,
          artistId: savedArtist.id,
          causeId: assignment.causeId,
          percentage: assignment.percentage,
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        shopId,
        entity: "Artist",
        entityId: savedArtist.id,
        action: intent === "create" ? "ARTIST_CREATED" : "ARTIST_UPDATED",
        actor: "merchant",
        payload: {
          status: savedArtist.status,
          paymentEnabled: savedArtist.paymentEnabled,
          defaultPayoutRate: savedArtist.defaultPayoutRate.toString(),
          causeAssignments,
        },
      },
    });

    return savedArtist;
  });

  return {
    ok: true,
    message: intent === "create" ? `Artist ${artist.displayName} created.` : `Artist ${artist.displayName} updated.`,
    artistId: artist.id,
  };
}
