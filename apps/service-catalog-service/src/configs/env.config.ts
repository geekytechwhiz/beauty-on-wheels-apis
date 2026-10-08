export const env = {
  SERVICE_NAME: process.env.SERVICE_NAME || '',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME || '',
  EVENT_BUS_NAME: process.env.EVENT_BUS_NAME || '',
  /**
   * Vendor Service base URL used to read provider price overrides.
   * Empty means pricing with vendorId fails closed. Catalog never reads
   * the vendor table.
   */
  VENDOR_SERVICE_URL: process.env.VENDOR_SERVICE_URL || '',
};
