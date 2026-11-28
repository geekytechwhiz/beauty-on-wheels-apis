import { createLogger } from '@api-hub/observability';
import { BaseError } from '@api-hub/utils';

const logger = createLogger({ service: 'partner-internal-client', redactPII: true });

export interface PartnerActor {
  userId: string;
  vendorId: string;
  roles: string[];
  permissions: string[];
  correlationId: string;
}

export interface OperationalAccess {
  role: 'owner' | 'staff' | 'none';
  vendorId?: string;
  staffId?: string;
  active: boolean;
}

export interface ManagerVisit {
  visitId: string;
  planId: string;
  communityId?: string;
  visitWindowId?: string;
  visitWindowName?: string;
  window?: { startTime?: string; endTime?: string; allDay?: boolean };
  date: string;
  startTime?: string;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'MISSED';
  /** When the visit entered `status`. Omitted when Booking has no authoritative timestamp. */
  statusAt?: string;
  /** Completion evidence review state; normally present only on completed work. */
  reviewStatus?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  parkingBay?: string;
  crewId?: string;
  vehicle?: { vehicleId?: string; registrationNumber?: string; displayName?: string; vehicleType?: string };
  service: { serviceId: string; name: string; estimatedMinutes: number };
}

export interface ManagerIssue {
  issueId: string;
  visitId?: string;
  communityId?: string;
  type: string;
  status: 'OPEN' | 'TRIAGED' | 'ACTION_REQUIRED' | 'RESOLVED';
  createdAt: string;
  updatedAt: string;
  /**
   * True only while the issue still blocks its visit. Omitted by legacy rows and,
   * from current Booking, by resolved issues. The BFF never treats absence as a blocker.
   */
  blocksVisit?: boolean;
  /** Server-recorded start of the blocking state; omitted on pre-migration rows. */
  blockingStartedAt?: string;
}

export interface ManagerProgress {
  expected: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  /** Null indicates that issue data was unavailable; it is never a fabricated zero. */
  blocked: number | null;
  unassigned: number;
  missed: number;
  cancelled: number;
}

export interface ManagerDay {
  date: string;
  visits: ManagerVisit[];
  progress: ManagerProgress;
}

/** How Booking chose the vendor operations timezone for this read. */
export type ManagerTimezoneSource = 'SCHEDULE' | 'DEFAULT';

export interface ManagerOverview {
  timezone: string;
  /** Present on current Booking builds; omitted by older deployments. */
  timezoneSource?: ManagerTimezoneSource;
  days: ManagerDay[];
  issues: ManagerIssue[];
  issuesAvailable: boolean;
  sourceAsOf: string;
}

export interface ManagerCrewSummary {
  crewId: string;
  /** Whole filtered day for the crew, independent of page and view. */
  progress: ManagerProgress;
}

export interface ManagerWorkPage {
  timezone: string;
  timezoneSource?: ManagerTimezoneSource;
  date: string;
  /** Whole filtered day, independent of page and view. */
  summary: ManagerProgress;
  /** Omitted by Booking deployments that predate per-crew summaries. */
  crewSummaries?: ManagerCrewSummary[];
  items: ManagerVisit[];
  issues: ManagerIssue[];
  issuesAvailable: boolean;
  /** Visits in the requested view for the whole day at the walk's snapshot; omitted by older Booking deployments. */
  total?: number;
  nextCursor: string | null;
  hasMore: boolean;
  sourceAsOf: string;
}

export interface ManagerPlanningPage extends Omit<ManagerWorkPage, 'issues' | 'issuesAvailable' | 'crewSummaries' | 'total'> {
  counts: { scheduled: number; assigned: number; unassigned: number };
  /** Whole requested planning scope; never derived from the current page. */
  capacityWorkload?: { assignedCapacityUnits: number };
  tab: 'unassigned' | 'assigned' | 'availability';
}

