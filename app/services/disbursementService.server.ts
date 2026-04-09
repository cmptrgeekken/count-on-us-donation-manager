import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma, type TransactionCapableDbClient } from "../db.server";
import { listOutstandingCauseAllocations } from "./causePayables.server";
import {
  buildDisbursementReceiptKey,
  createReceiptStorage,
  type ReceiptStorage,
} from "./receiptStorage.server";

const ZERO = new Prisma.Decimal(0);
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_RECEIPT_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

export const disbursementErrorCodes = {
  NEGATIVE_AMOUNT: "NEGATIVE_AMOUNT",
  ZERO_TOTAL: "ZERO_TOTAL",
  RECEIPT_TOO_LARGE: "RECEIPT_TOO_LARGE",
  RECEIPT_INVALID_TYPE: "RECEIPT_INVALID_TYPE",
  PERIOD_NOT_FOUND: "PERIOD_NOT_FOUND",
  PERIOD_NOT_CLOSED: "PERIOD_NOT_CLOSED",
  PAYABLE_NOT_FOUND: "PAYABLE_NOT_FOUND",
  ALLOCATED_EXCEEDS_REMAINING: "ALLOCATED_EXCEEDS_REMAINING",
} as const;

type DisbursementErrorCode = (typeof disbursementErrorCodes)[keyof typeof disbursementErrorCodes];

export class DisbursementError extends Error {
  constructor(
    public code: DisbursementErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DisbursementError";
  }
}

export type DisbursementReceiptInput = {
  filename: string;
  contentType: string;
  body: Uint8Array;
};

export type LogDisbursementInput = {
  periodId: string;
  causeId: string;
  allocatedAmount: Prisma.Decimal | string | number;
  extraContributionAmount?: Prisma.Decimal | string | number;
  feesCoveredAmount?: Prisma.Decimal | string | number;
  paidAt: Date;
  paymentMethod: string;
  referenceId?: string | null;
  receipt?: DisbursementReceiptInput | null;
};

function toDecimal(value: Prisma.Decimal | string | number) {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

function floorCurrency(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_FLOOR);
}

function normalizeReceiptFilename(filename: string) {
  const trimmed = filename.trim();
  return trimmed || "receipt";
}

type LogDisbursementResult = {
  disbursement: {
    id: string;
    amount: Prisma.Decimal;
    allocatedAmount: Prisma.Decimal;
    extraContributionAmount: Prisma.Decimal;
    feesCoveredAmount: Prisma.Decimal;
    periodId: string;
    causeId: string;
    paidAt: Date;
    paymentMethod: string;
    referenceId: string | null;
    receiptFileKey: string | null;
  };
  causeAllocationId: string | null;
  remaining: Prisma.Decimal;
};

