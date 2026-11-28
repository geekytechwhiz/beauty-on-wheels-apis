/** BFF-owned vendor home contract. Downstream DTOs must not leak here. */

export const VENDOR_HOME_MEMBERSHIP_ROLE = {
  OWNER: 'owner',
  STAFF: 'staff',
} as const;

export type VendorHomeMembershipRole =
  (typeof VENDOR_HOME_MEMBERSHIP_ROLE)[keyof typeof VENDOR_HOME_MEMBERSHIP_ROLE];

export const VENDOR_HOME_PROPOSAL_STATUS = {
  SENT: 'SENT',
  COUNTERED: 'COUNTERED',
} as const;

export type VendorHomeProposalStatus =
  (typeof VENDOR_HOME_PROPOSAL_STATUS)[keyof typeof VENDOR_HOME_PROPOSAL_STATUS];

export const VENDOR_HOME_COMMITMENT_STATUS = {
  ACTIVE: 'ACTIVE',
  CHANGE_PENDING: 'CHANGE_PENDING',
} as const;

export type VendorHomeCommitmentStatus =
  (typeof VENDOR_HOME_COMMITMENT_STATUS)[keyof typeof VENDOR_HOME_COMMITMENT_STATUS];

/** Sections that may be omitted when an optional dependency fails. */
export const VENDOR_HOME_SECTION = {
  CAPACITY_PENDING_PROPOSALS: 'capacity.pendingProposals',
  CAPACITY_COMMITMENTS: 'capacity.commitments',
  HOME: 'home',
} as const;

export type VendorHomeUnavailableSection =
  (typeof VENDOR_HOME_SECTION)[keyof typeof VENDOR_HOME_SECTION];

export interface VendorHomeQuery {
  date?: string;
  upcomingDays: number;
}

export interface VendorHomeVendorSection {
  vendorId: string;
  membership: {
    role: VendorHomeMembershipRole;
    permissions: string[];
    staffId?: string;
  };
  status: string;
  onboarding?: {
    currentStep?: string;
    completed?: boolean;
  };
  nextAction: string;
  detailsAcceptance?: {
    accepted: boolean;
    acceptedRevision?: number;
    acceptedAt?: string;
    profileRevision: number;
  };
}

export interface VendorHomeAttentionItem {
  communityId: string;
  communityName?: string;
  visitWindowId: string;
  visitWindowName?: string;
  visitCount: number;
  blockedCount: number;
  unassignedCount: number;
}

export interface VendorHomeToday {
  visits: {
    total: number;
    scheduled: number;
    completed: number;
    inProgress: number;
    notStarted: number;
    blocked: number;
    missed: number;
    cancelled: number;
  };
  crew: {
    assigned: number;
    unassigned: number;
  };
  needsAttention: VendorHomeAttentionItem[];
  completion: {
    completed: number;
    total: number;
    percentage: number;
  };
}

export interface VendorHomeDaySummary {
  date: string;
  totalVisits: number;
  assignedVisits: number;
  unassignedVisits: number;
}

export interface VendorHomeUpcomingDay extends VendorHomeDaySummary {
  communities: Array<{
    communityId: string;
    communityName?: string;
    visitCount: number;
    unassignedCount: number;
  }>;
}

export interface VendorHomeSection {
  date: string;
  timezone: string;
  today: VendorHomeToday;
  tomorrow: VendorHomeDaySummary;
  upcoming: {
    fromDate: string;
    toDate: string;
    days: VendorHomeUpcomingDay[];
  };
}

export interface VendorHomePendingProposal {
  proposalId: string;
  communityId: string;
  quantity: number;
  status: VendorHomeProposalStatus;
  responseDeadline: string;
  actionable: boolean;
  isPastDeadline: boolean;
  packageScope: Record<string, unknown>;
  serviceWindow: Record<string, unknown>;
  counter?: Record<string, unknown>;
}

export interface VendorHomeCommitment {
  commitmentId: string;
  communityId: string;
  scope: Record<string, unknown>;
  window: Record<string, unknown>;
  quantity: number;
  rate: Record<string, unknown>;
  status: VendorHomeCommitmentStatus;
  reservedSoldQuantity: number;
}

export interface VendorHomeCapacitySection {
  pendingProposals: VendorHomePendingProposal[];
  commitments: VendorHomeCommitment[];
}

export interface VendorHomeMeta {
  generatedAt: string;
  partialData: boolean;
  unavailableSections: VendorHomeUnavailableSection[];
  /** Present when the vendor cannot open the operational dashboard yet. */
  dashboardEligible: boolean;
}

export interface VendorHomeResponse {
  vendor: VendorHomeVendorSection;
  home: VendorHomeSection | null;
  capacity: VendorHomeCapacitySection;
  meta: VendorHomeMeta;
}
