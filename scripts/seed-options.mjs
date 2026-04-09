export const DEFAULT_SEED_OPTIONS = {
  months: 6,
  ordersMin: 20,
  ordersMax: 30,
  completeSetup: false,
};

export const SEED_PRESETS = {
  "demo-store": {
    months: 4,
    ordersMin: 8,
    ordersMax: 12,
    completeSetup: true,
  },
};

export function applySeedPreset(baseOptions, presetName) {
  if (!presetName) {
    return baseOptions;
  }

  const preset = SEED_PRESETS[presetName];
  if (!preset) {
    throw new Error(`Unknown seed preset: ${presetName}`);
  }

  return {
    ...baseOptions,
    ...preset,
    preset: presetName,
  };
}
