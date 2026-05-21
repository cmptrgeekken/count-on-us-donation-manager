import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma, type TransactionCapableDbClient } from "../db.server";
import { listOutstandingArtistAllocations } from "./artistPayables.server";

const ZERO = new Prisma.Decimal(0);

export const artistPaymentErrorCodes = {
  NEGATIVE_AMOUNT: "NEGATIVE_AMOUNT",
  ZERO_TOTAL: "ZERO_TOTAL",
  PERIOD_NOT_FOUND: "PERIOD_NOT_FOUND",
  PERIOD_NOT_CLOSED: "PERIOD_NOT_CLOSED",
  PAYABLE_NOT_FOUND: "PAYABLE_NOT_FOUND",
  AMOUNT_EXCEEDS_REMAINING: "AMOUNT_EXCEEDS_REMAINING",
} as const;

type ArtistPaymentErrorCode = (typeof artistPaymentErrorCodes)[keyof typeof artistPaymentErrorCodes];

export class ArtistPaymentError extends Error {
  constructor(
    public code: ArtistPaymentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ArtistPaymentError";
  }
}

export type LogArtistPaymentInput = {
  periodId: string;
  artistId: string;
  amount: Prisma.Decimal | string | number;
  paidAt: Date;
  paymentMethod: string;
  referenceId?: string | null;
  notes?: string | null;
};

function toDecimal(value: Prisma.Decimal | string | number) {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function floorCurrency(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_FLOOR);
}

export async function logArtistPayment(
  shopId: string,
  input: LogArtistPaymentInput,
  options?: {
    db?: TransactionCapableDbClient;
    actor?: string;
  },
) {
  const db = options?.db ?? prisma;
  const actor = options?.actor ?? "merchant";
  const amount = floorCurrency(toDecimal(input.amount));

  if (amount.lessThan(ZERO)) {
    throw new ArtistPaymentError(artistPaymentErrorCodes.NEGATIVE_AMOUNT, "Artist payment amount cannot be negative.");
  }

  if (amount.lessThanOrEqualTo(ZERO)) {
    throw new ArtistPaymentError(artistPaymentErrorCodes.ZERO_TOTAL, "Artist payment amount must be greater than 0.");
  }

  const artistPaymentId = randomUUID();

  return db.$transaction(async (tx) => {
    const period = await tx.reportingPeriod.findFirst({
      where: {
        id: input.periodId,
        shopId,
      },
      select: {
        id: true,
        status: true,
        endDate: true,
      },
    });

    if (!period) {
      throw new ArtistPaymentError(artistPaymentErrorCodes.PERIOD_NOT_FOUND, "Reporting period not found.");
    }

    if (period.status !== "CLOSED") {
      throw new ArtistPaymentError(artistPaymentErrorCodes.PERIOD_NOT_CLOSED, "Artist payments can only be logged for closed reporting periods.");
    }

    const outstandingAllocations = await listOutstandingArtistAllocations(
      shopId,
      {
        throughPeriodEndDate: period.endDate,
        artistId: input.artistId,
      },
      tx,
    );

    if (outstandingAllocations.length === 0) {
      throw new ArtistPaymentError(artistPaymentErrorCodes.PAYABLE_NOT_FOUND, "No outstanding payable was found for this artist.");
    }

    const payableRemaining = outstandingAllocations.reduce(
      (sum, allocation) => sum.add(allocation.remaining),
      ZERO,
    );
    if (amount.greaterThan(payableRemaining)) {
      throw new ArtistPaymentError(artistPaymentErrorCodes.AMOUNT_EXCEEDS_REMAINING, "Artist payment amount cannot exceed the remaining payable.");
    }

    const applications: Array<{
      artistAllocationId: string;
      periodId: string;
      amount: Prisma.Decimal;
    }> = [];
    let unapplied = amount;

    for (const allocation of outstandingAllocations) {
      if (unapplied.lessThanOrEqualTo(ZERO)) {
        break;
      }

      const appliedAmount = Prisma.Decimal.min(unapplied, allocation.remaining);
      if (appliedAmount.lessThanOrEqualTo(ZERO)) {
        continue;
      }

      applications.push({
        artistAllocationId: allocation.id,
        periodId: allocation.periodId,
        amount: appliedAmount,
      });
      unapplied = unapplied.sub(appliedAmount);
    }

    const artistPayment = await tx.artistPayment.create({
      data: {
        id: artistPaymentId,
        shopId,
        periodId: input.periodId,
        artistId: input.artistId,
        amount,
        paidAt: input.paidAt,
        paymentMethod: input.paymentMethod.trim(),
        referenceId: input.referenceId?.trim() || null,
        notes: input.notes?.trim() || null,
      },
    });

    if (applications.length > 0) {
      await tx.artistPaymentApplication.createMany({
        data: applications.map((application) => ({
          shopId,
          artistPaymentId: artistPayment.id,
          artistAllocationId: application.artistAllocationId,
          amount: application.amount,
        })),
      });

      await Promise.all(
        applications.map((application) =>
          tx.artistAllocation.updateMany({
            where: {
              id: application.artistAllocationId,
              shopId,
            },
            data: {
              paid: {
                increment: application.amount,
              },
            },
          }),
        ),
      );
    }

    await tx.auditLog.create({
      data: {
        shopId,
        entity: "ArtistPayment",
        entityId: artistPayment.id,
        action: "ARTIST_PAYMENT_LOGGED",
        actor,
        payload: {
          periodId: input.periodId,
          artistId: input.artistId,
          amount: amount.toString(),
          applications: applications.map((application) => ({
            artistAllocationId: application.artistAllocationId,
            periodId: application.periodId,
            amount: application.amount.toString(),
          })),
        },
      },
    });

    return {
      artistPayment,
      artistAllocationId: applications[0]?.artistAllocationId ?? null,
      remaining: payableRemaining.sub(amount),
    };
  });
}
