const IDENTITY_TABLE_ENV = 'IDENTITY_TABLE';

/**
 * Resolves the DynamoDB identity table name from environment.
 *
 * @throws Error when `IDENTITY_TABLE` is unset or blank.
 */
export function assertIdentityTable(): string {
  const table =
    typeof process.env[IDENTITY_TABLE_ENV] === 'string'
      ? process.env[IDENTITY_TABLE_ENV]!.trim()
      : '';

  if (!table) {
    throw new Error(
      `${IDENTITY_TABLE_ENV} environment variable is required for identity repositories`,
    );
  }

  return table;
}
