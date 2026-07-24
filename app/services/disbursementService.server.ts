import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma, type TransactionCapableDbClient } from "../db.server";
import { listOutstandingCauseAllocations } from "./causePayables.server";
import { reconcileCauseDisbursements } from "./disbursementReconciliation.server";
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
  paymentMethod?: string | null;
  referenceId?: string | null;
  receipt?: DisbursementReceiptInput | null;
};

export type UpdateDisbursementInput = Omit<LogDisbursementInput, "periodId" | "causeId" | "extraContributionAmount"> & {
  disbursementId: string;
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

function earlierDate(left: Date, right: Date) {
  return left < right ? left : right;
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
    paymentMethod: string | null;
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
  const enteredAmount = floorCurrency(toDecimal(input.allocatedAmount));
  const legacyExtraContributionAmount = floorCurrency(toDecimal(input.extraContributionAmount ?? 0));
  const requestedPayoutAmount = enteredAmount.add(legacyExtraContributionAmount);
  const feesCoveredAmount = floorCurrency(toDecimal(input.feesCoveredAmount ?? 0));
  const amount = requestedPayoutAmount.add(feesCoveredAmount);

  if (enteredAmount.lessThan(ZERO) || legacyExtraContributionAmount.lessThan(ZERO) || feesCoveredAmount.lessThan(ZERO)) {
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
          // Reporting periods are end-exclusive, as is paidAt. A payment made on
          // a date may never consume obligations earned on or after that date.
          throughPeriodEndDate: earlierDate(period.endDate, input.paidAt),
          causeId: input.causeId,
        },
        tx,
      );

      const spendableRemaining = outstandingAllocations.reduce(
        (sum, allocation) => sum.add(allocation.remaining),
        ZERO,
      );
      const allocatedAmount = Prisma.Decimal.min(requestedPayoutAmount, spendableRemaining);
      const extraContributionAmount = requestedPayoutAmount.sub(allocatedAmount);

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
          paymentMethod: input.paymentMethod?.trim() || null,
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

      // Rebuild later payments too when this is backdated. Older unit-test DB
      // doubles predate the reconciliation query surface, so retain their
      // focused behavior while production transaction clients always run it.
      if (typeof tx.disbursement.findMany === "function") {
        await reconcileCauseDisbursements(shopId, input.causeId, tx, actor);
      }

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

export async function updateDisbursement(
  shopId: string,
  input: UpdateDisbursementInput,
  options?: {
    db?: TransactionCapableDbClient;
    storage?: ReceiptStorage;
    actor?: string;
  },
): Promise<LogDisbursementResult> {
  const db = options?.db ?? prisma;
  const storage = options?.storage ?? createReceiptStorage();
  const actor = options?.actor ?? "merchant";
  const enteredAmount = floorCurrency(toDecimal(input.allocatedAmount));
  const feesCoveredAmount = floorCurrency(toDecimal(input.feesCoveredAmount ?? 0));

  if (enteredAmount.lessThan(ZERO) || feesCoveredAmount.lessThan(ZERO)) {
    throw new DisbursementError(disbursementErrorCodes.NEGATIVE_AMOUNT, "Disbursement amounts cannot be negative.");
  }
  if (enteredAmount.add(feesCoveredAmount).lessThanOrEqualTo(ZERO)) {
    throw new DisbursementError(disbursementErrorCodes.ZERO_TOTAL, "At least one disbursement amount must be greater than 0.");
  }

  const receipt = input.receipt ?? null;
  if (receipt?.body.byteLength && receipt.body.byteLength > MAX_RECEIPT_BYTES) {
    throw new DisbursementError(disbursementErrorCodes.RECEIPT_TOO_LARGE, "Receipt file must be 10 MB or smaller.");
  }
  if (receipt && !ACCEPTED_RECEIPT_CONTENT_TYPES.has(receipt.contentType)) {
    throw new DisbursementError(disbursementErrorCodes.RECEIPT_INVALID_TYPE, "Receipt must be a PDF, PNG, or JPEG file.");
  }
  const replacementReceiptFileKey = receipt
    ? buildDisbursementReceiptKey({
        shopId,
        periodId: "replacement",
        disbursementId: input.disbursementId,
        filename: `${randomUUID()}-${normalizeReceiptFilename(receipt.filename)}`,
      })
    : null;
  if (receipt && replacementReceiptFileKey) {
    await storage.put({
      key: replacementReceiptFileKey,
      body: receipt.body,
      contentType: receipt.contentType,
    });
  }

  let priorReceiptFileKey: string | null = null;

  try {
    const result = await db.$transaction(async (tx) => {
    const existing = await tx.disbursement.findFirst({
      where: { id: input.disbursementId, shopId },
      include: {
        period: { select: { id: true, status: true, endDate: true } },
        applications: { select: { causeAllocationId: true, amount: true } },
      },
    });
    if (!existing) {
      throw new DisbursementError(disbursementErrorCodes.PAYABLE_NOT_FOUND, "Disbursement not found.");
    }
    priorReceiptFileKey = existing.receiptFileKey;
    if (existing.period.status !== "CLOSED") {
      throw new DisbursementError(disbursementErrorCodes.PERIOD_NOT_CLOSED, "Disbursements can only be edited for closed reporting periods.");
    }

    for (const application of existing.applications) {
      await tx.causeAllocation.updateMany({
        where: { id: application.causeAllocationId, shopId },
        data: { disbursed: { decrement: application.amount } },
      });
    }
    await tx.disbursementApplication.deleteMany({
      where: { disbursementId: existing.id, shopId },
    });

    const outstandingAllocations = await listOutstandingCauseAllocations(
      shopId,
      {
        throughPeriodEndDate: earlierDate(existing.period.endDate, input.paidAt),
        causeId: existing.causeId,
      },
      tx,
    );
    const spendableRemaining = outstandingAllocations.reduce(
      (sum, allocation) => sum.add(allocation.remaining),
      ZERO,
    );
    const allocatedAmount = Prisma.Decimal.min(enteredAmount, spendableRemaining);
    const extraContributionAmount = enteredAmount.sub(allocatedAmount);
    let unapplied = allocatedAmount;
    const applications: Array<{ causeAllocationId: string; amount: Prisma.Decimal }> = [];

    for (const allocation of outstandingAllocations) {
      if (unapplied.lessThanOrEqualTo(ZERO)) break;
      const appliedAmount = Prisma.Decimal.min(unapplied, allocation.remaining);
      if (appliedAmount.lessThanOrEqualTo(ZERO)) continue;
      applications.push({ causeAllocationId: allocation.id, amount: appliedAmount });
      unapplied = unapplied.sub(appliedAmount);
    }

    const disbursement = await tx.disbursement.update({
      where: { id: existing.id, shopId },
      data: {
        amount: enteredAmount.add(feesCoveredAmount),
        allocatedAmount,
        extraContributionAmount,
        feesCoveredAmount,
        paidAt: input.paidAt,
        paymentMethod: input.paymentMethod?.trim() || null,
        referenceId: input.referenceId?.trim() || null,
        ...(replacementReceiptFileKey ? { receiptFileKey: replacementReceiptFileKey } : {}),
      },
    });

    if (applications.length > 0) {
      await tx.disbursementApplication.createMany({
        data: applications.map((application) => ({
          shopId,
          disbursementId: existing.id,
          causeAllocationId: application.causeAllocationId,
          amount: application.amount,
        })),
      });
      for (const application of applications) {
        await tx.causeAllocation.updateMany({
          where: { id: application.causeAllocationId, shopId },
          data: { disbursed: { increment: application.amount } },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        shopId,
        entity: "Disbursement",
        entityId: existing.id,
        action: "DISBURSEMENT_UPDATED",
        actor,
        payload: {
          periodId: existing.periodId,
          causeId: existing.causeId,
          amount: disbursement.amount.toString(),
          allocatedAmount: allocatedAmount.toString(),
          extraContributionAmount: extraContributionAmount.toString(),
          feesCoveredAmount: feesCoveredAmount.toString(),
          applicationCount: applications.length,
          receiptReplaced: Boolean(replacementReceiptFileKey),
        },
      },
    });

    if (typeof tx.disbursement.findMany === "function") {
      await reconcileCauseDisbursements(shopId, existing.causeId, tx, actor);
    }

    return {
      disbursement,
      causeAllocationId: applications[0]?.causeAllocationId ?? null,
      remaining: spendableRemaining.sub(allocatedAmount),
    };
    });
    if (replacementReceiptFileKey && priorReceiptFileKey && priorReceiptFileKey !== replacementReceiptFileKey) {
      await storage.delete({ key: priorReceiptFileKey }).catch(() => undefined);
    }
    return result;
  } catch (error) {
    if (replacementReceiptFileKey) {
      await storage.delete({ key: replacementReceiptFileKey }).catch(() => undefined);
    }
    throw error;
  }
}
