export const VENDOR_ISSUE_STATUS = {
  OPEN: 'OPEN',
  TRIAGED: 'TRIAGED',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  RESOLVED: 'RESOLVED',
} as const;

export type VendorIssueStatus = (typeof VENDOR_ISSUE_STATUS)[keyof typeof VENDOR_ISSUE_STATUS];

export const VENDOR_ISSUE_TYPES = [
  'ACCESS_PROBLEM',
  'CUSTOMER_UNAVAILABLE',
  'EQUIPMENT_PROBLEM',
  'SAFETY_CONCERN',
  'VEHICLE_DAMAGE',
  'CAPACITY_SHORTFALL',
  'PAYMENT_QUERY',
  'OTHER',
] as const;

export type VendorIssueType = (typeof VENDOR_ISSUE_TYPES)[number];

export type IssueActorRole = 'VENDOR_OWNER' | 'CREW' | 'ADMIN';

export interface IssueActor {
  userId: string;
  role: IssueActorRole;
}

export interface IssueAttachment {
  objectKey: string;
  contentType: string;
  uploadedAt: string;
}

export interface IssueInternalNote {
  at: string;
  by: string;
  note: string;
}

export type IssueHistoryAction =
  | 'CREATED'
  | 'ATTACHMENT_ADDED'
  | 'TRIAGED'
  | 'ASSIGNED'
  | 'ACTION_REQUESTED'
  | 'RESOLVED';

export interface IssueHistoryEntry {
  at: string;
  by: IssueActor;
  action: IssueHistoryAction;
  fromStatus?: VendorIssueStatus;
  toStatus: VendorIssueStatus;
  /** Vendor-visible text only. Internal admin notes live in `internalNotes`. */
  note?: string;
}

export interface VendorIssueRecord {
  issueId: string;
  vendorId: string;
  visitId?: string;
  communityId?: string;
  commitmentId?: string;
  type: VendorIssueType;
  description: string;
  requestedHelp?: string;
  status: VendorIssueStatus;
  /** Explicit operational block flag. Older issues omit it and are not blockers. */
  blocksVisit?: boolean;
  /**
   * Server-recorded instant at which this issue began blocking its visit.
   * Omitted on rows written before blocker timing was introduced.
   */
  blockingStartedAt?: string;
  attachments: IssueAttachment[];
  createdBy: IssueActor;
  /** Admin user id. Visible to ops only. */
  assignedTo?: string;
  /** Visible to ops only. */
  internalNotes: IssueInternalNote[];
  resolutionOutcome?: string;
  history: IssueHistoryEntry[];
  version: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

/** Vendor and crew callers never see `internalNotes` or `assignedTo`. */
export type VendorIssueResponse = Omit<VendorIssueRecord, 'internalNotes' | 'assignedTo' | 'version'>;

export type OpsIssueResponse = Omit<VendorIssueRecord, 'version'>;

export interface VendorIssueDdbItem extends VendorIssueRecord {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  GSI2PK: string;
  GSI2SK: string;
  entityType: 'VendorIssue';
}

/**
 * Strongly consistent pointer from a visit to a linked issue. Completion reads
 * these with ConsistentRead so a just-filed issue cannot be missed the way a
 * GSI read could miss it.
 */
export interface VisitIssueLinkItem {
  PK: string;
  SK: string;
  issueId: string;
  vendorId: string;
  visitId: string;
  status: VendorIssueStatus;
  /** Stored on the strongly-consistent visit pointer for completion checks. */
  blocksVisit?: boolean;
  updatedAt: string;
  entityType: 'VisitIssueLink';
}

export interface IssueIdempotencyItem {
  PK: string;
  SK: string;
  issueId: string;
  vendorId: string;
  requestHash: string;
  entityType: 'VendorIssueIdempotency';
}
