/* eslint-disable mvrx/no-direct-dynamodb */
/* eslint-disable mvrx/no-controller-business-logic */
import { ApiResponse } from '@api-hub/utils';
import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const ssm = new SSMClient({});

type ParametersMap = Record<string, string>;

async function getAllParameters(path: string): Promise<ParametersMap> {
  let nextToken: string | undefined;
  const parameters: ParametersMap = {};

  do {
    const response = await ssm.send(
      new GetParametersByPathCommand({
        Path: path,
        Recursive: true,
        WithDecryption: true,
        NextToken: nextToken,
      }),
    );

    for (const param of response.Parameters ?? []) {
      if (param.Name && param.Value) {
        parameters[param.Name] = param.Value;
      }
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return parameters;
}

export const main = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const path = event.queryStringParameters?.path ?? '/mvx/dev';

    const parameters = await getAllParameters(path);

    return {
      statusCode: 200,
      body: JSON.stringify(parameters),
    };
    return ApiResponse.ok(
      parameters,
      {
        title: 'OK',
        description: 'Alert service is healthy',
        severity: 'INFO',
      },
      {
        correlationId: event.requestContext.requestId,
      },
    );
  } catch (error) {
    return ApiResponse.error(
      500,
      {
        title: 'INTERNAL_ERROR',
        description: 'Failed to load SSM parameters ' + error,
        severity: 'ERROR',
      },
      { correlationId: event.requestContext.requestId },
      { code: 'INTERNAL_ERROR' },
    );
  }
};
