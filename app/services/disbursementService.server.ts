import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
import { listOutstandingCauseAllocations } from "./causePayables.server";
import {
  buildDisbursementReceiptKey,
  createReceiptStorage,
  type ReceiptStorage,
} from "./receiptStorage.server";

type DbClient = typeof prisma;

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

function normalizeReceiptFilename(filename: string) {
  const trimmed = filename.trim();
  return trimmed || "receipt";
}

export async function logDisbursement(
  shopId: string,
  input: LogDisbursementInput,
  options?: {
    db?: DbClient;
    storage?: ReceiptStorage;
    actor?: string;
  },
) {
  const db = options?.db ?? prisma;
  const storage = options?.storage ?? createReceiptStorage();
  const actor = options?.actor ?? "merchant";
  const allocatedAmount = toDecimal(input.allocatedAmount);
  const extraContributionAmount = toDecimal(input.extraContributionAmount ?? 0);
  const feesCoveredAmount = toDecimal(input.feesCoveredAmount ?? 0);
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

    await storage.put({
      key: receiptFileKey!,
      body: receipt.body,
      contentType: receipt.contentType || "application/octet-stream",
    });
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
        tx as DbClient,
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
      let unapplied = allocatedAmount;

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

        for (const application of applications) {
          await tx.causeAllocation.updateMany({
            where: {
              id: application.causeAllocationId,
              shopId,
            },
            data: {
              disbursed: {
                increment: application.amount,
              },
            },
          });
        }
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
            causeName: outstandingAllocations[0]?.causeName ?? "Cause",
            amount: amount.toString(),
            allocatedAmount: allocatedAmount.toString(),
            extraContributionAmount: extraContributionAmount.toString(),
            feesCoveredAmount: feesCoveredAmount.toString(),
            applications: applications.map((application) => ({
              periodId: application.periodId,
              amount: application.amount.toString(),
            })),
            paidAt: input.paidAt.toISOString(),
            paymentMethod: input.paymentMethod.trim(),
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