export interface SchedulingCrew {
  crewId: string;
  vendorId: string;
  name: string;
  vanLabel: string;
  status: string;
  availabilityStatus: 'AVAILABLE' | 'UNAVAILABLE';
  availabilityReason?: 'CREW_INACTIVE' | 'INSUFFICIENT_ACTIVE_STAFF';
  /** Daily workload limit in the Vendor capacity slot-unit. */
  capacityPerDay: number;
  staff: Array<{ staffId: string; name?: string; status: string }>;
  /** Designated contact, else the first ACTIVE member. Omitted when no member is active. */
  pointOfContact?: {
    staffId: string;
    name: string;
    phoneNumber?: string;
    source: 'designated' | 'firstActiveMember';
  };
}

export interface CapacityCommitment {
  commitmentId: string;
  communityId: string;
  quantity: number;
  reservedSoldQuantity: number;
  status: string;
  window: {
    startDate: string;
    endDate: string;
    dailyWindow: { startTime: string; endTime: string };
    daysOfWeek?: string[];
  };
  scope?: Record<string, unknown>;
  rate?: Record<string, unknown>;
}

/** Downstream commitment shape used by vendor-home mapping (BFF-owned projection input). */
export type CapacityCommitmentSource = CapacityCommitment;

export interface CapacityProposalSource {
  proposalId: string;
  communityId: string;
  quantity: number;
  status: string;
  responseDeadline: string;
  packageScope?: Record<string, unknown>;
  serviceWindow?: Record<string, unknown>;
  counter?: Record<string, unknown>;
}

export interface VendorContextSource {
  hasVendor: boolean;
  vendorId?: string;
  status?: string;
  onboarding?: { currentStep?: string; completed?: boolean };
  nextAction: string;
  membership?: {
    role: 'owner' | 'staff';
    permissions?: string[];
    staffId?: string;
  };
  detailsAcceptance?: {
    accepted: boolean;
    acceptedRevision?: number;
    acceptedAt?: string;
    profileRevision: number;
  };
}

export interface VendorHomeSummarySource {
  vendorId: string;
  timezone: string;
  date: string;
  today: {
    visits: {
      total: number;
      completed: number;
      inProgress: number;
      notStarted: number;
      blocked: number;
      missed: number;
      cancelled: number;
    };
    crew: { assigned: number; unassigned: number };
    completion: { completed: number; total: number; percentage: number };
    needsAttention: Array<{
      communityId: string;
      communityName?: string;
      visitWindowId: string;
      visitWindowName?: string;
      visitCount: number;
      blockedCount: number;
      unassignedCount: number;
    }>;
  };
  tomorrow: {
    date: string;
    totalVisits: number;
    assignedVisits: number;
    unassignedVisits: number;
  };
  upcoming: {
    fromDate: string;
    toDate: string;
    days: Array<{
      date: string;
      totalVisits: number;
      assignedVisits: number;
      unassignedVisits: number;
      communities: Array<{
        communityId: string;
        communityName?: string;
        visitCount: number;
        unassignedCount: number;
      }>;
    }>;
  };
}

export interface CommunityLabel {
  communityId: string;
  name: string;
}

export interface VendorManagerData {
  crews?: SchedulingCrew[];
  commitments?: CapacityCommitment[];
  proposals?: CapacityProposalSource[];
  communities?: CommunityLabel[];
  vendorContext?: VendorContextSource;
  /** Requested optional sections Vendor could not read; the others are still authoritative. */
  unavailableSections?: Array<'commitments' | 'proposals'>;
  sourceAsOf: string;
}

export interface BookingInternalClient {
  readVendorBookings(
    vendorId: string,
    accessToken?: string,
  ): Promise<VendorHomeSummarySource>;
}

/**
 * Worst case is membership, then the parallel reads, then the label read:
 * 4 + 6 + 6 seconds, which must stay below the managerWork Lambda timeout.
 */
const MEMBERSHIP_TIMEOUT_MS = 4_000;
const READ_TIMEOUT_MS = 6_000;

export interface HttpBookingInternalClientConfig {
    bookingBaseUrl: string; 
   internalServiceToken: string;
}

