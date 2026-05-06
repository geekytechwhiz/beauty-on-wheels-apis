export interface AlertSla {
  assignSlaMinutes: number;
  resolveSlaMinutes: number;

  /** Unix epoch milliseconds (UTC). */
  assignSlaDueAt: number;
  /** Unix epoch milliseconds (UTC). */
  resolveSlaDueAt: number;

  slaBreachIndicator: boolean;

  assignSlaBreachedAt?: number;
  resolveSlaBreachedAt?: number;
}
