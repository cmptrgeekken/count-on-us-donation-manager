import type { Prisma } from "@prisma/client";
import { buildTextFilter, type TextMatchMode } from "./text-filter";

export function buildProductSearchFilter(
  value: string,
  mode: TextMatchMode,
): Prisma.ProductWhereInput {
  const textFilter = buildTextFilter(value, mode);
  return {
    OR: [{ title: textFilter }, { handle: textFilter }],
  };
}
