export const env = {
  SERVICE_NAME: process.env.SERVICE_NAME || '',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME || '',
  EVENT_BUS_NAME: process.env.EVENT_BUS_NAME || '',
  /**
   * Vendor Service Lambda that returns pricing configuration.
   * Empty means pricing with vendorId fails closed. Catalog never reads
   * the vendor table and does not call the owner HTTP API.
   */
  VENDOR_PRICING_CONFIGURATION_FUNCTION: process.env.VENDOR_PRICING_CONFIGURATION_FUNCTION || '',
  /**
   * Vendor Service Lambda that returns approval, branches, coverage, and prices.
   * Empty skips the copy. Discovery then uses facts already stored from events.
   */
  VENDOR_DISCOVERY_FACTS_FUNCTION: process.env.VENDOR_DISCOVERY_FACTS_FUNCTION || '',
  /**
   * Availability Lambda that reports which offerings have a bookable slot
   * on a date. Empty rejects availableOn instead of skipping the filter.
   */
  AVAILABILITY_BOOKABLE_FUNCTION: process.env.AVAILABILITY_BOOKABLE_FUNCTION || '',
};
