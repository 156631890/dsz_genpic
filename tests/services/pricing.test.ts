import { describe, expect, test } from "vitest";
import {
  calculateVendorPrice,
  calculateVendorRrp
} from "../../shared/pricing";

describe("vendor pricing rules", () => {
  test("uses actual weight when it exceeds volumetric weight", () => {
    expect(calculateVendorPrice({
      weightKg: 2,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10,
      purchasePriceCny: 15
    })).toBe(45.9);
  });

  test("uses L x W x H / 8000 when volumetric weight is higher", () => {
    expect(calculateVendorPrice({
      weightKg: 0.3,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
      purchasePriceCny: 15
    })).toBe(24.59);
  });

  test("rounds Vendor RRP from the rounded Vendor Price", () => {
    expect(calculateVendorRrp(24.59)).toBe(49.18);
  });
});
