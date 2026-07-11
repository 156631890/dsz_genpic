export const AU_ZONE_KEYS = [
  "act",
  "nsw_m",
  "nsw_r",
  "nt_m",
  "nt_r",
  "qld_m",
  "qld_r",
  "remote",
  "sa_m",
  "sa_r",
  "tas_m",
  "tas_r",
  "vic_m",
  "vic_r",
  "wa_m",
  "wa_r"
] as const;

export interface ShippingMeasurements {
  actualWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export function calculateBillableWeightKg(
  measurements: ShippingMeasurements
): number {
  validateMeasurements(measurements);

  return Math.max(
    measurements.actualWeightKg,
    (measurements.lengthCm * measurements.widthCm * measurements.heightCm) / 5000
  );
}

export function buildShippingZoneRates(
  measurements: ShippingMeasurements
): Record<string, number> {
  const rates: Record<string, number> = {};

  for (const key of AU_ZONE_KEYS) {
    rates[key] = 0;
  }

  rates.nz = calculateBillableWeightKg(measurements) >= 3 ? 40 : 20;
  return rates;
}

export function calculatePackageCbm(
  lengthCm: number,
  widthCm: number,
  heightCm: number
): number {
  validateNonnegativeFinite({ lengthCm, widthCm, heightCm });
  const cbm = (lengthCm * widthCm * heightCm) / 1_000_000;

  return Math.round(cbm * 1_000_000) / 1_000_000;
}

function validateMeasurements(measurements: ShippingMeasurements): void {
  validateNonnegativeFinite(measurements);
}

function validateNonnegativeFinite(values: object): void {
  for (const [name, value] of Object.entries(values)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${name} must be a nonnegative finite number`);
    }
  }
}
