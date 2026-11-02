/**
 * First-admin bootstrap saga types.
 *
 * Application ADMIN is a USER#/ROLE# mapping only. Public OTP userType stays
 * CUSTOMER|VENDOR; userType is never treated as authorization.
 */

export const BOOTSTRAP_CONFIRM_PHRASE = 'BOOTSTRAP FIRST ADMIN';

export const BOOTSTRAP_KEYS = {
  marker: { PK: 'SYSTEM#FIRST_ADMIN_BOOTSTRAP', SK: 'META' },
  lock: { PK: 'SYSTEM#FIRST_ADMIN_BOOTSTRAP_LOCK', SK: 'META' },
  journalPk: 'SYSTEM#FIRST_ADMIN_BOOTSTRAP_JOURNAL',
} as const;

export const SAGA_STATE = {
  PREFLIGHT: 'preflight',
  LOCKED: 'locked',
  SNAPSHOTTED: 'snapshotted',
  OTP_SENT: 'otpSent',
  OTP_VERIFIED: 'otpVerified',
  IDENTITY_RESOLVED: 'identityResolved',
  VALIDATED: 'validated',
  COMMITTING: 'committing',
  COMMITTED: 'committed',
  VERIFIED: 'verified',
  COMPLETED: 'completed',
  FAILED: 'failed',
  COMPENSATING: 'compensating',
  COMPENSATED: 'compensated',
  NEEDS_MANUAL_RECOVERY: 'needsManualRecovery',
} as const;

export type SagaState = (typeof SAGA_STATE)[keyof typeof SAGA_STATE];

export type DestinationKind = 'email' | 'phone';

export type BootstrapMode = 'dry-run' | 'apply';

export interface BootstrapCliArgs {
  stage: string;
  table: string;
  apiBaseUrl: string;
  destination: string;
  approvedBy: string;
  executedBy: string;
  changeTicket: string;
  expectedAccountId: string;
  expectedRegion?: string;
  userType: 'CUSTOMER' | 'VENDOR';
  apply: boolean;
  confirm?: string;
  confirmProduction: boolean;
  allowUnverified: boolean;
  resumeRunId?: string;
  otp?: string;
}

export interface PreflightResult {
  stage: string;
  tableName: string;
  region: string;
  accountId: string;
  apiBaseUrl: string;
  tableStatus: string;
  identityApiReachable: boolean;
}

export interface IdentitySnapshot {
  userId: string;
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  identityId?: string;
  cognitoUsername?: string;
  roleId?: string;
  existingRoles: string[];
  existedBeforeRun: boolean;
}

export interface OwnershipFlags {
  /** True only when META did not exist before OTP verify in this run. */
  createdIdentityAccount: boolean;
  /**
   * True only when Cognito probe proved the user did not exist before OTP.
   * Unknown stays false and never authorizes Cognito deletion.
   */
  createdCognitoUser: boolean;
  cognitoExistedBeforeRun: boolean | 'unknown';
  identityExistedBeforeRun: boolean;
}

export interface BootstrapJournal {
  runId: string;
  entityType: 'AdminBootstrapJournal';
  PK: string;
  SK: string;
  state: SagaState;
  stage: string;
  tableName: string;
  region: string;
  accountId: string;
  apiBaseUrl: string;
  destinationKind: DestinationKind;
  /** Hash only — never the raw destination secret material beyond what Dynamo already stores. */
  destinationFingerprint: string;
  approvedBy: string;
  executedBy: string;
  changeTicket: string;
  mode: BootstrapMode;
  referenceId?: string;
  userId?: string;
  ownership: OwnershipFlags;
  adminMappingWritten: boolean;
  bootstrapMarkerWritten: boolean;
  auditId?: string;
  lastError?: string;
  recoveryHint?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CommitPlan {
  userId: string;
  stage: string;
  tableName: string;
  approvedBy: string;
  executedBy: string;
  changeTicket: string;
  now: string;
  auditId: string;
  runId: string;
}

export interface BootstrapResult {
  mode: BootstrapMode;
  runId: string;
  state: SagaState;
  userId?: string;
  message: string;
  recoveryHint?: string;
}

export class BootstrapError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly recoveryHint?: string;

  constructor(
    message: string,
    code: string,
    options?: { recoverable?: boolean; recoveryHint?: string; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'BootstrapError';
    this.code = code;
    this.recoverable = options?.recoverable ?? false;
    this.recoveryHint = options?.recoveryHint;
  }
}
