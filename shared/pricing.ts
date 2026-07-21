export interface VendorPriceInput {
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  purchasePriceCny: number;
}

export function calculateVendorPrice(input: VendorPriceInput): number {
  const volumetricWeight =
    (input.lengthCm * input.widthCm * input.heightCm) / 8000;
  const chargeableWeight = Math.max(input.weightKg, volumetricWeight);

  return roundCurrency(
    (chargeableWeight * 40 + 45 + input.purchasePriceCny) / 3.05
  );
}

export function calculateVendorRrp(vendorPrice: number): number {
  return roundCurrency(vendorPrice * 2);
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
