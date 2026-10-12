export const env = {
  SERVICE_NAME: process.env.SERVICE_NAME || '',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME || '',
  EVENT_BUS_NAME: process.env.EVENT_BUS_NAME || '',
  SLOT_HOLD_TTL_SECONDS: positiveInt(
    process.env.SLOT_HOLD_TTL_SECONDS,
    600,
  ),
  EXPIRY_LOOKBACK_HOURS: positiveInt(
    process.env.EXPIRY_LOOKBACK_HOURS,
    48,
  ),
};

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}