export async function logDisbursement(
  shopId: string,
  input: LogDisbursementInput,
  options?: {
    db?: TransactionCapableDbClient;
    storage?: ReceiptStorage;
    actor?: string;
  },
): Promise<LogDisbursementResult> {
  const db = options?.db ?? prisma;
  const storage = options?.storage ?? createReceiptStorage();
  const actor = options?.actor ?? "merchant";
  const allocatedAmount = floorCurrency(toDecimal(input.allocatedAmount));
  const extraContributionAmount = floorCurrency(toDecimal(input.extraContributionAmount ?? 0));
  const feesCoveredAmount = floorCurrency(toDecimal(input.feesCoveredAmount ?? 0));
  const amount = allocatedAmount.add(extraContributionAmount).add(feesCoveredAmount);

  if (allocatedAmount.lessThan(ZERO) || extraContributionAmount.lessThan(ZERO) || feesCoveredAmount.lessThan(ZERO)) {
    throw new DisbursementError(disbursementErrorCodes.NEGATIVE_AMOUNT, "Disbursement amounts cannot be negative.");
  }

  if (amount.lessThanOrEqualTo(ZERO)) {
    throw new DisbursementError(disbursementErrorCodes.ZERO_TOTAL, "At least one disbursement amount must be greater than 0.");
  }

  const disbursementId = randomUUID();
  const receipt = input.receipt ?? null;
  const receiptFileKey = receipt
    ? buildDisbursementReceiptKey({
        shopId,
        periodId: input.periodId,
        disbursementId,
        filename: normalizeReceiptFilename(receipt.filename),
      })
    : null;

  if (receipt) {
    if (receipt.body.byteLength > MAX_RECEIPT_BYTES) {
      throw new DisbursementError(disbursementErrorCodes.RECEIPT_TOO_LARGE, "Receipt file must be 10 MB or smaller.");
    }

    if (!ACCEPTED_RECEIPT_CONTENT_TYPES.has(receipt.contentType)) {
      throw new DisbursementError(disbursementErrorCodes.RECEIPT_INVALID_TYPE, "Receipt must be a PDF, PNG, or JPEG file.");
    }

    if (receiptFileKey) {
      await storage.put({
        key: receiptFileKey,
        body: receipt.body,
        contentType: receipt.contentType || "application/octet-stream",
      });
    }
  }

  try {
    return await db.$transaction(async (tx) => {
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
        throw new DisbursementError(disbursementErrorCodes.PERIOD_NOT_FOUND, "Reporting period not found.");
      }

      if (period.status !== "CLOSED") {
        throw new DisbursementError(disbursementErrorCodes.PERIOD_NOT_CLOSED, "Disbursements can only be logged for closed reporting periods.");
      }

      const outstandingAllocations = await listOutstandingCauseAllocations(
        shopId,
        {
          throughPeriodEndDate: period.endDate,
          causeId: input.causeId,
        },
        tx,
      );

      if (outstandingAllocations.length === 0) {
        throw new DisbursementError(disbursementErrorCodes.PAYABLE_NOT_FOUND, "No outstanding payable was found for this cause.");
      }

      const spendableRemaining = outstandingAllocations.reduce(
        (sum, allocation) => sum.add(allocation.remaining),
        ZERO,
      );
      if (allocatedAmount.greaterThan(spendableRemaining)) {
        throw new DisbursementError(disbursementErrorCodes.ALLOCATED_EXCEEDS_REMAINING, "Allocated amount cannot exceed the remaining allocation.");
      }

      const applications: Array<{
        causeAllocationId: string;
        causeName: string;
        periodId: string;
        amount: Prisma.Decimal;
      }> = [];
      let unapplied = floorCurrency(allocatedAmount);

      for (const allocation of outstandingAllocations) {
        if (unapplied.lessThanOrEqualTo(ZERO)) {
          break;
        }

        const appliedAmount = Prisma.Decimal.min(unapplied, allocation.remaining);
        if (appliedAmount.lessThanOrEqualTo(ZERO)) {
          continue;
        }

        applications.push({
          causeAllocationId: allocation.id,
          causeName: allocation.causeName,
          periodId: allocation.periodId,
          amount: appliedAmount,
        });
        unapplied = unapplied.sub(appliedAmount);
      }

      const disbursement = await tx.disbursement.create({
        data: {
          id: disbursementId,
          shopId,
          periodId: input.periodId,
          causeId: input.causeId,
          amount,
          allocatedAmount,
          extraContributionAmount,
          feesCoveredAmount,
          paidAt: input.paidAt,
          paymentMethod: input.paymentMethod.trim(),
          referenceId: input.referenceId?.trim() || null,
          receiptFileKey,
        },
      });

      if (applications.length > 0) {
        await tx.disbursementApplication.createMany({
          data: applications.map((application) => ({
            shopId,
            disbursementId: disbursement.id,
            causeAllocationId: application.causeAllocationId,
            amount: application.amount,
          })),
        });

        await Promise.all(
          applications.map((application) =>
            tx.causeAllocation.updateMany({
              where: {
                id: application.causeAllocationId,
                shopId,
              },
              data: {
                disbursed: {
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
          entity: "Disbursement",
          entityId: disbursement.id,
          action: "DISBURSEMENT_LOGGED",
          actor,
          payload: {
            periodId: input.periodId,
            causeId: input.causeId,
            amount: amount.toString(),
            allocatedAmount: allocatedAmount.toString(),
            extraContributionAmount: extraContributionAmount.toString(),
            feesCoveredAmount: feesCoveredAmount.toString(),
            applications: applications.map((application) => ({
              causeAllocationId: application.causeAllocationId,
              periodId: application.periodId,
              amount: application.amount.toString(),
            })),
            hasReceipt: Boolean(receiptFileKey),
          },
        },
      });

      return {
        disbursement,
        causeAllocationId: applications[0]?.causeAllocationId ?? null,
        remaining: spendableRemaining.sub(allocatedAmount),
      };
    });
  } catch (error) {
    if (receiptFileKey) {
      await storage.delete({ key: receiptFileKey }).catch(() => undefined);
    }
    throw error;
  }
}
