import type {
  LambdaConfigType,
  UpdateUserPoolCommandInput,
  UserPoolType,
} from '@aws-sdk/client-cognito-identity-provider';

/** Cognito event version that can add claims to the access token. */
export const PRE_TOKEN_GENERATION_LAMBDA_VERSION = 'V2_0' as const;

const USER_POOL_FIELDS = [
  'PoolName',
  'Policies',
  'DeletionProtection',
  'AutoVerifiedAttributes',
  'SmsVerificationMessage',
  'EmailVerificationMessage',
  'EmailVerificationSubject',
  'VerificationMessageTemplate',
  'SmsAuthenticationMessage',
  'UserAttributeUpdateSettings',
  'MfaConfiguration',
  'DeviceConfiguration',
  'EmailConfiguration',
  'SmsConfiguration',
  'UserPoolTags',
  'AdminCreateUserConfig',
  'UserPoolAddOns',
  'AccountRecoverySetting',
  'UserPoolTier',
  'KeyConfiguration',
  'IssuerConfiguration',
] as const;

/**
 * Keeps every existing trigger and points pre-token generation at this function
 * with V2_0. The legacy ARN and PreTokenGenerationConfig must be the same function.
 */
export function lambdaConfigWithAccessTokenRoles(
  existing: LambdaConfigType | undefined,
  functionArn: string,
): LambdaConfigType {
  return {
    ...(existing ?? {}),
    PreTokenGeneration: functionArn,
    PreTokenGenerationConfig: {
      LambdaArn: functionArn,
      LambdaVersion: PRE_TOKEN_GENERATION_LAMBDA_VERSION,
    },
  };
}

export function lambdaConfigWithoutAccessTokenRoles(
  existing: LambdaConfigType | undefined,
  functionArn: string,
): LambdaConfigType | undefined {
  if (!existing) {
    return undefined;
  }
  const configuredArn =
    existing.PreTokenGenerationConfig?.LambdaArn ?? existing.PreTokenGeneration;
  if (configuredArn !== functionArn) {
    return existing;
  }
  const next: LambdaConfigType = { ...existing };
  delete next.PreTokenGeneration;
  delete next.PreTokenGenerationConfig;
  return next;
}

/**
 * Builds an UpdateUserPool request that copies the live pool settings and only
 * changes the pre-token generation trigger. Omitted fields reset to Cognito defaults.
 * SmsConfiguration must be copied so phone verification stays intact. Cognito then
 * requires iam:PassRole on SmsConfiguration.SnsCallerArn.
 */
export function buildUpdateUserPoolInput(
  pool: UserPoolType,
  functionArn: string,
  action: 'attach' | 'detach',
): UpdateUserPoolCommandInput {
  const userPoolId = pool.Id?.trim();
  if (!userPoolId) {
    throw new Error('Cognito user pool id is missing');
  }

  const input: UpdateUserPoolCommandInput = { UserPoolId: userPoolId };
  for (const field of USER_POOL_FIELDS) {
    const value = pool[field];
    if (value !== undefined) {
      input[field] = value as never;
    }
  }

  input.LambdaConfig =
    action === 'attach'
      ? lambdaConfigWithAccessTokenRoles(pool.LambdaConfig, functionArn)
      : lambdaConfigWithoutAccessTokenRoles(pool.LambdaConfig, functionArn);

  return input;
}
