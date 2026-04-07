export function parseOptionalNonNegativeNumber(value: string | null | undefined, field: string) {
  if (!value || !value.trim()) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Response(`${field} must be a non-negative number.`, { status: 400 });
  }
  return parsed;
}

export function parseOptionalNonNegativeWholeNumber(value: string | null | undefined, field: string) {
  if (!value || !value.trim()) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Response(`${field} must be a non-negative whole number.`, { status: 400 });
  }
  return parsed;
}

export function parseRequiredNonNegativeWholeNumber(value: string | null | undefined, field: string) {
  if (!value || !value.trim()) {
    throw new Response(`${field} must be a non-negative whole number.`, { status: 400 });
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Response(`${field} must be a non-negative whole number.`, { status: 400 });
  }
  return parsed;
}

export function parseOptionalPercent(value: string | null | undefined, field: string) {
  if (!value || !value.trim()) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
    throw new Response(`${field} must be between 0 and 100.`, { status: 400 });
  }
  return parsed / 100;
}
