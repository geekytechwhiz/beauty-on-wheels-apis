/**
 * Catalog Service — Internal DynamoDB entity interfaces.
 * These are the raw items stored in and retrieved from DynamoDB.
 * Never expose these outside the repository layer.
 */

export type EntityType =
    | 'CATEGORY'
    | 'SERVICE'
    | 'ADDON'
    | 'PACKAGE'
    | 'PACKAGE_ITEM'
    | 'SERVICE_LOOKUP'
    | 'SERVICE_VEHICLE'
    | 'ADDON_LOOKUP'
    | 'OfferingCommunity'
    | 'ServiceCreateIdempotency';

export interface CatalogBaseEntity {
    /** DynamoDB partition key */
    PK: string;
    /** DynamoDB sort key */
    SK: string;
    /** Entity type discriminator — used by LSI3 */
    entityType: EntityType;
    /** LSI1 sort key — display order */
    LSI1SK?: string;
    /** LSI2 sort key — active status */
    LSI2SK?: string;
    /** LSI3 sort key — entity type prefix */
    LSI3SK?: string;
    /** LSI4 sort key — vehicle type (service only) */
    LSI4SK?: string;
    /** LSI5 sort key — duration (service / addon) */
    LSI5SK?: string;
    /** GSI1 pk — normalised lowercase name */
    GSI1PK?: string;
    /** GSI1 sk — entity type discriminator (`TYPE#<entityType>`) */
    GSI1SK?: string;
    /** GSI2 pk — `VENDOR#<vendorId>` for vendor-owned catalog rows */
    GSI2PK?: string;
    /** GSI2 sk — `SERVICE#`, `PACKAGE#`, or `ADDON#` prefix */
    GSI2SK?: string;
    /**
     * Sparse community index. Set only on an OfferingCommunity row while the
     * service is active, the mapping is operationally active, and approval
     * is approved.
     */
    GSI3PK?: string;
    GSI3SK?: string;
    createdAt: string;
    updatedAt: string;
    /** Soft-delete flag */
    deletedAt?: string;
}

export interface CategoryEntity extends CatalogBaseEntity {
    entityType: 'CATEGORY';
    categoryId: string;
    name: string;
    description?: string;
    displayOrder: number;
    active: boolean;
}

/**
 * Price and duration for one vehicle type on a service offering.
 * Vehicle type codes come from the shared vehicle-type registry.
 */
export interface VehiclePricing {
    vehicleType: string;
    price: number;
    durationMinutes: number;
}

export interface ServiceEntity extends CatalogBaseEntity {
    entityType: 'SERVICE';
    vendorId: string;
    categoryId: string;
    serviceId: string;
    name: string;
    description?: string;
    /**
     * Authoritative per-vehicle price and duration.
     * Absent on records written before vehicle pricing. Readers synthesize it
     * from basePrice, durationMinutes, and vehicleTypes.
     */
    vehiclePricing?: VehiclePricing[];
    /**
     * Shortest configured duration. Kept so LSI5 and older clients still have
     * one number. The selected vehicle's duration is on vehiclePricing.
     */
    durationMinutes: number;
    /** Derived from vehiclePricing. Kept for applicability rows and older clients. */
    vehicleTypes: string[];
    /**
     * Lowest configured price. Kept for older clients and unfiltered discovery.
     * Pricing uses the selected vehiclePricing entry, not this field.
     */
    basePrice: number;
    displayOrder: number;
    active: boolean;
    /** Server-owned catalog input version for price and booking eligibility. */
    version?: number;
    /** Liters one booking uses. Absent when the service does not declare water use. */
    waterLiters?: number;
    /** Absent when the service does not declare that it needs water. */
    requiresWater?: boolean;
    /** Absent when the service does not declare that it needs vendor equipment. */
    requiresVendorEquipment?: boolean;
}

export interface AddonEntity extends CatalogBaseEntity {
    entityType: 'ADDON';
    vendorId: string;
    categoryId: string;
    serviceId: string;
    addonId: string;
    name: string;
    description?: string;
    price: number;
    durationMinutes: number;
    /** Server-owned catalog input version for add-on price and active state. */
    version?: number;
    displayOrder: number;
    active: boolean;
}

export interface PackageEntity extends CatalogBaseEntity {
    entityType: 'PACKAGE';
    vendorId: string;
    packageId: string;
    name: string;
    description?: string;
    discountedPrice: number;
    active: boolean;
    /** Server-owned catalog input version for package price, active state, and composition. */
    version?: number;
    displayOrder: number;
}

export const OFFERING_COMMUNITY_STATUS = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
} as const;

export type OfferingCommunityStatus =
    (typeof OFFERING_COMMUNITY_STATUS)[keyof typeof OFFERING_COMMUNITY_STATUS];

export const OFFERING_COMMUNITY_APPROVAL = {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
} as const;

export type OfferingCommunityApprovalStatus =
    (typeof OFFERING_COMMUNITY_APPROVAL)[keyof typeof OFFERING_COMMUNITY_APPROVAL];

/**
 * One community relationship for a vendor service.
 * `serviceId` stays the offering id. This row does not replace the SERVICE item.
 * `approvalStatus` and `status` are independent: active + pending is stored
 * but is not discoverable or bookable.
 * Records written before approval existed omit `approvalStatus`. Readers treat
 * that absence as pending and do not invent an approval.
 */
export interface OfferingCommunityEntity extends CatalogBaseEntity {
    entityType: 'OfferingCommunity';
    vendorId: string;
    categoryId: string;
    serviceId: string;
    communityId: string;
    status: OfferingCommunityStatus;
    approvalStatus?: OfferingCommunityApprovalStatus;
    /** Set when an admin or automatic approval records a decision. */
    approvalUpdatedAt?: string;
    approvalUpdatedBy?: string;
    /** Copied from the service so the community index can drop without rewriting status. */
    serviceActive: boolean;
    version: number;
}

export interface ServiceCreateIdempotencyEntity {
    PK: string;
    SK: string;
    entityType: 'ServiceCreateIdempotency';
    vendorId: string;
    serviceId: string;
    categoryId: string;
    idempotencyKey: string;
    createdAt: string;
}

export interface ServiceLookupEntity extends CatalogBaseEntity {
    entityType: 'SERVICE_LOOKUP';
    vendorId: string;
    categoryId: string;
    serviceId: string;
    active: boolean;
}

export interface ServiceVehicleEntity extends CatalogBaseEntity {
    entityType: 'SERVICE_VEHICLE';
    categoryId: string;
    serviceId: string;
    vehicleType: string;
    active: boolean;
}

export interface AddonLookupEntity extends CatalogBaseEntity {
    entityType: 'ADDON_LOOKUP';
    vendorId: string;
    categoryId: string;
    serviceId: string;
    addonId: string;
    active: boolean;
}

export interface PackageItemEntity extends CatalogBaseEntity {
    entityType: 'PACKAGE_ITEM';
    packageId: string;
    /** Either serviceId or addonId depending on item type */
    refId: string;
    itemType: 'SERVICE' | 'ADDON';
}
