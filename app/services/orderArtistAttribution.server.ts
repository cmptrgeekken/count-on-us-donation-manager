import { prisma } from "../db.server";
import { materializeArtistAllocationsForPeriod } from "./reportingPeriodService.server";

type DbClient = typeof prisma;

type SaveOrderArtistAttributionInput = {
  shopId: string;
  snapshotId: string;
  artistId: string | null;
  notes?: string | null;
  persistCustomerAssociation?: boolean;
};

export async function saveOrderArtistAttribution(
  input: SaveOrderArtistAttributionInput,
  db: DbClient = prisma,
) {
  return db.$transaction(async (tx) => {
    const snapshot = await tx.orderSnapshot.findFirst({
      where: { id: input.snapshotId, shopId: input.shopId },
      select: {
        id: true,
        periodId: true,
        createdAt: true,
        shopifyCustomerId: true,
        normalizedCustomerEmailHash: true,
      },
    });

    if (!snapshot) {
      throw new Error("Order snapshot not found.");
    }

    const existing = await tx.orderArtistAttribution.findUnique({
      where: { snapshotId: snapshot.id },
      select: { id: true, artistId: true },
    });

    if (!input.artistId) {
      if (existing) {
        await tx.orderArtistAttribution.delete({
          where: { id: existing.id },
        });
      }

      await tx.auditLog.create({
        data: {
          shopId: input.shopId,
          entity: "OrderArtistAttribution",
          entityId: snapshot.id,
          action: "ORDER_ARTIST_ATTRIBUTION_REMOVED",
          actor: "merchant",
          payload: {
            snapshotId: snapshot.id,
            previousArtistId: existing?.artistId ?? null,
          },
        },
      });
    } else {
      const artist = await tx.artist.findFirst({
        where: {
          id: input.artistId,
          shopId: input.shopId,
          status: { in: ["active", "draft"] },
        },
        select: { id: true },
      });

      if (!artist) {
        throw new Error("Artist not found.");
      }

      if (existing) {
        await tx.orderArtistAttribution.update({
          where: { id: existing.id },
          data: {
            artistId: artist.id,
            source: "manual",
            notes: input.notes?.trim() || null,
          },
        });
      } else {
        await tx.orderArtistAttribution.create({
          data: {
            shopId: input.shopId,
            snapshotId: snapshot.id,
            artistId: artist.id,
            source: "manual",
            notes: input.notes?.trim() || null,
          },
        });
      }

      if (input.persistCustomerAssociation) {
        const identityFilters = [
          ...(snapshot.shopifyCustomerId ? [{ shopifyCustomerId: snapshot.shopifyCustomerId }] : []),
          ...(snapshot.normalizedCustomerEmailHash ? [{ normalizedCustomerEmailHash: snapshot.normalizedCustomerEmailHash }] : []),
        ];

        if (identityFilters.length > 0) {
          const existingAssociation = await tx.customerArtistAssociation.findFirst({
            where: {
              shopId: input.shopId,
              OR: identityFilters,
            },
            select: { id: true },
          });

          if (existingAssociation) {
            await tx.customerArtistAssociation.update({
              where: { id: existingAssociation.id },
              data: {
                artistId: artist.id,
                source: "manual",
                shopifyCustomerId: snapshot.shopifyCustomerId,
                normalizedCustomerEmailHash: snapshot.normalizedCustomerEmailHash,
              },
            });
          } else {
            await tx.customerArtistAssociation.create({
              data: {
                shopId: input.shopId,
                artistId: artist.id,
                source: "manual",
                shopifyCustomerId: snapshot.shopifyCustomerId,
                normalizedCustomerEmailHash: snapshot.normalizedCustomerEmailHash,
              },
            });
          }
        }
      }

      await tx.auditLog.create({
        data: {
          shopId: input.shopId,
          entity: "OrderArtistAttribution",
          entityId: snapshot.id,
          action: "ORDER_ARTIST_ATTRIBUTION_UPDATED",
          actor: "merchant",
          payload: {
            snapshotId: snapshot.id,
            artistId: artist.id,
            previousArtistId: existing?.artistId ?? null,
            persistedCustomerAssociation: Boolean(input.persistCustomerAssociation),
          },
        },
      });
    }

    const period = snapshot.periodId
      ? await tx.reportingPeriod.findFirst({
          where: { id: snapshot.periodId, shopId: input.shopId },
          select: { id: true, status: true, startDate: true, endDate: true },
        })
      : await tx.reportingPeriod.findFirst({
          where: {
            shopId: input.shopId,
            startDate: { lte: snapshot.createdAt },
            endDate: { gt: snapshot.createdAt },
          },
          orderBy: { startDate: "desc" },
          select: { id: true, status: true, startDate: true, endDate: true },
        });

    if (period?.status === "CLOSED") {
      await materializeArtistAllocationsForPeriod(input.shopId, period, tx as never);
    }

    return { ok: true, periodRefreshed: period?.status === "CLOSED" };
  });
}
