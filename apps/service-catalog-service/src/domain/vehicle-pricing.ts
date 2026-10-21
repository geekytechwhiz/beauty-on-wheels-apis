import { BaseError, type VehicleType } from '@api-hub/utils';

import {
    assertCatalogAmount,
    assertPositiveDuration,
    assertVehicleTypes,
} from './catalog-validation';
import { ServiceEntity, VehiclePricing } from '../utils/types/catalog-domain.types';
import { CatalogKeyBuilder } from '../utils/constants/catalog-key-builder';

export type { VehiclePricing };

export interface ServicePricingSource {
    vehiclePricing?: readonly VehiclePricing[] | null;
    vehicleTypes?: readonly string[] | null;
    basePrice?: number;
    durationMinutes?: number;
}

export interface LegacyPricingPatch {
    vehiclePricing?: readonly VehiclePricing[];
    vehicleTypes?: readonly string[];
    basePrice?: number;
    durationMinutes?: number;
}

/**
 * Reads the authoritative vehicle pricing.
 * Older rows stored one price and one duration for every vehicle type.
 * Those rows stay unchanged until the next write.
 */
export function resolveVehiclePricing(source: ServicePricingSource): VehiclePricing[] {
    if (Array.isArray(source.vehiclePricing) && source.vehiclePricing.length > 0) {
        return source.vehiclePricing.map((entry) => ({
            vehicleType: entry.vehicleType,
            price: entry.price,
            durationMinutes: entry.durationMinutes,
        }));
    }
    const vehicleTypes = source.vehicleTypes ?? [];
    const price = typeof source.basePrice === 'number' ? source.basePrice : 0;
    const durationMinutes = typeof source.durationMinutes === 'number'
        ? source.durationMinutes
        : 0;
    return vehicleTypes.map((vehicleType) => ({
        vehicleType,
        price,
        durationMinutes,
    }));
}

export function assertVehiclePricing(values: readonly {
    vehicleType: string;
    price: number;
    durationMinutes: number;
}[]): VehiclePricing[] {
    if (values.length === 0) {
        throw new BaseError(
            'vehiclePricing is required',
            400,
            'VALIDATION_ERROR',
        );
    }
    const vehicleTypes = assertVehicleTypes(values.map((entry) => entry.vehicleType));
    return values.map((entry, index) => {
        assertCatalogAmount(entry.price, 'price');
        assertPositiveDuration(entry.durationMinutes);
        return {
            vehicleType: vehicleTypes[index] as VehicleType,
            price: entry.price,
            durationMinutes: entry.durationMinutes,
        };
    });
}

/**
 * One shared price and duration become one pricing entry per vehicle type.
 */
export function vehiclePricingFromLegacy(input: {
    basePrice: number;
    durationMinutes: number;
    vehicleTypes: readonly string[];
}): VehiclePricing[] {
    assertCatalogAmount(input.basePrice, 'basePrice');
    assertPositiveDuration(input.durationMinutes);
    const vehicleTypes = assertVehicleTypes(input.vehicleTypes);
    return vehicleTypes.map((vehicleType) => ({
        vehicleType,
        price: input.basePrice,
        durationMinutes: input.durationMinutes,
    }));
}

export function deriveStoredPricing(vehiclePricing: readonly VehiclePricing[]): {
    vehiclePricing: VehiclePricing[];
    vehicleTypes: string[];
    basePrice: number;
    durationMinutes: number;
} {
    const pricing = vehiclePricing.map((entry) => ({ ...entry }));
    return {
        vehiclePricing: pricing,
        vehicleTypes: pricing.map((entry) => entry.vehicleType),
        basePrice: Math.min(...pricing.map((entry) => entry.price)),
        durationMinutes: Math.min(...pricing.map((entry) => entry.durationMinutes)),
    };
}

export function sameVehiclePricing(
    left: readonly VehiclePricing[],
    right: readonly VehiclePricing[],
): boolean {
    if (left.length !== right.length) {
        return false;
    }
    const byType = new Map(left.map((entry) => [entry.vehicleType, entry]));
    return right.every((entry) => {
        const current = byType.get(entry.vehicleType);
        return current?.price === entry.price
            && current.durationMinutes === entry.durationMinutes;
    });
}

