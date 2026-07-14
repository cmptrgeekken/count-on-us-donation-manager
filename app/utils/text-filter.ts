import type { Prisma } from "@prisma/client";

export type TextMatchMode = "contains" | "startsWith" | "endsWith" | "equals" | "empty";

export function parseTextMatchMode(value: string | null, allowEmpty = false): TextMatchMode {
  if (value === "startsWith" || value === "endsWith" || value === "equals") return value;
  if (allowEmpty && value === "empty") return value;
  return "contains";
}

export function buildTextFilter(value: string, mode: TextMatchMode): Prisma.StringFilter {
  if (mode === "startsWith") return { startsWith: value, mode: "insensitive" };
  if (mode === "endsWith") return { endsWith: value, mode: "insensitive" };
  if (mode === "equals") return { equals: value, mode: "insensitive" };
  return { contains: value, mode: "insensitive" };
}
