import { BaseError } from "@api-hub/utils";

import { paiseToRupees, rupeesToPaise } from "./catalog-validation";

export const PRICING_VERSION = "catalog-mvp-1";
export const PRICING_CURRENCY = "INR";

export type PricingLineType = "SERVICE" | "PACKAGE" | "ADD_ON";

export interface PricingLineInput {
  type: PricingLineType;
  id: string;
  name: string;
  catalogPrice: number;
  providerPrice?: number;
  quantity?: number;
}

export interface PricingLine {
  type: PricingLineType;
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
  total: number;
  catalogUnitPrice: number;
  providerUnitPrice?: number;
}

export interface PricingBreakdown {
  currency: typeof PRICING_CURRENCY;
  subtotal: number;
  discount: number;
  addOnTotal: number;
  total: number;
  items: PricingLine[];
  pricingVersion: typeof PRICING_VERSION;
}

/**
 * Coupon discounts are not applied. Package price is the configured
 * discountedPrice (or a provider override), not a recomputed percentage.
 * `discount` stays 0 so subtotal + addOnTotal - discount = total.
 */
export function calculatePriceBreakdown(
  lines: readonly PricingLineInput[],
): PricingBreakdown {
  const items: PricingLine[] = [];
  let subtotalPaise = 0;
  let addOnPaise = 0;

  for (const line of lines) {
    const quantity = line.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new BaseError("quantity must be a positive integer", 400, "INVALID_PRICE");
    }

    const catalogPaise = rupeesToPaise(line.catalogPrice, "catalogPrice");
    const providerPaise = line.providerPrice === undefined
      ? undefined
      : rupeesToPaise(line.providerPrice, "providerPrice");
    const unitPaise = providerPaise ?? catalogPaise;
    const linePaise = unitPaise * quantity;

    if (line.type === "ADD_ON") {
      addOnPaise += linePaise;
    } else {
      subtotalPaise += linePaise;
    }

    items.push({
      type: line.type,
      id: line.id,
      name: line.name,
      unitPrice: paiseToRupees(unitPaise),
      quantity,
      total: paiseToRupees(linePaise),
      catalogUnitPrice: paiseToRupees(catalogPaise),
      ...(providerPaise === undefined
        ? {}
        : { providerUnitPrice: paiseToRupees(providerPaise) }),
    });
  }

  const discountPaise = 0;
  const totalPaise = subtotalPaise + addOnPaise - discountPaise;
  if (totalPaise < 0) {
    throw new BaseError("Calculated total cannot be negative", 400, "INVALID_PRICE");
  }

  return {
    currency: PRICING_CURRENCY,
    subtotal: paiseToRupees(subtotalPaise),
    discount: paiseToRupees(discountPaise),
    addOnTotal: paiseToRupees(addOnPaise),
    total: paiseToRupees(totalPaise),
    items,
    pricingVersion: PRICING_VERSION,
  };
}
