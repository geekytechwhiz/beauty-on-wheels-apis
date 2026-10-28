import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { runWithCorsContext } from '@api-hub/utils';
import { getWebhookRuntime } from '../composition';
import { fromApiGatewayEvent, handleHttpRequest, healthResponse, isHealthRequest } from '../services/webhook-http';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return runWithCorsContext(event, async () => {
    const request = fromApiGatewayEvent(event);
    if (isHealthRequest(request)) {
      const response = healthResponse(request.headers['x-correlation-id']);
      return { statusCode: response.statusCode, body: response.body, headers: response.headers };
    }
    const runtime = await getWebhookRuntime();
    const response = await handleHttpRequest(request, runtime);
    return { statusCode: response.statusCode, body: response.body, headers: response.headers };
  });
}
