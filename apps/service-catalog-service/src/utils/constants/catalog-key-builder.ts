/**
 * Catalog Service — DynamoDB Key Builder
 * Central place for all PK / SK / LSI / GSI key patterns in the service-catalog domain.
 */

export const CatalogKeyBuilder = {

    /* --------------------------------
       CATEGORY
    -------------------------------- */

    categoryPk: (categoryId: string) => `CAT#${categoryId}`,

    categorySk: () => `META`,

    categoryPrefix: () => `CAT#`,

    /* --------------------------------
       SERVICE (child of Category)
    -------------------------------- */

    serviceSk: (serviceId: string) => `SERVICE#${serviceId}`,

    serviceSkPrefix: () => `SERVICE#`,

    /* --------------------------------
       ADDON (child of Service)
    -------------------------------- */

    addonSk: (serviceId: string, addonId: string) =>
        `SERVICE#${serviceId}#ADDON#${addonId}`,

    addonSkPrefix: (serviceId: string) =>
        `SERVICE#${serviceId}#ADDON#`,

    /* --------------------------------
       PACKAGE
    -------------------------------- */

    packagePk: (packageId: string) => `PACKAGE#${packageId}`,

    packageSk: () => `META`,

    packagePrefix: () => `PACKAGE#`,

    /* --------------------------------
       PACKAGE ITEMS
    -------------------------------- */

    packageItemServiceSk: (serviceId: string) => `ITEM#SERVICE#${serviceId}`,

    packageItemAddonSk: (addonId: string) => `ITEM#ADDON#${addonId}`,

    packageItemPrefix: () => `ITEM#`,

    /* --------------------------------
       LSI SORT KEYS
    -------------------------------- */

    /** LSI1 — Display Order */
    lsi1sk: (displayOrder: number) =>
        `DISPLAY_ORDER#${String(displayOrder).padStart(10, '0')}`,

    /** LSI2 — Active Status */
    lsi2sk: (active: boolean) =>
        `ACTIVE#${active ? '1' : '0'}`,

    /** LSI3 — Entity Type */
    lsi3sk: (entityType: string) =>
        `TYPE#${entityType}`,

    /** LSI4 — Vehicle Type */
    lsi4sk: (vehicleType: string) =>
        `VEHICLE#${vehicleType}`,

    /** LSI5 — Duration */
    lsi5sk: (durationMinutes: number) =>
        `DURATION#${String(durationMinutes).padStart(10, '0')}`,

    /* --------------------------------
       GSI ATTRIBUTES
    -------------------------------- */

    /** GSI1 pk — normalised lowercase name for global name search / duplicate detection */
    gsi1pk: (name: string) => name.trim().toLowerCase(),

    /** GSI1 sk — entity type discriminator so name lookups can be scoped per type */
    gsi1sk: (entityType: string) => `TYPE#${entityType}`,

};
