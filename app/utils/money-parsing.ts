import { Prisma } from "@prisma/client";

export function parseRequiredPositiveMoney(value: string | null | undefined, field: string) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Response(`${field} is required.`, { status: 400 });
  }

  let parsed: Prisma.Decimal;
  try {
    parsed = new Prisma.Decimal(trimmed);
  } catch {
    throw new Response(`${field} must be a valid amount.`, { status: 400 });
  }

  if (parsed.lessThanOrEqualTo(new Prisma.Decimal(0))) {
    throw new Response(`${field} must be greater than 0.`, { status: 400 });
  }

  return parsed.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function parseOptionalNonNegativeMoney(value: string | null | undefined, field: string) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;

  let parsed: Prisma.Decimal;
  try {
    parsed = new Prisma.Decimal(trimmed);
  } catch {
    throw new Response(`${field} must be a valid amount.`, { status: 400 });
  }

  if (parsed.lessThan(new Prisma.Decimal(0))) {
    throw new Response(`${field} must be 0 or greater.`, { status: 400 });
  }

  return parsed.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function parseRequiredPositiveDecimal(
  value: string | null | undefined,
  field: string,
  scale = 4,
) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Response(`${field} is required.`, { status: 400 });
  }

  let parsed: Prisma.Decimal;
  try {
    parsed = new Prisma.Decimal(trimmed);
  } catch {
    throw new Response(`${field} must be a valid number.`, { status: 400 });
  }

  if (parsed.lessThanOrEqualTo(new Prisma.Decimal(0))) {
    throw new Response(`${field} must be greater than 0.`, { status: 400 });
  }

  return parsed.toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);
}

export function parseOptionalPositiveDecimal(
  value: string | null | undefined,
  field: string,
  scale = 4,
) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;

  let parsed: Prisma.Decimal;
  try {
    parsed = new Prisma.Decimal(trimmed);
  } catch {
    throw new Response(`${field} must be a valid number.`, { status: 400 });
  }

  if (parsed.lessThanOrEqualTo(new Prisma.Decimal(0))) {
    throw new Response(`${field} must be greater than 0.`, { status: 400 });
  }

  return parsed.toDecimalPlaces(scale, Prisma.Decimal.ROUND_HALF_UP);
}

export function parsePercentInputToRate(value: string | null | undefined, field: string) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Response(`${field} is required.`, { status: 400 });
  }

  let parsed: Prisma.Decimal;
  try {
    parsed = new Prisma.Decimal(trimmed);
  } catch {
    throw new Response(`${field} must be a number between 0 and 100.`, { status: 400 });
  }

  if (parsed.lessThan(new Prisma.Decimal(0)) || parsed.greaterThan(new Prisma.Decimal(100))) {
    throw new Response(`${field} must be a number between 0 and 100.`, { status: 400 });
  }

  return parsed
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    .div(new Prisma.Decimal(100))
    .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

export function parseOptionalPercentInputToRate(value: string | null | undefined, field: string) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return parsePercentInputToRate(trimmed, field);
}
