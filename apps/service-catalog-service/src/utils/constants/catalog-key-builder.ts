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

    /** Direct lookup so pricing and packages can resolve a service without its category. */
    serviceLookupPk: (serviceId: string) => `SERVICE#${serviceId}`,

    serviceLookupSk: () => `META`,

    /**
     * One applicability row per vehicle type under the category partition.
     * A single service item cannot be indexed under every type on LSI4.
     */
    vehicleApplicabilitySk: (vehicleType: string, serviceId: string) =>
        `VEHICLE#${vehicleType}#SERVICE#${serviceId}`,

    vehicleApplicabilityPrefix: (vehicleType: string) =>
        `VEHICLE#${vehicleType}#SERVICE#`,

    /* --------------------------------
       ADDON (child of Service)
    -------------------------------- */

    addonSk: (serviceId: string, addonId: string) =>
        `SERVICE#${serviceId}#ADDON#${addonId}`,

    addonSkPrefix: (serviceId: string) =>
        `SERVICE#${serviceId}#ADDON#`,

    addonLookupPk: (addonId: string) => `ADDON#${addonId}`,

    addonLookupSk: () => `META`,

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

    /**
     * Offering revision. `kind` keeps a service id distinct from a package id.
     * Booking's offeringId is the service id; its revision key uses SERVICE.
     */
    offeringRevisionPk: (kind: "SERVICE" | "PACKAGE", offeringId: string) =>
        `OFFERING#${kind}#${offeringId}`,

    offeringRevisionSk: (vendorId: string) => `VENDOR#${vendorId}`,

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

    /**
     * GSI1 sk for a vendor-owned name. Same display name may exist for another vendor.
     * Packages use this key. Categories stay on `gsi1sk`.
     */
    gsi1VendorSk: (entityType: string, vendorId: string) =>
        `TYPE#${entityType}#VENDOR#${vendorId}`,

    /** Service names are unique per vendor and master category. */
    gsi1VendorCategorySk: (entityType: string, vendorId: string, categoryId: string) =>
        `TYPE#${entityType}#VENDOR#${vendorId}#CAT#${categoryId}`,

    /* --------------------------------
       GSI2 — vendor catalog
    -------------------------------- */

    /** GSI2 pk — every service, package, and add-on owned by one vendor. */
    vendorPk: (vendorId: string) => `VENDOR#${vendorId}`,

    vendorServiceSk: (categoryId: string, serviceId: string) =>
        `SERVICE#${categoryId}#${serviceId}`,

    vendorServicePrefix: () => `SERVICE#`,

    vendorServiceCategoryPrefix: (categoryId: string) => `SERVICE#${categoryId}#`,

    vendorPackageSk: (packageId: string) => `PACKAGE#${packageId}`,

    vendorPackagePrefix: () => `PACKAGE#`,

    vendorAddonSk: (serviceId: string, addonId: string) =>
        `ADDON#${serviceId}#${addonId}`,

    vendorAddonPrefix: () => `ADDON#`,

    vendorAddonServicePrefix: (serviceId: string) => `ADDON#${serviceId}#`,

    /* --------------------------------
       GSI2 — marketplace discovery
       Separate items from the vendor catalog rows above.
       GSI2 itself is unchanged: vendor rows stay on VENDOR#<vendorId>.
    -------------------------------- */

    /** GSI2 pk for every eligible service, regardless of category. */
    discoveryAllPk: () => `DISCOVERY#ALL`,

    /** GSI2 pk for services in one master category. */
    discoveryCategoryPk: (categoryId: string) => `DISCOVERY#CATEGORY#${categoryId}`,

    /**
     * Sort key shared by the global and category discovery items.
     * `branchKey` is UNASSIGNED when no branch coverage has been recorded.
     */
    discoveryItemSk: (serviceId: string, branchKey: string) =>
        `SERVICE#${serviceId}#BRANCH#${branchKey}`,

    /** Base-table partition that lists discovery rows for one service. */
    discoveryServicePk: (serviceId: string) => `DISCOVERY#SERVICE#${serviceId}`,

    discoveryPointerSk: (branchKey: string) => `BRANCH#${branchKey}`,

    /** Local copy of vendor approval. Not projected onto GSI2. */
    discoveryVendorPk: (vendorId: string) => `DISCOVERY_VENDOR#${vendorId}`,

    discoveryVendorSk: () => `META`,

    /** Local copy of branch coverage. Not projected onto GSI2. */
    discoveryBranchPk: (vendorId: string) => `DISCOVERY_BRANCH#${vendorId}`,

    discoveryBranchSk: (branchId: string) => `BRANCH#${branchId}`,

    /** Local copy of a provider price override. Not projected onto GSI2. */
    discoveryPricePk: (vendorId: string) => `DISCOVERY_PRICE#${vendorId}`,

    discoveryPriceSk: (serviceId: string) => `SERVICE#${serviceId}`,

};
