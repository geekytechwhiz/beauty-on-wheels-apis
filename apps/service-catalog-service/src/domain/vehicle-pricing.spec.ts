import { BaseError } from '@api-hub/utils';

import {
    projectVehiclePricing,
    resolveUpdatedPricing,
    resolveVehiclePricing,
    sameVehiclePricing,
    serviceMatchesListFilters,
    vehiclePricingFromLegacy,
} from './vehicle-pricing';

const legacy = {
    basePrice: 499,
    durationMinutes: 45,
    vehicleTypes: ['HATCHBACK', 'SEDAN', 'SUV'],
};

const distinct = [
    { vehicleType: 'HATCHBACK', price: 399, durationMinutes: 30 },
    { vehicleType: 'SEDAN', price: 499, durationMinutes: 45 },
    { vehicleType: 'SUV', price: 699, durationMinutes: 60 },
];

describe('vehicle pricing', () => {
    it('turns a legacy offering into one price and duration per vehicle type', () => {
        expect(vehiclePricingFromLegacy(legacy)).toEqual([
            { vehicleType: 'HATCHBACK', price: 499, durationMinutes: 45 },
            { vehicleType: 'SEDAN', price: 499, durationMinutes: 45 },
            { vehicleType: 'SUV', price: 499, durationMinutes: 45 },
        ]);
        expect(resolveVehiclePricing(legacy)).toEqual(vehiclePricingFromLegacy(legacy));
    });

    it('keeps stored vehicle pricing when it is already present', () => {
        expect(resolveVehiclePricing({ ...legacy, vehiclePricing: distinct })).toEqual(distinct);
    });

    it('rejects duplicate types, invalid prices, and invalid durations', () => {
        expect(() => vehiclePricingFromLegacy({ ...legacy, vehicleTypes: ['SUV', 'SUV'] }))
            .toThrow(BaseError);
        expect(() => vehiclePricingFromLegacy({ ...legacy, basePrice: -1 }))
            .toThrow(expect.objectContaining({ code: 'INVALID_PRICE' }));
        expect(() => vehiclePricingFromLegacy({ ...legacy, durationMinutes: 0 }))
            .toThrow(BaseError);
        expect(() => vehiclePricingFromLegacy({ ...legacy, vehicleTypes: ['OTHER'] }))
            .toThrow(expect.objectContaining({ code: 'INVALID_VEHICLE_TYPE' }));
    });

    it('replaces one vehicle price without changing the others', () => {
        const next = resolveUpdatedPricing(
            { vehiclePricing: distinct },
            {
                vehiclePricing: [
                    distinct[0],
                    distinct[1],
                    { vehicleType: 'SUV', price: 749, durationMinutes: 60 },
                ],
            },
        );
        expect(next.find((entry) => entry.vehicleType === 'SUV')?.price).toBe(749);
        expect(next.find((entry) => entry.vehicleType === 'SEDAN')).toEqual(distinct[1]);
        expect(sameVehiclePricing(next, distinct)).toBe(false);
    });

    it('adds and removes a vehicle type through the replacement array', () => {
        const added = resolveUpdatedPricing(
            { vehiclePricing: distinct },
            { vehiclePricing: [...distinct, { vehicleType: 'MUV', price: 799, durationMinutes: 70 }] },
        );
        expect(added.map((entry) => entry.vehicleType)).toEqual(['HATCHBACK', 'SEDAN', 'SUV', 'MUV']);

        const removed = resolveUpdatedPricing(
            { vehiclePricing: distinct },
            { vehiclePricing: [distinct[0], distinct[2]] },
        );
        expect(removed.map((entry) => entry.vehicleType)).toEqual(['HATCHBACK', 'SUV']);
    });

    it('preserves pricing when the update does not mention it', () => {
        expect(resolveUpdatedPricing({ vehiclePricing: distinct }, {})).toEqual(distinct);
    });

    it('applies a legacy price change to every current vehicle type', () => {
        const next = resolveUpdatedPricing({ vehiclePricing: distinct }, { basePrice: 10 });
        expect(next.every((entry) => entry.price === 10)).toBe(true);
        expect(next.find((entry) => entry.vehicleType === 'SUV')?.durationMinutes).toBe(60);
    });

    it('filters by vehicle type and projects only that price', () => {
        const source = { vehiclePricing: distinct };
        expect(serviceMatchesListFilters(source, { vehicleType: 'SUV' })).toBe(true);
        expect(serviceMatchesListFilters(source, { vehicleType: 'BIKE' })).toBe(false);
        expect(serviceMatchesListFilters(source, { vehicleType: 'SUV', durationMinutes: 60 })).toBe(true);
        expect(serviceMatchesListFilters(source, { vehicleType: 'SUV', durationMinutes: 30 })).toBe(false);
        expect(projectVehiclePricing(source, 'SUV')).toEqual([distinct[2]]);
        expect(projectVehiclePricing(source)).toEqual(distinct);
    });
});
