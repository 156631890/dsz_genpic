import { describe, expect, test } from "vitest";
import {
  AU_ZONE_KEYS,
  buildShippingZoneRates,
  calculateBillableWeightKg,
  calculatePackageCbm
} from "../../shared/shipping";

describe("shipping rules", () => {
  test("uses volumetric weight when it exceeds actual weight", () => {
    expect(
      calculateBillableWeightKg({
        actualWeightKg: 1,
        lengthCm: 50,
        widthCm: 40,
        heightCm: 30
      })
    ).toBe(12);
  });

  test.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "normalizes invalid actual weight %s to zero",
    (actualWeightKg) => {
      expect(
        calculateBillableWeightKg({
          actualWeightKg,
          lengthCm: 10,
          widthCm: 10,
          heightCm: 10
        })
      ).toBe(0.2);
    }
  );

  test.each([
    { lengthCm: -1, widthCm: 10, heightCm: 10 },
    { lengthCm: 10, widthCm: Number.NaN, heightCm: 10 },
    { lengthCm: 10, widthCm: 10, heightCm: Number.POSITIVE_INFINITY }
  ])("normalizes invalid dimensions before calculating billable weight", (dimensions) => {
    expect(
      calculateBillableWeightKg({
        actualWeightKg: 2,
        ...dimensions
      })
    ).toBe(2);
  });

  test("makes every Australian zone free and charges NZ AUD20 below 3 kg", () => {
    const rates = buildShippingZoneRates({
      actualWeightKg: 2,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10
    });

    expect(AU_ZONE_KEYS.every((key) => rates[key] === 0)).toBe(true);
    expect(rates.nz).toBe(20);
  });

  test("charges NZ AUD40 at the 3 kg boundary", () => {
    const rates = buildShippingZoneRates({
      actualWeightKg: 3,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10
    });

    expect(rates.nz).toBe(40);
  });

  test("calculates package CBM rounded to six decimals", () => {
    expect(calculatePackageCbm(50, 40, 30)).toBe(0.06);
  });

  test.each([
    [-1, 40, 30],
    [50, Number.NaN, 30],
    [50, 40, Number.POSITIVE_INFINITY]
  ])("normalizes invalid dimensions before calculating package CBM", (length, width, height) => {
    expect(calculatePackageCbm(length, width, height)).toBe(0);
  });
});
