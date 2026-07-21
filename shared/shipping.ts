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
  const actualWeightKg = normalizeMeasurement(measurements.actualWeightKg);
  const lengthCm = normalizeMeasurement(measurements.lengthCm);
  const widthCm = normalizeMeasurement(measurements.widthCm);
  const heightCm = normalizeMeasurement(measurements.heightCm);

  return Math.max(
    actualWeightKg,
    (lengthCm * widthCm * heightCm) / 5000
  );
}

export function buildShippingZoneRates(
  measurements: ShippingMeasurements
): Record<string, number> {
  const rates: Record<string, number> = {};

  for (const key of AU_ZONE_KEYS) {
    rates[key] = 0;
  }

  const billableWeightKg = calculateBillableWeightKg(measurements);
  rates.nz = billableWeightKg > 2 ? 999 : billableWeightKg > 1 ? 40 : 20;
  return rates;
}

export function calculatePackageCbm(
  lengthCm: number,
  widthCm: number,
  heightCm: number
): number {
  const cbm =
    (normalizeMeasurement(lengthCm) *
      normalizeMeasurement(widthCm) *
      normalizeMeasurement(heightCm)) /
    1_000_000;

  return Math.round(cbm * 1_000_000) / 1_000_000;
}

function normalizeMeasurement(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
