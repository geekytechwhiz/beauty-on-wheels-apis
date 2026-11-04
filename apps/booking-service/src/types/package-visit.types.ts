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

/**
 * Crew assigned to this scheduled visit.
 * Staff membership is not stored here. It is read from Vendor Service at assignment time.
 */
export interface PackageVisitCrewAssignment {
  crewId: string;
  assignedAt: string;
  assignedBy: string;
}

/**
 * Visit-window clock copied from the plan when both bounds were stored.
 * Absent when the plan has only a label. Slot reservation times stay on `schedule`.
 */
export interface PackageVisitWindowSnapshot {
  visitWindowId: string;
  startTime?: string;
  endTime?: string;
  timezone?: string;
  allDay?: boolean;
}

/** Review state of the evidence submitted when a visit was completed. */
export const VISIT_VALIDATION_STATUS = {
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type VisitValidationStatus =
  (typeof VISIT_VALIDATION_STATUS)[keyof typeof VISIT_VALIDATION_STATUS];

export interface VisitChecklistItem {
  itemId: string;
  label: string;
  done: true;
}

/**
 * Evidence submitted on completion. Binary files live in S3 and are referenced
 * by object key only. Nothing here is a URL or file content.
 */
export interface VisitCompletionEvidence {
  checklist: VisitChecklistItem[];
  evidenceKeys: string[];
  submittedAt: string;
  submittedBy: { staffId: string; userId?: string };
}

export interface PackageVisitRecord {
  visitId: string;
  planId: string;
  customerId: string;
  vendorId: string;
  /** Copied from the parent plan. Missing on visits materialized before the operational snapshot. */
  communityId?: string;
  visitWindowId?: string;
  visitWindowName?: string;
  /** Authoritative window clock. Not inferred from visitWindowName or schedule.startTime. */
  visitWindowSnapshot?: PackageVisitWindowSnapshot;
  vehicleId?: string;
  vehicleType?: string;
  /** Uppercase registration used for vendor search. */
  registrationNumber?: string;
  vehicleDisplayName?: string;
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
  /** Present only while this visit is assigned to a vendor crew. Cleared on cancel and reschedule. */
  crewAssignment?: PackageVisitCrewAssignment;
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
  /** Set when the visit is completed. Absent on visits completed before evidence was required. */
  completionEvidence?: VisitCompletionEvidence;
  /** PENDING_REVIEW until an admin decides. Absent on legacy completed visits. */
  validationStatus?: VisitValidationStatus;
  /** False until an admin APPROVES the completion. Never set by the vendor. */
  payoutEligible?: boolean;
  /**
   * Agreed vendor rate for settlement. Reserved: Booking has no commitment
   * lookup yet, so this is never populated by the completion path.
   */
  agreedVendorRateMinor?: number;
  reviewedAt?: string;
  reviewedBy?: string;
  /** Internal admin note. Never returned in visit responses. */
  reviewNote?: string;
}

/**
 * Customer and plan visit responses do not expose crew assignment, the internal
 * admin review note, or the settlement rate.
 */
export type PackageVisitResponse = Omit<
  PackageVisitRecord,
  'customerId' | 'version' | 'crewAssignment' | 'reviewNote' | 'agreedVendorRateMinor'
>;

export interface PackageVisitDdbItem extends PackageVisitRecord {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  GSI2PK: string;
  GSI2SK: string;
  GSI3PK?: string;
  GSI3SK?: string;
  /** Dated operations schedule. Absent on unscheduled visits. */
  GSI4PK?: string;
  GSI4SK?: string;
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
