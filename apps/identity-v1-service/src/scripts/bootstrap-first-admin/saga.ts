import { randomUUID } from 'node:crypto';

import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { STSClient } from '@aws-sdk/client-sts';

import {
  advanceJournal,
  acquireBootstrapLock,
  createInitialJournal,
  getJournal,
  putJournal,
  releaseBootstrapLock,
} from './journal';
import { sendOtpChallenge, verifyOtpChallenge } from './otp-client';
import { runPreflight } from './preflight';
import { fingerprintDestination, sanitizeForLog } from './sanitize';
import { destinationKindOf, meetsDestinationVerificationPolicy } from './verification-policy';
import {
  assertReadyForAdminCommit,
  commitFirstAdminMapping,
  countAdminRoleMappings,
  findUserIdByDestination,
  listUserRoleIds,
  loadBootstrapMarker,
  loadRoleMetadata,
  loadUserMeta,
  verifyAdminMapping,
} from './commit';
import { compensateBootstrapRun, type CognitoAdmin } from './compensation';
import {
  type BootstrapCliArgs,
  type BootstrapJournal,
  type BootstrapResult,
  BootstrapError,
  SAGA_STATE,
} from './types';

export type BootstrapDeps = {
  args: BootstrapCliArgs;
  region: string;
  sts: STSClient;
  dynamo: DynamoDBClient;
  db: DynamoDBDocumentClient;
  fetchImpl: typeof fetch;
  promptOtp: () => Promise<string>;
  cognito?: CognitoAdmin & {
    probeExists?: (destination: string) => Promise<boolean | 'unknown'>;
  };
  now?: () => Date;
  createRunId?: () => string;
  log?: (payload: Record<string, unknown>) => void;
};

