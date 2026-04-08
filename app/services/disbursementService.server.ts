import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.server";
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

export type DisbursementReceiptInput = {
  filename: string;
  contentType: string;
  body: Uint8Array;
};

export type LogDisbursementInput = {
  periodId: string;
  causeId: string;
  amount: Prisma.Decimal | string | number;
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
  const amount = toDecimal(input.amount);

  if (amount.lessThanOrEqualTo(ZERO)) {
    throw new Error("Disbursement amount must be greater than 0.");
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
      throw new Error("Receipt file must be 10 MB or smaller.");
    }

    if (!ACCEPTED_RECEIPT_CONTENT_TYPES.has(receipt.contentType)) {
      throw new Error("Receipt must be a PDF, PNG, or JPEG file.");
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
        },
      });

      if (!period) {
        throw new Error("Reporting period not found.");
      }

      if (period.status !== "CLOSED") {
        throw new Error("Disbursements can only be logged for closed reporting periods.");
      }

      const allocation = await tx.causeAllocation.findFirst({
        where: {
          shopId,
          periodId: input.periodId,
          causeId: input.causeId,
        },
        select: {
          id: true,
          causeId: true,
          causeName: true,
          allocated: true,
          disbursed: true,
        },
      });

      if (!allocation) {
        throw new Error("Cause allocation not found for this reporting period.");
      }

      const remaining = allocation.allocated.sub(allocation.disbursed);
      if (amount.greaterThan(remaining)) {
        throw new Error("Disbursement amount cannot exceed the remaining allocation.");
      }

      const disbursement = await tx.disbursement.create({
        data: {
          id: disbursementId,
          shopId,
          periodId: input.periodId,
          causeId: input.causeId,
          amount,
          paidAt: input.paidAt,
          paymentMethod: input.paymentMethod.trim(),
          referenceId: input.referenceId?.trim() || null,
          receiptFileKey,
        },
      });

      await tx.causeAllocation.updateMany({
        where: {
          id: allocation.id,
          shopId,
        },
        data: {
          disbursed: {
            increment: amount,
          },
        },
      });

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
            causeName: allocation.causeName,
            amount: amount.toString(),
            paidAt: input.paidAt.toISOString(),
            paymentMethod: input.paymentMethod.trim(),
            hasReceipt: Boolean(receiptFileKey),
          },
        },
      });

      return {
        disbursement,
        causeAllocationId: allocation.id,
        remaining: remaining.sub(amount),
      };
    });
  } catch (error) {
    if (receiptFileKey) {
      await storage.delete({ key: receiptFileKey }).catch(() => undefined);
    }
    throw error;
  }
}
