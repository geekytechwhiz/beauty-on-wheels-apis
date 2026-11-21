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

export interface ManagerOverview {
  timezone: string;
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
}

export interface CommunityLabel {
  communityId: string;
  name: string;
}

export interface VendorManagerData {
  crews?: SchedulingCrew[];
  commitments?: CapacityCommitment[];
  communities?: CommunityLabel[];
  /** Requested optional sections Vendor could not read; the others are still authoritative. */
  unavailableSections?: Array<'commitments'>;
  sourceAsOf: string;
}

export interface PartnerInternalClient {
  resolveOperationalAccess(userId: string): Promise<OperationalAccess>;
  readBooking(actor: PartnerActor, action: 'overview' | 'work' | 'planning', query: object): Promise<ManagerOverview | ManagerWorkPage | ManagerPlanningPage>;
  readVendor(actor: PartnerActor, query: { includeCrews?: boolean; includeCommitments?: boolean; communityIds?: string[] }): Promise<VendorManagerData>;
  readCapacityCommitments(actor: PartnerActor): Promise<CapacityCommitment[]>;
}

/**
 * Worst case is membership, then the parallel reads, then the label read:
 * 4 + 6 + 6 seconds, which must stay below the managerWork Lambda timeout.
 */
const MEMBERSHIP_TIMEOUT_MS = 4_000;
const READ_TIMEOUT_MS = 6_000;

export interface HttpPartnerInternalClientConfig {
  bookingBaseUrl: string;
  vendorBaseUrl: string;
  internalServiceToken: string;
}

/**
 * Partner BFF → domain services over HTTPS.
 * Authentication is the platform internal bearer from SSM; the user JWT is never forwarded.
 */
export class HttpPartnerInternalClient implements PartnerInternalClient {
  constructor(
    private readonly config: HttpPartnerInternalClientConfig = {
      bookingBaseUrl: process.env.BOOKING_BASE_URL ?? '',
      vendorBaseUrl: process.env.VENDOR_BASE_URL ?? '',
      internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN ?? '',
    },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async resolveOperationalAccess(userId: string): Promise<OperationalAccess> {
    const result = await this.post(
      this.config.vendorBaseUrl,
      '/internal/operational-access',
      { userId },
      'vendor membership',
      MEMBERSHIP_TIMEOUT_MS,
    );
    const body = record(result);
    if (body.role !== 'owner' && body.role !== 'staff' && body.role !== 'none') {
      throw unavailable('Vendor Service returned an invalid membership response');
    }
    if (typeof body.active !== 'boolean') throw unavailable('Vendor Service omitted membership state');
    return {
      role: body.role,
      active: body.active,
      ...(text(body.vendorId) ? { vendorId: text(body.vendorId)! } : {}),
      ...(text(body.staffId) ? { staffId: text(body.staffId)! } : {}),
    };
  }

  async readBooking(
    actor: PartnerActor,
    action: 'overview' | 'work' | 'planning',
    query: object,
  ): Promise<ManagerOverview | ManagerWorkPage | ManagerPlanningPage> {
    return this.post(
      this.config.bookingBaseUrl,
      '/internal/partner/manager/read',
      { actor, action, query },
      `Booking ${action}`,
      READ_TIMEOUT_MS,
    ) as Promise<ManagerOverview | ManagerWorkPage | ManagerPlanningPage>;
  }

  async readVendor(
    actor: PartnerActor,
    query: { includeCrews?: boolean; includeCommitments?: boolean; communityIds?: string[] },
  ): Promise<VendorManagerData> {
    return this.post(
      this.config.vendorBaseUrl,
      '/internal/partner/manager/read',
      { actor, ...query },
      'Vendor manager data',
      READ_TIMEOUT_MS,
    ) as Promise<VendorManagerData>;
  }

  async readCapacityCommitments(actor: PartnerActor): Promise<CapacityCommitment[]> {
    const data = await this.readVendor(actor, { includeCommitments: true });
    return Array.isArray(data.commitments) ? data.commitments : [];
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
      const error = record(record(parsed).error);
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : response.status;
      logger.warn({
        event: 'partner_dependency_http_rejected',
        dependency,
        path,
        statusCode,
        errorCode: text(error.code),
      });
      throw new BaseError(
        text(error.message) ?? `${dependency} failed`,
        statusCode >= 500 ? 502 : statusCode,
        text(error.code) ?? 'DEPENDENCY_ERROR',
        undefined,
        { retryable: statusCode >= 500 },
      );
    }

    return unwrapData(parsed);
  }
}

/** @deprecated Use {@link HttpPartnerInternalClient}. Kept as a type alias for existing imports. */
export const LambdaPartnerInternalClient = HttpPartnerInternalClient;

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
