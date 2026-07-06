export type EquipmentUsageBasis = "time" | "unit" | "time_and_unit";

export type EquipmentUsageMode = "direct" | "duration_yield" | "use_yield";

export const EQUIPMENT_USAGE_BASIS_OPTIONS: Array<{ label: string; value: EquipmentUsageBasis }> = [
  { label: "Time-based", value: "time" },
  { label: "Use-based", value: "unit" },
  { label: "Time and use-based", value: "time_and_unit" },
];

export function normalizeEquipmentUsageBasis(value: string | null | undefined): EquipmentUsageBasis {
  if (value === "time" || value === "unit" || value === "time_and_unit") {
    return value;
  }
  return "time_and_unit";
}

export function defaultUsageModeForBasis(basis: string | null | undefined): EquipmentUsageMode {
  const normalized = normalizeEquipmentUsageBasis(basis);
  if (normalized === "time") return "duration_yield";
  if (normalized === "unit") return "use_yield";
  return "direct";
}

export function usageModeAllowedForBasis(usageMode: string | null | undefined, basis: string | null | undefined): boolean {
  const normalizedMode = usageMode ?? "direct";
  const normalizedBasis = normalizeEquipmentUsageBasis(basis);
  if (normalizedBasis === "time") {
    return normalizedMode === "direct" || normalizedMode === "duration_yield";
  }
  if (normalizedBasis === "unit") {
    return normalizedMode === "direct" || normalizedMode === "use_yield";
  }
  return normalizedMode === "direct" || normalizedMode === "duration_yield" || normalizedMode === "use_yield";
}

export function usageModeOptionsForBasis(basis: string | null | undefined): Array<{ label: string; value: EquipmentUsageMode }> {
  const normalizedBasis = normalizeEquipmentUsageBasis(basis);
  if (normalizedBasis === "time") {
    return [
      { label: "Direct minutes", value: "direct" },
      { label: "Duration yield", value: "duration_yield" },
    ];
  }
  if (normalizedBasis === "unit") {
    return [
      { label: "Direct uses", value: "direct" },
      { label: "Use yield", value: "use_yield" },
    ];
  }
  return [
    { label: "Direct minutes / uses", value: "direct" },
    { label: "Duration yield", value: "duration_yield" },
    { label: "Use yield", value: "use_yield" },
  ];
}

export function usageBasisLabel(basis: string | null | undefined): string {
  const normalizedBasis = normalizeEquipmentUsageBasis(basis);
  if (normalizedBasis === "time") return "Time-based";
  if (normalizedBasis === "unit") return "Use-based";
  return "Time and use-based";
}