/**
 * A vehiclePricing array replaces the configuration.
 * Legacy basePrice, durationMinutes, and vehicleTypes still update the
 * stored entries: a lone basePrice or duration applies to every current type.
 */
export function resolveUpdatedPricing(
    existing: ServicePricingSource,
    updates: LegacyPricingPatch,
): VehiclePricing[] {
    if (updates.vehiclePricing !== undefined) {
        return updates.vehiclePricing.map((entry) => ({ ...entry }));
    }
    const current = resolveVehiclePricing(existing);
    const legacyTouched = updates.basePrice !== undefined
        || updates.durationMinutes !== undefined
        || updates.vehicleTypes !== undefined;
    if (!legacyTouched) {
        return current;
    }
    const types = updates.vehicleTypes ?? current.map((entry) => entry.vehicleType);
    const byType = new Map(current.map((entry) => [entry.vehicleType, entry]));
    const fallbackPrice = updates.basePrice ?? current[0]?.price;
    const fallbackDuration = updates.durationMinutes ?? current[0]?.durationMinutes;
    return types.map((vehicleType) => {
        const entry = byType.get(vehicleType);
        if (!entry) {
            if (fallbackPrice === undefined || fallbackDuration === undefined) {
                throw new BaseError(
                    `price and durationMinutes are required for vehicle type ${vehicleType}`,
                    400,
                    'VALIDATION_ERROR',
                );
            }
            return {
                vehicleType,
                price: fallbackPrice,
                durationMinutes: fallbackDuration,
            };
        }
        return {
            vehicleType,
            price: updates.basePrice ?? entry.price,
            durationMinutes: updates.durationMinutes ?? entry.durationMinutes,
        };
    });
}

export function priceForVehicle(source: ServicePricingSource, vehicleType: string): number {
    const match = resolveVehiclePricing(source).find((entry) => entry.vehicleType === vehicleType);
    if (!match || !Number.isFinite(match.price)) {
        throw new BaseError(
            `Vehicle type ${vehicleType} is not supported`,
            400,
            'VEHICLE_TYPE_NOT_SUPPORTED',
        );
    }
    return match.price;
}

export function durationForVehicle(source: ServicePricingSource, vehicleType: string): number | undefined {
    return resolveVehiclePricing(source)
        .find((entry) => entry.vehicleType === vehicleType)
        ?.durationMinutes;
}

export function serviceMatchesListFilters(
    source: ServicePricingSource,
    filters: { vehicleType?: string; durationMinutes?: number },
): boolean {
    const pricing = resolveVehiclePricing(source);
    if (filters.vehicleType) {
        const match = pricing.find((entry) => entry.vehicleType === filters.vehicleType);
        if (!match) {
            return false;
        }
        if (filters.durationMinutes !== undefined && match.durationMinutes !== filters.durationMinutes) {
            return false;
        }
        return true;
    }
    if (filters.durationMinutes !== undefined) {
        return pricing.some((entry) => entry.durationMinutes === filters.durationMinutes);
    }
    return true;
}

export function normalizeServiceEntity<T extends ServiceEntity>(entity: T): T {
    const vehiclePricing = resolveVehiclePricing(entity);
    return {
        ...entity,
        vehiclePricing,
        vehicleTypes: vehiclePricing.length > 0
            ? vehiclePricing.map((entry) => entry.vehicleType)
            : [...(entity.vehicleTypes ?? [])],
    };
}

export function servicePageKey(item: ServiceEntity): Record<string, unknown> {
    return {
        PK: item.PK,
        SK: item.SK,
        GSI2PK: item.GSI2PK ?? CatalogKeyBuilder.vendorPk(item.vendorId),
        GSI2SK: item.GSI2SK ?? CatalogKeyBuilder.vendorServiceSk(item.categoryId, item.serviceId),
    };
}

export function projectVehiclePricing(
    source: ServicePricingSource,
    vehicleType?: string,
): VehiclePricing[] {
    const pricing = resolveVehiclePricing(source);
    if (!vehicleType) {
        return pricing;
    }
    return pricing.filter((entry) => entry.vehicleType === vehicleType);
}
