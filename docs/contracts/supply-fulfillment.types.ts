/**
 * Wire models for the Carish Supply & Fulfilment admin screen.
 * These match the service responses. They are not the demo shapes in the admin app.
 * Enum values that already exist on Vendor and Booking stay in their stored form.
 */

export interface PageNotice {
  total: number | null;
  totalAvailability: 'complete' | 'unavailable';
  totalReason: string;
}

export interface CommunityListQuery {
  search?: string;
  status?: 'active' | 'inactive' | 'all';
  cityId?: string;
  localityId?: string;
  postalCode?: string;
  limit?: number;
  cursor?: string;
}

export interface CommunityListResponse {
  items: Array<{ communityId: string; name: string; status: 'active' | 'inactive' }>;
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
  } & PageNotice;
}

export interface VendorListQuery {
  status?: string;
  operationalStatus?: string;
  communityId?: string;
  limit?: number;
  cursor?: string;
}

export interface OpsCapacityCommitmentQuery {
  vendorId?: string;
  communityId?: string;
  status?: 'ACTIVE' | 'CHANGE_PENDING' | 'REDUCED' | 'CANCELLED';
  fromDate?: string;
  toDate?: string;
  dailyWindowStart?: string;
  dailyWindowEnd?: string;
  limit?: number;
  cursor?: string;
}

export interface CapacityCommitment {
  commitmentId: string;
  proposalId: string;
  vendorId: string;
  communityId: string;
  scope: { offeringId?: string; serviceScopeCode?: string; label: string };
  window: {
    startDate: string;
    endDate: string;
    dailyWindow: { startTime: string; endTime: string };
    daysOfWeek?: string[];
  };
  quantity: number;
  rate: { amountMinor: number; currency: 'INR' };
  status: 'ACTIVE' | 'CHANGE_PENDING' | 'REDUCED' | 'CANCELLED';
  reservedSoldQuantity: number;
  createdAt: string;
  updatedAt: string;
}

export interface OpsCapacityCommitmentListResponse {
  data: {
    items: CapacityCommitment[];
    pagination: { nextCursor: string | null; hasMore: boolean };
    coverage: {
      path: 'vendorBaseTable' | 'operationsIndex';
      includesLegacyRows: boolean;
      pageIsPopulation: false;
      populationTotal: null;
      reason: string;
    };
  };
}

export interface CapacityProposalCreateRequest {
  vendorId: string;
  communityId: string;
  packageScope: { offeringId?: string; serviceScopeCode?: string; label: string };
  serviceWindow: CapacityCommitment['window'];
  quantity: number;
  responseDeadline: string;
  proposedPayoutRate: { amountMinor: number; currency: 'INR' };
  sendImmediately?: boolean;
  note?: string;
}

export interface OpsDispatchQuery {
  date: string;
  communityId?: string;
  vendorId?: string;
  visitWindowId?: string;
  status?: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'MISSED' | 'UNSCHEDULED';
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface OpsDispatchVisit {
  visitId: string;
  planId: string;
  vendorId: string;
  communityId?: string;
  visitWindowId?: string;
  visitWindowName?: string;
  status: string;
  scheduledDate?: string;
  startTime?: string;
  endTime?: string;
  serviceName: string;
  durationMinutes: number;
  slotUnits: number;
  registrationNumber?: string;
  assignedCrew: { crewId: string; assignedAt: string } | null;
}

export interface OpsDispatchVisitListResponse {
  definition: string;
  items: OpsDispatchVisit[];
  pagination: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  } & PageNotice;
  coverage: {
    source: 'packageVisitOpsScheduleIndex';
    includesVisitsWrittenBeforeIndex: false;
    reason: string;
  };
}

export interface OpsDemandQuery {
  communityId: string;
  fromDate: string;
  toDate: string;
  visitWindowId?: string;
}

export interface DemandBucket {
  demandVisits: number;
  demandSlotUnits: number;
  scheduled: number;
  inProgress: number;
  completed: number;
  missed: number;
  cancelled: number;
}

export interface OpsPackageVisitDemandResponse {
  communityId: string;
  fromDate: string;
  toDate: string;
  visitWindowId?: string;
  definition: string;
  unit: { name: 'slotUnit'; minutes: 30; compareWith: string };
  completeness: 'indexedRows' | 'unavailable';
  completenessReason: string;
  totals: DemandBucket | null;
  byWindow: Array<DemandBucket & { visitWindowId: string; visitWindowName?: string }>;
}

export type SalesControlEligibility = 'open' | 'held' | 'scheduled' | 'expired';

export interface SalesControlWriteRequest {
  enabled: boolean;
  expectedVersion?: number;
  reason: string;
  effectiveFrom?: string;
  effectiveUntil?: string;
  fulfilmentVendorIds: string[];
  capacityCommitmentIds: string[];
}

export interface SalesControl {
  packageId: string;
  packageName?: string;
  communityId: string;
  categoryId: string;
  enabled: boolean;
  eligibility?: SalesControlEligibility;
  reason: string;
  effectiveFrom?: string;
  effectiveUntil?: string;
  fulfilmentVendorIds: string[];
  capacityCommitmentIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SalesControlListQuery {
  packageId?: string;
  communityId?: string;
  status?: SalesControlEligibility | 'enabled' | 'disabled';
  limit?: number;
  offset?: number;
}

export interface SalesControlListResponse {
  items: SalesControl[];
  total: number;
  pagination: {
    limit: number;
    offset: number;
    nextOffset: number | null;
    hasMore: boolean;
    totalAvailability: 'complete';
    totalReason: string;
  };
}
