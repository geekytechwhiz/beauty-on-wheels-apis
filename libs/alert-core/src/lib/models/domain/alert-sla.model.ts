export interface AlertSla {
  assignSlaMinutes: number;
  resolveSlaMinutes: number;

  assignSlaDueAt: string;
  resolveSlaDueAt: string;

  slaBreachIndicator: boolean;

  assignSlaBreachedAt?: string;
  resolveSlaBreachedAt?: string;
}