export async function runFirstAdminBootstrap(
  deps: BootstrapDeps,
): Promise<BootstrapResult> {
  const now = () => (deps.now ? deps.now() : new Date()).toISOString();
  const log =
    deps.log ??
    ((payload) => {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(sanitizeForLog(payload), null, 2));
    });

  const mode = deps.args.apply ? 'apply' : 'dry-run';
  const destinationKind = destinationKindOf(deps.args.destination);

  const preflight = await runPreflight({
    args: deps.args,
    sts: deps.sts,
    dynamo: deps.dynamo,
    fetchImpl: deps.fetchImpl,
    region: deps.region,
  });

  let journal: BootstrapJournal | undefined;
  try {
    if (deps.args.resumeRunId) {
      const existing = await getJournal(
        deps.db,
        deps.args.table,
        deps.args.resumeRunId,
      );
      if (!existing) {
        throw new BootstrapError(
          `No journal found for run ${deps.args.resumeRunId}`,
          'JOURNAL_NOT_FOUND',
          { recoverable: false },
        );
      }
      journal = existing;
      log({
        event: 'bootstrap_resume',
        runId: journal.runId,
        state: journal.state,
        mode,
      });
    } else {
      const runId = deps.createRunId ? deps.createRunId() : randomUUID();
      journal = createInitialJournal({
        runId,
        stage: deps.args.stage,
        tableName: deps.args.table,
        region: preflight.region,
        accountId: preflight.accountId,
        apiBaseUrl: deps.args.apiBaseUrl,
        destinationKind,
        destinationFingerprint: fingerprintDestination(deps.args.destination),
        approvedBy: deps.args.approvedBy,
        executedBy: deps.args.executedBy,
        changeTicket: deps.args.changeTicket,
        mode,
        nowIso: now(),
      });
      journal = await persist(deps, journal, mode);
    }

    if (
      journal.state === SAGA_STATE.COMPLETED ||
      journal.state === SAGA_STATE.VERIFIED
    ) {
      return {
        mode,
        runId: journal.runId,
        state: journal.state,
        userId: journal.userId,
        message:
          'Bootstrap already completed. Sign in again so Cognito pre-token issues a fresh token with ADMIN.',
      };
    }

    const needsSnapshot =
      journal.state === SAGA_STATE.PREFLIGHT ||
      journal.state === SAGA_STATE.LOCKED ||
      journal.state === SAGA_STATE.FAILED ||
      journal.state === SAGA_STATE.COMPENSATED ||
      journal.state === SAGA_STATE.NEEDS_MANUAL_RECOVERY;

    if (mode === 'apply') {
      await acquireBootstrapLock(deps.db, deps.args.table, {
        runId: journal.runId,
        executedBy: deps.args.executedBy,
        nowIso: now(),
      });
      if (needsSnapshot || journal.state === SAGA_STATE.PREFLIGHT) {
        journal = await persist(
          deps,
          advanceJournal(journal, SAGA_STATE.LOCKED, {}, now()),
          mode,
        );
      }
    }

    let preexistingUserId: string | null = null;
    if (needsSnapshot || journal.state === SAGA_STATE.SNAPSHOTTED) {
      preexistingUserId = await findUserIdByDestination(
        deps.db,
        deps.args.table,
        deps.args.destination,
        destinationKind,
      );
      const cognitoExisted =
        (await deps.cognito?.probeExists?.(deps.args.destination)) ?? 'unknown';

      journal = await persist(
        deps,
        advanceJournal(
          journal,
          SAGA_STATE.SNAPSHOTTED,
          {
            ownership: {
              ...journal.ownership,
              identityExistedBeforeRun: Boolean(preexistingUserId),
              cognitoExistedBeforeRun: cognitoExisted,
              createdIdentityAccount: false,
              createdCognitoUser: false,
            },
          },
          now(),
        ),
        mode,
      );
    } else {
      preexistingUserId = journal.ownership.identityExistedBeforeRun
        ? journal.userId ?? null
        : null;
    }

    const role = await loadRoleMetadata(deps.db, deps.args.table);
    const bootstrapMarker = await loadBootstrapMarker(deps.db, deps.args.table);
    const adminMappingCount = await countAdminRoleMappings(
      deps.db,
      deps.args.table,
    );

    if (!role || role.roleId !== 'ADMIN') {
      throw new BootstrapError(
        'ADMIN role metadata is missing; stop and repair role setup first',
        'ADMIN_ROLE_METADATA_MISSING',
      );
    }
    if (bootstrapMarker && journal.state !== SAGA_STATE.COMMITTING) {
      throw new BootstrapError(
        'The first-admin bootstrap marker already exists',
        'BOOTSTRAP_ALREADY_COMPLETED',
      );
    }
    if (adminMappingCount > 0 && !journal.adminMappingWritten) {
      throw new BootstrapError(
        'An ADMIN role mapping already exists; use the normal admin role API',
        'ADMIN_ALREADY_EXISTS',
      );
    }

    const needsOtp =
      journal.state === SAGA_STATE.SNAPSHOTTED ||
      journal.state === SAGA_STATE.OTP_SENT;

    if (needsOtp) {
      if (!journal.referenceId) {
        const sent = await sendOtpChallenge({
          apiBaseUrl: deps.args.apiBaseUrl,
          destination: deps.args.destination,
          userType: deps.args.userType,
          fetchImpl: deps.fetchImpl,
        });
        journal = await persist(
          deps,
          advanceJournal(
            journal,
            SAGA_STATE.OTP_SENT,
            { referenceId: sent.referenceId },
            now(),
          ),
          mode,
        );
        log({
          event: 'otp_sent',
          runId: journal.runId,
          referenceId: sent.referenceId,
        });
      }

      let otpValue = deps.args.otp;
      if (!otpValue) {
        otpValue = await deps.promptOtp();
      }
      if (!otpValue) {
        throw new BootstrapError('OTP is required', 'OTP_REQUIRED', {
          recoverable: true,
        });
      }

      try {
        await verifyOtpChallenge({
          apiBaseUrl: deps.args.apiBaseUrl,
          destination: deps.args.destination,
          otp: otpValue,
          fetchImpl: deps.fetchImpl,
        });
      } finally {
        otpValue = undefined;
        deps.args.otp = undefined;
      }

      journal = await persist(
        deps,
        advanceJournal(journal, SAGA_STATE.OTP_VERIFIED, {}, now()),
        mode,
      );
    }

    // Resolve application userId from Identity destination lookup — never Cognito sub.
    const userId =
      journal.userId ??
      (await findUserIdByDestination(
        deps.db,
        deps.args.table,
        deps.args.destination,
        destinationKind,
      ));
    if (!userId) {
      throw new BootstrapError(
        'Identity userId was not found after OTP verify',
        'IDENTITY_NOT_FOUND',
        {
          recoverable: true,
          recoveryHint:
            'OTP verify may have failed persistence. Resume with --resume-run-id after inspecting IDENTITY/EMAIL/PHONE lookups.',
        },
      );
    }

    if (
      journal.state === SAGA_STATE.OTP_VERIFIED ||
      journal.state === SAGA_STATE.IDENTITY_RESOLVED
    ) {
      const createdIdentityAccount =
        !journal.ownership.identityExistedBeforeRun &&
        (!preexistingUserId || preexistingUserId !== userId);

      journal = await persist(
        deps,
        advanceJournal(
          journal,
          SAGA_STATE.IDENTITY_RESOLVED,
          {
            userId,
            ownership: {
              ...journal.ownership,
              createdIdentityAccount,
              createdCognitoUser:
                journal.ownership.cognitoExistedBeforeRun === false,
            },
          },
          now(),
        ),
        mode,
      );
    }

    const user = await loadUserMeta(deps.db, deps.args.table, userId);
    const existingRoles = await listUserRoleIds(
      deps.db,
      deps.args.table,
      userId,
    );

    if (!journal.adminMappingWritten) {
      assertReadyForAdminCommit({
        user,
        role,
        bootstrapMarker: await loadBootstrapMarker(deps.db, deps.args.table),
        adminMappingCount: await countAdminRoleMappings(
          deps.db,
          deps.args.table,
        ),
        existingRoles,
      });
    }

    if (
      !meetsDestinationVerificationPolicy({
        stage: deps.args.stage,
        destinationKind,
        emailVerified: user?.emailVerified === true,
        phoneVerified: user?.phoneVerified === true,
        allowUnverified: deps.args.allowUnverified,
      })
    ) {
      throw new BootstrapError(
        'Target identity verification state does not meet the stage policy',
        'VERIFICATION_POLICY_FAILED',
      );
    }

    if (
      journal.state === SAGA_STATE.IDENTITY_RESOLVED ||
      journal.state === SAGA_STATE.VALIDATED
    ) {
      journal = await persist(
        deps,
        advanceJournal(journal, SAGA_STATE.VALIDATED, {}, now()),
        mode,
      );
    }

    const planSummary = {
      mode,
      runId: journal.runId,
      stage: deps.args.stage,
      tableName: deps.args.table,
      region: preflight.region,
      accountId: preflight.accountId,
      apiBaseUrl: deps.args.apiBaseUrl,
      userId,
      active: true,
      verified: true,
      existingAdminMappings: adminMappingCount,
      existingRoles,
      identityExistedBeforeRun: journal.ownership.identityExistedBeforeRun,
      createdIdentityAccount: journal.ownership.createdIdentityAccount,
      approvedBy: deps.args.approvedBy,
      executedBy: deps.args.executedBy,
      changeTicket: deps.args.changeTicket,
      note: 'userType is classification only; ADMIN is assigned as an application role mapping',
    };
    log(planSummary);

    if (mode !== 'apply') {
      return {
        mode,
        runId: journal.runId,
        state: journal.state,
        userId,
        message:
          'Dry run only. Re-run with --apply --confirm "BOOTSTRAP FIRST ADMIN" to write. Note: OTP verify may have created or reused an Identity/Cognito principal; dry-run only skips the ADMIN mapping transaction.',
      };
    }

    if (
      journal.state === SAGA_STATE.VALIDATED ||
      journal.state === SAGA_STATE.COMMITTING
    ) {
      const auditId = journal.auditId ?? randomUUID();
      journal = await persist(
        deps,
        advanceJournal(
          journal,
          SAGA_STATE.COMMITTING,
          { auditId },
          now(),
        ),
        mode,
      );

      if (!journal.adminMappingWritten) {
        await commitFirstAdminMapping(deps.db, {
          userId,
          stage: deps.args.stage,
          tableName: deps.args.table,
          approvedBy: deps.args.approvedBy,
          executedBy: deps.args.executedBy,
          changeTicket: deps.args.changeTicket,
          now: now(),
          auditId,
          runId: journal.runId,
        });

        journal = await persist(
          deps,
          advanceJournal(
            journal,
            SAGA_STATE.COMMITTED,
            {
              adminMappingWritten: true,
              bootstrapMarkerWritten: true,
            },
            now(),
          ),
          mode,
        );
      }
    }

    await verifyAdminMapping(deps.db, deps.args.table, userId);

    journal = await persist(
      deps,
      advanceJournal(journal, SAGA_STATE.VERIFIED, {}, now()),
      mode,
    );
    journal = await persist(
      deps,
      advanceJournal(journal, SAGA_STATE.COMPLETED, {}, now()),
      mode,
    );

    await releaseBootstrapLock(deps.db, deps.args.table, journal.runId);

    return {
      mode,
      runId: journal.runId,
      state: SAGA_STATE.COMPLETED,
      userId,
      message:
        'First admin mapping created and verified. The user must sign in again so Cognito pre-token generation issues a fresh access token with ADMIN.',
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'unknown bootstrap failure';
    const code =
      error instanceof BootstrapError ? error.code : 'BOOTSTRAP_FAILED';
    const recoveryHint =
      error instanceof BootstrapError ? error.recoveryHint : undefined;

    if (!journal) {
      throw new BootstrapError(message, code, {
        recoverable: error instanceof BootstrapError ? error.recoverable : false,
        recoveryHint,
        cause: error,
      });
    }

    log({
      event: 'bootstrap_failed',
      runId: journal.runId,
      code,
      message,
      recoveryHint,
    });

    journal = await persist(
      deps,
      advanceJournal(
        journal,
        SAGA_STATE.FAILED,
        {
          lastError: `${code}: ${message}`,
          recoveryHint,
        },
        now(),
      ),
      mode,
    );

    if (mode === 'apply' && !journal.adminMappingWritten) {
      journal = await persist(
        deps,
        advanceJournal(journal, SAGA_STATE.COMPENSATING, {}, now()),
        mode,
      );
      const compensation = await compensateBootstrapRun({
        db: deps.db,
        tableName: deps.args.table,
        journal,
        cognito: deps.cognito,
        nowIso: now(),
      });
      journal = await persist(
        deps,
        advanceJournal(
          journal,
          compensation.state,
          { recoveryHint: compensation.recoveryHint ?? recoveryHint },
          now(),
        ),
        mode,
      );
    }

    await releaseBootstrapLock(deps.db, deps.args.table, journal.runId);

    throw new BootstrapError(message, code, {
      recoverable: error instanceof BootstrapError ? error.recoverable : false,
      recoveryHint:
        journal.recoveryHint ??
        recoveryHint ??
        `Resume with --resume-run-id ${journal.runId} after fixing the cause. Never speculative-delete Cognito or Identity accounts.`,
      cause: error,
    });
  }
}

async function persist(
  deps: BootstrapDeps,
  journal: BootstrapJournal,
  mode: 'dry-run' | 'apply',
): Promise<BootstrapJournal> {
  if (mode !== 'apply') {
    return journal;
  }
  await putJournal(deps.db, deps.args.table, journal);
  return journal;
}
