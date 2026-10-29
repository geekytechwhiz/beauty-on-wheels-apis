export const env = {
  SERVICE_NAME: process.env.SERVICE_NAME || '',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME || '',
  /**
   * Shared vendor event bus. Service visit lifecycle is published from the
   * catalog table stream, so a failed publish retries with the stream record.
   * The DynamoDB write and EventBridge publish are not one transaction.
   */
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
  /** Vendor HTTP API used to verify owner membership, communities, and staff. */
  VENDOR_BASE_URL: process.env.VENDOR_BASE_URL || '',
  /**
   * When the value is exactly `true`, newly created offering-community
   * mappings are stored as approved. Any other value, including a missing
   * variable, requires admin approval. This does not rewrite existing rows.
   * Callers read process.env at decision time; do not cache a boolean here.
   */
  COMMUNITY_OFFERING_AUTO_APPROVE: process.env.COMMUNITY_OFFERING_AUTO_APPROVE || 'false',
  /**
   * Vendor Service Lambda that checks platform community directory records.
   * Empty fails closed when a service selects communities.
   */
  COMMUNITY_DIRECTORY_FUNCTION: process.env.COMMUNITY_DIRECTORY_FUNCTION || '',
};
