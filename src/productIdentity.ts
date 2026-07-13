import type { ProductIdentity } from "../shared/product";

const SKU_KEY = "dsz.skuCounter";
const EAN_KEY = "dsz.usedEans";

export function reserveProductIdentity(
  random = Math.random
): ProductIdentity {
  const counter = readCounter(localStorage.getItem(SKU_KEY));
  if (counter > 19999) throw new Error("SKU range is exhausted");

  const sku = `Elosung${counter}`;
  localStorage.setItem(SKU_KEY, String(counter + 1));

  const used = new Set<string>(readUsedEans(localStorage.getItem(EAN_KEY)));
  let eanCode = "";
  for (let attempt = 0; attempt < 100 && !eanCode; attempt += 1) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) continue;

    const candidate = String(
      Math.floor(sample * 10_000_000_000)
    ).padStart(10, "0");
    if (!used.has(candidate)) eanCode = candidate;
  }

  if (!eanCode) throw new Error("Unable to reserve a unique EAN code");
  used.add(eanCode);
  localStorage.setItem(EAN_KEY, JSON.stringify(Array.from(used)));

  return { sku, eanCode };
}

function readCounter(value: string | null): number {
  if (value === null) return 10000;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 10000 || parsed > 20000) {
    throw new Error("Stored SKU counter is invalid");
  }
  return parsed;
}

function readUsedEans(value: string | null): string[] {
  if (value === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Stored EAN reservations are invalid");
  }

  if (
    !Array.isArray(parsed) ||
    !parsed.every(
      (item) => typeof item === "string" && /^\d{10}$/.test(item)
    )
  ) {
    throw new Error("Stored EAN reservations are invalid");
  }

  return parsed;
}
