import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { fromApiGatewayEvent, handleHttpRequest } from '../services/webhook-http';
import { getWebhookRuntime } from '../composition';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const runtime = await getWebhookRuntime();
  const response = await handleHttpRequest(fromApiGatewayEvent(event), runtime);
  return { statusCode: response.statusCode, body: response.body, headers: response.headers };
}
