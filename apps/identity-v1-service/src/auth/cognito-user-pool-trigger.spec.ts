import type { UserPoolType } from '@aws-sdk/client-cognito-identity-provider';

import {
  buildUpdateUserPoolInput,
  PRE_TOKEN_GENERATION_LAMBDA_VERSION,
} from './cognito-user-pool-trigger';

const functionArn =
  'arn:aws:lambda:us-east-1:123456789012:function:identity-pre-token';

const pool = {
  Id: 'us-east-1_pool',
  PoolName: 'bw-user-pool',
  MfaConfiguration: 'OFF',
  EmailConfiguration: { EmailSendingAccount: 'COGNITO_DEFAULT' },
  SmsConfiguration: { SnsCallerArn: 'arn:aws:iam::123456789012:role/sns' },
  LambdaConfig: {
    CustomMessage: 'arn:aws:lambda:us-east-1:123456789012:function:messages',
    PreTokenGeneration: 'arn:aws:lambda:us-east-1:123456789012:function:old',
  },
} as UserPoolType;

describe('buildUpdateUserPoolInput', () => {
  it('attaches pre-token generation V2_0 and keeps the rest of the pool', () => {
    const input = buildUpdateUserPoolInput(pool, functionArn, 'attach');
    expect(input.UserPoolId).toBe('us-east-1_pool');
    expect(input.PoolName).toBe('bw-user-pool');
    expect(input.EmailConfiguration).toEqual(pool.EmailConfiguration);
    expect(input.SmsConfiguration).toEqual(pool.SmsConfiguration);
    expect(input.LambdaConfig?.CustomMessage).toBe(pool.LambdaConfig?.CustomMessage);
    expect(input.LambdaConfig?.PreTokenGeneration).toBe(functionArn);
    expect(input.LambdaConfig?.PreTokenGenerationConfig).toEqual({
      LambdaArn: functionArn,
      LambdaVersion: PRE_TOKEN_GENERATION_LAMBDA_VERSION,
    });
  });

  it('detaches only this function', () => {
    const attached = buildUpdateUserPoolInput(pool, functionArn, 'attach');
    const input = buildUpdateUserPoolInput(
      { ...pool, LambdaConfig: attached.LambdaConfig },
      functionArn,
      'detach',
    );
    expect(input.LambdaConfig?.PreTokenGeneration).toBeUndefined();
    expect(input.LambdaConfig?.PreTokenGenerationConfig).toBeUndefined();
    expect(input.LambdaConfig?.CustomMessage).toBe(pool.LambdaConfig?.CustomMessage);
    expect(input.PoolName).toBe('bw-user-pool');
  });
});