/**
 * Partner BFF → booking domain over HTTPS.
 * Default auth is the platform internal bearer from SSM.
 * `readVendorBookings` may forward the caller JWT when supplied by handleVendorHome.
 */
export class HttpBookingInternalClient implements BookingInternalClient {
  constructor(
    private readonly config: HttpBookingInternalClientConfig = {
      bookingBaseUrl: process.env.BOOKING_BASE_URL ?? '',
      internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN ?? '',
    },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
 
  async readVendorBookings(
    vendorId: string,
    accessToken?: string,
  ): Promise<VendorHomeSummarySource> {
    return this.get(
      this.config.bookingBaseUrl,
      `/vendors/${vendorId}/bookings`,
      accessToken,
    ) as Promise<VendorHomeSummarySource>;
  }

  private async post(
    baseUrl: string,
    path: string,
    body: unknown,
    dependency: string,
    timeoutMs: number,
  ): Promise<unknown> {
    const base = baseUrl.trim().replace(/\/$/, '');
    const token = this.config.internalServiceToken.trim();
    if (!base) {
      throw unavailable(`${dependency} base URL is not configured`);
    }
    if (!token) {
      throw unavailable('Internal service token is not configured');
    }

    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const cause =
        error instanceof Error && error.cause instanceof Error
          ? error.cause.message
          : undefined;
      logger.warn({
        event: 'partner_dependency_http_failed',
        dependency,
        path,
        url,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : undefined,
        ...(cause ? { errorCause: cause } : {}),
        timeoutMs,
      });
      throw unavailable(`${dependency} is unavailable`);
    }

    const raw = await response.text();
    let parsed: unknown = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw unavailable(`${dependency} returned an unreadable response`);
      }
    }

    if (!response.ok) {
      const envelope = record(parsed);
      const error = record(envelope.error);
      const message = record(envelope.message);
      const details = Array.isArray(error.details) ? error.details : [];
      const detailMessage = details
        .map((item) => text(record(item).message))
        .find((item): item is string => Boolean(item));
      const dependencyMessage =
        text(error.message) ??
        text(message.description) ??
        detailMessage ??
        `${dependency} failed`;
      const statusCode =
        typeof error.statusCode === 'number'
          ? error.statusCode
          : response.status;
      logger.warn({
        event: 'partner_dependency_http_rejected',
        dependency,
        path,
        statusCode,
        errorCode: text(error.code),
        dependencyMessage,
      });
      throw new BaseError(
        dependencyMessage,
        statusCode >= 500 ? 502 : statusCode,
        text(error.code) ?? 'DEPENDENCY_ERROR',
        undefined,
        { retryable: statusCode >= 500 },
      );
    }

    return unwrapData(parsed);
  }

  private async get(
    baseUrl: string,
    path: string,
    accessToken?: string,
  ): Promise<unknown> {
    const base = baseUrl.trim().replace(/\/$/, '');
    const callerToken = accessToken?.trim();
    const internalToken = this.config.internalServiceToken.trim();
    const authorization = callerToken
      ? callerToken.toLowerCase().startsWith('bearer ')
        ? callerToken
        : `Bearer ${callerToken}`
      : internalToken
        ? `Bearer ${internalToken}`
        : '';
    if (!base) {
      throw unavailable('Booking base URL is not configured');
    }
    if (!authorization) {
      throw unavailable('Access token is not configured');
    }
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authorization,
      },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new BaseError(
        'Failed to get data ' + response.statusText + ' at url ' + url,
        response.status,
        'GET_FAILED',
        undefined,
        { retryable: false },
      );
    }
    return response.json();
  }
}

/** @deprecated Use {@link HttpPartnerInternalClient}. Kept as a type alias for existing imports. */
export const LambdaBookingInternalClient = HttpBookingInternalClient;

function unwrapData(parsed: unknown): unknown {
  const envelope = record(parsed);
  if ('data' in envelope) {
    return envelope.data;
  }
  return parsed;
}

function unavailable(message: string): BaseError {
  return new BaseError(message, 502, 'DEPENDENCY_UNAVAILABLE', undefined, { retryable: true });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
