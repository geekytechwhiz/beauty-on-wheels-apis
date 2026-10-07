import https from 'https';
import { URL } from 'url';

import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
  UpdateUserPoolCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { createLogger } from '@api-hub/observability';

import { buildUpdateUserPoolInput } from '../auth/cognito-user-pool-trigger';

const logger = createLogger({
  service: 'identity-attach-pre-token-generation',
  redactPII: true,
});

const cognito = new CognitoIdentityProviderClient({});

interface CustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  PhysicalResourceId?: string;
  ResourceProperties: {
    UserPoolId?: string;
    FunctionArn?: string;
  };
}

async function syncTrigger(event: CustomResourceEvent): Promise<void> {
  const userPoolId = event.ResourceProperties.UserPoolId?.trim();
  const functionArn = event.ResourceProperties.FunctionArn?.trim();
  if (!userPoolId || !functionArn) {
    throw new Error('UserPoolId and FunctionArn are required');
  }

  const described = await cognito.send(
    new DescribeUserPoolCommand({ UserPoolId: userPoolId }),
  );
  if (!described.UserPool) {
    throw new Error(`Cognito user pool ${userPoolId} was not found`);
  }

  const action = event.RequestType === 'Delete' ? 'detach' : 'attach';
  const input = buildUpdateUserPoolInput(
    described.UserPool,
    functionArn,
    action,
  );
  await cognito.send(new UpdateUserPoolCommand(input));
  logger.info({
    event: 'pre_token_generation_trigger_synced',
    action,
    lambdaVersion: 'V2_0',
    userPoolId,
  });
}

function sendResponse(
  event: CustomResourceEvent,
  status: 'SUCCESS' | 'FAILED',
  physicalResourceId: string,
  reason?: string,
): Promise<void> {
  const body = JSON.stringify({
    Status: status,
    Reason: reason ?? status,
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: {
      LambdaVersion: 'V2_0',
    },
  });
  const url = new URL(event.ResponseURL);

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'PUT',
        headers: {
          'content-type': '',
          'content-length': Buffer.byteLength(body),
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve());
      },
    );
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

export async function handler(event: CustomResourceEvent): Promise<void> {
  const userPoolId = event.ResourceProperties.UserPoolId?.trim() || 'unknown';
  const physicalResourceId =
    event.PhysicalResourceId || `pre-token-generation-${userPoolId}`;

  try {
    await syncTrigger(event);
    await sendResponse(event, 'SUCCESS', physicalResourceId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'trigger sync failed';
    logger.warn({
      event: 'pre_token_generation_trigger_sync_failed',
      error: reason,
    });
    await sendResponse(event, 'FAILED', physicalResourceId, reason);
  }
}
