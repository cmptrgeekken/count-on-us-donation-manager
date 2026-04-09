import { prisma } from "../db.server";
import { createReceiptStorage, type ReceiptStorage } from "./receiptStorage.server";

export type DonationReceiptsPageData = Awaited<ReturnType<typeof buildDonationReceiptsPage>>;

export async function buildDonationReceiptsPage(
  shopId: string,
  db = prisma,
  storage: ReceiptStorage = createReceiptStorage(),
) {
  const periods = await db.reportingPeriod.findMany({
    where: {
      shopId,
      status: "CLOSED",
      disbursements: {
        some: {},
      },
    },
    orderBy: [{ endDate: "desc" }, { startDate: "desc" }],
    select: {
      id: true,
      startDate: true,
      endDate: true,
      disbursements: {
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          amount: true,
          paidAt: true,
          paymentMethod: true,
          referenceId: true,
          receiptFileKey: true,
          cause: {
            select: {
              name: true,
            },
          },
        },
      },
      causeAllocations: {
        orderBy: { causeName: "asc" },
        select: {
          causeId: true,
          causeName: true,
          allocated: true,
        },
      },
    },
  });

  const periodRows = await Promise.all(
    periods.map(async (period) => {
      const totalDonated = period.disbursements.reduce((sum, disbursement) => sum + Number(disbursement.amount), 0);

      return {
        id: period.id,
        startDate: period.startDate.toISOString(),
        endDate: period.endDate.toISOString(),
        totalDonated: totalDonated.toFixed(2),
        causeBreakdown: period.causeAllocations.map((allocation) => ({
          causeId: allocation.causeId,
          causeName: allocation.causeName,
          allocated: allocation.allocated.toString(),
        })),
        disbursements: await Promise.all(
          period.disbursements.map(async (disbursement) => ({
            id: disbursement.id,
            causeName: disbursement.cause.name,
            amount: disbursement.amount.toString(),
            paidAt: disbursement.paidAt.toISOString(),
            paymentMethod: disbursement.paymentMethod,
            referenceId: disbursement.referenceId,
            receiptUrl: disbursement.receiptFileKey
              ? await storage.getSignedReadUrl({
                  key: disbursement.receiptFileKey,
                  expiresInSeconds: 60 * 60,
                })
              : null,
          })),
        ),
      };
    }),
  );

  return {
    periods: periodRows,
    hasReceipts: periodRows.length > 0,
  };
}
