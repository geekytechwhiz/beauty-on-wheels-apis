import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
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
}

/**
 * Worst case is membership, then the parallel reads, then the label read:
 * 4 + 6 + 6 seconds, which must stay below the managerWork Lambda timeout.
 */
const MEMBERSHIP_TIMEOUT_MS = 4_000;
const READ_TIMEOUT_MS = 6_000;

export class LambdaPartnerInternalClient implements PartnerInternalClient {
  constructor(
    private readonly lambda: LambdaClient = new LambdaClient({}),
    private readonly config = {
      operationalAccessFunction: process.env.VENDOR_OPERATIONAL_ACCESS_FUNCTION ?? '',
      vendorManagerReadFunction: process.env.VENDOR_PARTNER_MANAGER_READ_FUNCTION ?? '',
      bookingManagerReadFunction: process.env.BOOKING_PARTNER_MANAGER_READ_FUNCTION ?? '',
    },
  ) {}

  async resolveOperationalAccess(userId: string): Promise<OperationalAccess> {
    const result = await this.invoke(this.config.operationalAccessFunction, { userId }, 'vendor membership', MEMBERSHIP_TIMEOUT_MS);
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
    return this.invoke(this.config.bookingManagerReadFunction, { actor, action, query }, `Booking ${action}`, READ_TIMEOUT_MS) as Promise<ManagerOverview | ManagerWorkPage | ManagerPlanningPage>;
  }

  async readVendor(
    actor: PartnerActor,
    query: { includeCrews?: boolean; includeCommitments?: boolean; communityIds?: string[] },
  ): Promise<VendorManagerData> {
    return this.invoke(this.config.vendorManagerReadFunction, { actor, ...query }, 'Vendor manager data', READ_TIMEOUT_MS) as Promise<VendorManagerData>;
  }

  private async invoke(functionName: string, payload: unknown, dependency: string, timeoutMs: number): Promise<unknown> {
    if (!functionName.trim()) {
      throw unavailable(`${dependency} internal function is not configured`);
    }
    let response;
    try {
      response = await this.lambda.send(new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify(payload)),
      }), { abortSignal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      logger.warn({
        event: 'partner_dependency_invoke_failed',
        dependency,
        functionName,
        errorName: error instanceof Error ? error.name : typeof error,
        timeoutMs,
      });
      throw unavailable(`${dependency} is unavailable`);
    }
    if (response.FunctionError) {
      logger.warn({ event: 'partner_dependency_function_error', dependency, functionName, functionError: response.FunctionError });
      throw unavailable(`${dependency} failed`);
    }
    const raw = response.Payload ? Buffer.from(response.Payload).toString('utf8') : '';
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      throw unavailable(`${dependency} returned an unreadable response`);
    }
    const envelope = record(parsed);
    if (envelope.error) {
      const error = record(envelope.error);
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 502;
      logger.warn({ event: 'partner_dependency_rejected', dependency, functionName, statusCode, errorCode: text(error.code) });
      throw new BaseError(text(error.message) ?? `${dependency} failed`, statusCode, text(error.code) ?? 'DEPENDENCY_ERROR');
    }
    return envelope.data ?? parsed;
  }
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
