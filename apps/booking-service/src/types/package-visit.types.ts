/**
 * Package visit lifecycle (Booking SCREAMING_SNAKE convention, matching plans/bookings).
 *
 * UNSCHEDULED → SCHEDULED → IN_PROGRESS → COMPLETED
 * UNSCHEDULED | SCHEDULED → CANCELLED
 * SCHEDULED → MISSED (vendor/policy mark when visit window elapsed unused)
 * SCHEDULED → UNSCHEDULED is not allowed; use reschedule to change the slot.
 */
export const PACKAGE_VISIT_STATUS = {
  UNSCHEDULED: 'UNSCHEDULED',
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  MISSED: 'MISSED',
} as const;

export type PackageVisitStatus =
  (typeof PACKAGE_VISIT_STATUS)[keyof typeof PACKAGE_VISIT_STATUS];

/** Plan-level scheduling summary for multi-visit confirmation. */
export const PACKAGE_SCHEDULE_STATE = {
  NONE: 'NONE',
  IN_PROGRESS: 'IN_PROGRESS',
  PARTIAL: 'PARTIAL',
  COMPLETE: 'COMPLETE',
} as const;

export type PackageScheduleState =
  (typeof PACKAGE_SCHEDULE_STATE)[keyof typeof PACKAGE_SCHEDULE_STATE];

export interface PackageVisitSchedule {
  date: string;
  startTime: string;
  endTime?: string;
  timezone: string;
  branchId: string;
  slotId?: string;
  allocationId?: string;
  durationMinutes: number;
}

export interface PackageVisitScheduleHistoryEntry {
  at: string;
  action: 'scheduled' | 'rescheduled' | 'released' | 'cancelled';
  by: string;
  from?: Partial<PackageVisitSchedule>;
  to?: Partial<PackageVisitSchedule>;
  reason?: string;
}

export interface PackageVisitRecord {
  visitId: string;
  planId: string;
  customerId: string;
  vendorId: string;
  /** Stable catalog entitlement id (serviceKey or slug). */
  serviceId: string;
  serviceName: string;
  /** 1-based index among visits for this serviceId within the plan. */
  sequence: number;
  /** Global 1-based index among all visits on the plan. */
  ordinal: number;
  status: PackageVisitStatus;
  durationMinutes: number;
  schedule?: PackageVisitSchedule;
  scheduleHistory: PackageVisitScheduleHistoryEntry[];
  /** When true, remainingVisits / entitlement accounting already applied. */
  entitlementConsumed: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  completedBy?: string;
  startedAt?: string;
  startedBy?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
  missedAt?: string;
}

export type PackageVisitResponse = Omit<PackageVisitRecord, 'customerId' | 'version'>;

export interface PackageVisitDdbItem extends PackageVisitRecord {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  GSI2PK: string;
  GSI2SK: string;
  GSI3PK?: string;
  GSI3SK?: string;
  entityType: 'PackageVisit';
}

export interface PackageVisitProgress {
  totalVisits: number;
  remainingVisits: number;
  completedVisits: number;
  cancelledVisits: number;
  missedVisits: number;
  scheduledVisits: number;
  unscheduledVisits: number;
  inProgressVisits: number;
  byService: Array<{
    serviceId: string;
    total: number;
    remaining: number;
    completed: number;
  }>;
  scheduleState: PackageScheduleState;
}

export interface PackageVisitListPage {
  items: PackageVisitResponse[];
  nextCursor?: string;
  hasMore: boolean;
}
