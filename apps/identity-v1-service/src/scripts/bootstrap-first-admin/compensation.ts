import {
  DeleteCommand,
  GetCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import type { BootstrapJournal } from './types';
import { BootstrapError, SAGA_STATE } from './types';

export type CognitoAdmin = {
  userExists: (usernameOrDestination: string) => Promise<boolean>;
  deleteUser: (username: string) => Promise<void>;
};

/**
 * Compensates only resources this run can prove it created.
 * Never deletes reused Cognito/Identity accounts. Downstream User Service
 * provisioning is not reversed here — escalate to manual recovery.
 */
export async function compensateBootstrapRun(input: {
  db: DynamoDBDocumentClient;
  tableName: string;
  journal: BootstrapJournal;
  cognito?: CognitoAdmin;
  nowIso: string;
}): Promise<{
  state: typeof SAGA_STATE.COMPENSATED | typeof SAGA_STATE.NEEDS_MANUAL_RECOVERY;
  recoveryHint?: string;
}> {
  const { journal } = input;

  if (journal.adminMappingWritten || journal.bootstrapMarkerWritten) {
    return {
      state: SAGA_STATE.NEEDS_MANUAL_RECOVERY,
      recoveryHint:
        'ADMIN mapping or bootstrap marker may exist. Inspect USER#/ROLE#ADMIN and SYSTEM#FIRST_ADMIN_BOOTSTRAP. Do not delete Cognito or Identity accounts. Resume is not safe; follow manual recovery.',
    };
  }

  const profile = journal.userId
    ? await input.db.send(
        new GetCommand({
          TableName: input.tableName,
          Key: { PK: `USER#${journal.userId}`, SK: 'PROFILE' },
          ConsistentRead: true,
        }),
      )
    : { Item: undefined };

  const provisioning = profile.Item?.userProvisioning as
    | { status?: string; userId?: string }
    | undefined;
  if (
    provisioning?.status === 'LINKED' ||
    provisioning?.status === 'PENDING'
  ) {
    // Stream/User Service side effects cannot be safely reversed from Identity.
    return {
      state: SAGA_STATE.NEEDS_MANUAL_RECOVERY,
      recoveryHint:
        'Downstream user provisioning was observed (PENDING/LINKED). Do not delete the Identity or Cognito principal. Coordinate User Service cleanup manually if required, then close the journal.',
    };
  }

  if (journal.ownership.createdIdentityAccount && journal.userId) {
    // Only remove ROLE mappings and META/PROFILE/lookups when ownership is proven.
    // Prefer repository-equivalent deletes via conditional deletes of known keys.
    await safeDelete(
      input.db,
      input.tableName,
      { PK: `USER#${journal.userId}`, SK: 'META' },
    );
    await safeDelete(
      input.db,
      input.tableName,
      { PK: `USER#${journal.userId}`, SK: 'PROFILE' },
    );
  } else if (journal.ownership.identityExistedBeforeRun) {
    // Reused identity — leave untouched.
  }

  if (
    journal.ownership.createdCognitoUser &&
    journal.ownership.cognitoExistedBeforeRun === false &&
    input.cognito
  ) {
    // Username is not stored in the journal for safety; operators must supply
    // Cognito deletion out-of-band when a username was recorded in secure ops notes.
    return {
      state: SAGA_STATE.NEEDS_MANUAL_RECOVERY,
      recoveryHint:
        'Journal proves Cognito was created by this run, but the CLI will not speculative-delete Cognito users without an explicit operator Cognito username confirmation. Delete only the Cognito user created for this destination after verifying AdminGetUser, then mark the journal compensated.',
    };
  }

  if (
    journal.ownership.cognitoExistedBeforeRun === 'unknown' &&
    journal.ownership.createdIdentityAccount
  ) {
    return {
      state: SAGA_STATE.NEEDS_MANUAL_RECOVERY,
      recoveryHint:
        'Identity account ownership is proven but Cognito ownership is unknown. Do not delete Cognito. Inspect the pool for the destination and recover manually.',
    };
  }

  return { state: SAGA_STATE.COMPENSATED };
}

async function safeDelete(
  db: DynamoDBDocumentClient,
  tableName: string,
  key: { PK: string; SK: string },
): Promise<void> {
  try {
    await db.send(
      new DeleteCommand({
        TableName: tableName,
        Key: key,
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  } catch {
    // Missing item is fine during compensation.
  }
}

export function compensationNotAllowed(journal: BootstrapJournal): BootstrapError {
  return new BootstrapError(
    'Compensation refused: ownership of resources cannot be proven',
    'COMPENSATION_UNSAFE',
    {
      recoverable: true,
      recoveryHint:
        journal.recoveryHint ??
        'Stop. Inspect the journal item SYSTEM#FIRST_ADMIN_BOOTSTRAP_JOURNAL / RUN#<runId> and recover manually.',
    },
  );
}
