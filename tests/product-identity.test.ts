import { beforeEach, describe, expect, test } from "vitest";
import { reserveProductIdentity } from "../src/productIdentity";

describe("product identity reservation", () => {
  beforeEach(() => localStorage.clear());

  test("increments Elosung SKU values across reservations", () => {
    const first = reserveProductIdentity(() => 0.123456789);
    const second = reserveProductIdentity(() => 0.987654321);

    expect(first.sku).toBe("Elosung10000");
    expect(second.sku).toBe("Elosung10001");
  });

  test("stores and avoids previously generated 10-digit EAN values", () => {
    localStorage.setItem("dsz.usedEans", JSON.stringify(["1234567890"]));
    const values = [0.123456789, 0.234567891];
    const identity = reserveProductIdentity(
      () => values.shift() || 0.345678912
    );

    expect(identity.eanCode).toMatch(/^\d{10}$/);
    expect(identity.eanCode).not.toBe("1234567890");
  });

  test("fails instead of reusing an exhausted SKU range", () => {
    localStorage.setItem("dsz.skuCounter", "20000");
    expect(() => reserveProductIdentity()).toThrow("SKU range is exhausted");
  });
});
