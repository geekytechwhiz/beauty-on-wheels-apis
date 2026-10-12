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
    | 'ADDON_LOOKUP';

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

export interface ServiceEntity extends CatalogBaseEntity {
    entityType: 'SERVICE';
    vendorId: string;
    categoryId: string;
    serviceId: string;
    name: string;
    description?: string;
    durationMinutes: number;
    vehicleTypes: string[];
    basePrice: number;
    displayOrder: number;
    active: boolean;
    /** Server-owned catalog input version for price and booking eligibility. */
    version?: number;
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
