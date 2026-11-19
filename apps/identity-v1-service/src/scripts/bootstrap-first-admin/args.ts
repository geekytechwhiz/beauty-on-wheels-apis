import {
  BOOTSTRAP_CONFIRM_PHRASE,
  type BootstrapCliArgs,
  BootstrapError,
} from './types';

function value(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function required(args: string[], name: string): string {
  const result = value(args, name)?.trim();
  if (!result) {
    throw new BootstrapError(
      `Missing required argument: --${name}`,
      'MISSING_ARGUMENT',
    );
  }
  return result;
}

function assertSafeText(label: string, text: string, maxLength = 200): void {
  if (text.length > maxLength || /[\r\n]/.test(text)) {
    throw new BootstrapError(`${label} is invalid`, 'INVALID_ARGUMENT');
  }
}

export function isProductionStage(stage: string): boolean {
  const normalized = stage.trim().toLowerCase();
  return (
    normalized === 'prd' ||
    normalized === 'prod' ||
    normalized === 'production'
  );
}

export function parseBootstrapArgs(argv: string[]): BootstrapCliArgs {
  const args = argv.slice();
  const stage = required(args, 'stage');
  const table = required(args, 'table');
  const apiBaseUrl = required(args, 'api-base-url');
  const destination = required(args, 'destination');
  const approvedBy = required(args, 'approved-by');
  const executedBy = required(args, 'executed-by');
  const changeTicket = required(args, 'change-ticket');
  const expectedAccountId = required(args, 'expected-account-id');
  const expectedRegion = value(args, 'expected-region')?.trim();
  const cognitoUserPoolId = value(args, 'cognito-user-pool-id')?.trim();
  const userTable = value(args, 'user-table')?.trim();
  const userTypeRaw = (value(args, 'user-type') ?? 'CUSTOMER').trim().toUpperCase();
  const apply = hasFlag(args, 'apply');
  const confirm = value(args, 'confirm');
  const confirmProduction = hasFlag(args, 'confirm-production');
  const allowUnverified = hasFlag(args, 'allow-unverified');
  const repairApplicationLink = hasFlag(args, 'repair-application-link');
  const resumeRunId = value(args, 'resume-run-id')?.trim();
  // --otp is accepted only for automated tests; operators should use the hidden prompt.
  const otp = value(args, 'otp');

  assertSafeText('stage', stage, 64);
  assertSafeText('table', table, 128);
  assertSafeText('api-base-url', apiBaseUrl, 512);
  assertSafeText('destination', destination, 320);
  assertSafeText('approved-by', approvedBy);
  assertSafeText('executed-by', executedBy);
  assertSafeText('change-ticket', changeTicket);
  assertSafeText('expected-account-id', expectedAccountId, 32);
  if (expectedRegion) {
    assertSafeText('expected-region', expectedRegion, 32);
  }
  if (cognitoUserPoolId) {
    assertSafeText('cognito-user-pool-id', cognitoUserPoolId, 128);
  }
  if (userTable) {
    assertSafeText('user-table', userTable, 128);
  }
  if (resumeRunId) {
    assertSafeText('resume-run-id', resumeRunId, 80);
  }
  if (repairApplicationLink && resumeRunId) {
    throw new BootstrapError(
      'Use either --repair-application-link or --resume-run-id, not both',
      'INVALID_ARGUMENT',
    );
  }

  if (!/^[a-z0-9-]+$/.test(stage)) {
    throw new BootstrapError(
      'Stage must contain lowercase letters, digits, and hyphens only',
      'INVALID_STAGE',
    );
  }

  if (table !== `identity-table-${stage}`) {
    throw new BootstrapError(
      `Table must be identity-table-${stage}; received ${table}`,
      'TABLE_STAGE_MISMATCH',
    );
  }

  if (userTypeRaw !== 'CUSTOMER' && userTypeRaw !== 'VENDOR') {
    throw new BootstrapError(
      'Public OTP userType must be CUSTOMER or VENDOR; ADMIN is assigned separately',
      'INVALID_USER_TYPE',
    );
  }

  if (approvedBy === executedBy) {
    throw new BootstrapError(
      'Use two different people for approval and execution',
      'SAME_APPROVER_EXECUTOR',
    );
  }

  if (isProductionStage(stage)) {
    if (!confirmProduction) {
      throw new BootstrapError(
        'Production requires --confirm-production and an approved change ticket',
        'PRODUCTION_REFUSED',
      );
    }
    if (!changeTicket.trim()) {
      throw new BootstrapError(
        'Production requires an explicit change ticket',
        'CHANGE_TICKET_REQUIRED',
      );
    }
  }

  if (apply && confirm !== BOOTSTRAP_CONFIRM_PHRASE) {
    throw new BootstrapError(
      `Applying changes requires --confirm "${BOOTSTRAP_CONFIRM_PHRASE}"`,
      'CONFIRM_REQUIRED',
    );
  }

  if (repairApplicationLink && !apply) {
    throw new BootstrapError(
      '--repair-application-link requires --apply (it writes LINKED / User Service rows)',
      'REPAIR_REQUIRES_APPLY',
    );
  }

  if (allowUnverified && isProductionStage(stage)) {
    throw new BootstrapError(
      'Production cannot allow unverified destinations',
      'UNVERIFIED_FORBIDDEN_IN_PRODUCTION',
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(apiBaseUrl);
  } catch {
    throw new BootstrapError('api-base-url is not a valid URL', 'INVALID_API_URL');
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new BootstrapError('api-base-url must be http(s)', 'INVALID_API_URL');
  }
  if (isProductionStage(stage) && parsedUrl.protocol !== 'https:') {
    throw new BootstrapError(
      'Production Identity API base URL must use https',
      'INSECURE_API_URL',
    );
  }

  return {
    stage,
    table,
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ''),
    destination,
    approvedBy,
    executedBy,
    changeTicket,
    expectedAccountId,
    expectedRegion,
    cognitoUserPoolId,
    userTable,
    userType: userTypeRaw,
    apply,
    confirm,
    confirmProduction,
    allowUnverified,
    repairApplicationLink,
    resumeRunId,
    otp,
  };
}
