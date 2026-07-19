/**
 * Catalog Service — Internal DynamoDB entity interfaces.
 * These are the raw items stored in and retrieved from DynamoDB.
 * Never expose these outside the repository layer.
 */

export type EntityType = 'CATEGORY' | 'SERVICE' | 'ADDON' | 'PACKAGE' | 'PACKAGE_ITEM';

export interface CatalogBaseEntity {
    /** DynamoDB partition key */
    pk: string;
    /** DynamoDB sort key */
    sk: string;
    /** Entity type discriminator — used by LSI3 */
    entityType: EntityType;
    /** LSI1 sort key — display order */
    lsi1sk?: string;
    /** LSI2 sort key — active status */
    lsi2sk?: string;
    /** LSI3 sort key — entity type prefix */
    lsi3sk?: string;
    /** LSI4 sort key — vehicle type (service only) */
    lsi4sk?: string;
    /** LSI5 sort key — duration (service / addon) */
    lsi5sk?: string;
    /** GSI1 pk — normalised lowercase name */
    GSI1PK?: string;
    /** GSI1 sk — entity type discriminator (`TYPE#<entityType>`) */
    GSI1SK?: string;
    /** Legacy lowercase aliases */
    gsi1pk?: string;
    gsi1sk?: string;
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
    categoryId: string;
    serviceId: string;
    name: string;
    description?: string;
    durationMinutes: number;
    vehicleTypes: string[];
    basePrice: number;
    displayOrder: number;
    active: boolean;
}

export interface AddonEntity extends CatalogBaseEntity {
    entityType: 'ADDON';
    categoryId: string;
    serviceId: string;
    addonId: string;
    name: string;
    description?: string;
    price: number;
    durationMinutes: number;
    displayOrder: number;
    active: boolean;
}

export interface PackageEntity extends CatalogBaseEntity {
    entityType: 'PACKAGE';
    packageId: string;
    name: string;
    description?: string;
    discountedPrice: number;
    active: boolean;
    displayOrder: number;
}

export interface PackageItemEntity extends CatalogBaseEntity {
    entityType: 'PACKAGE_ITEM';
    packageId: string;
    /** Either serviceId or addonId depending on item type */
    refId: string;
    itemType: 'SERVICE' | 'ADDON';
}
