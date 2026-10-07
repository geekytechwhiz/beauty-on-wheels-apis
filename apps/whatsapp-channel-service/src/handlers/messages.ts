import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getWhatsAppMessageService } from '../composition';
import { handleSendMessageRequest } from '../services/message-http';
import { fromApiGatewayEvent } from '../services/webhook-http';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const request = fromApiGatewayEvent(event);
  const response = await handleSendMessageRequest(request, () => getWhatsAppMessageService());
  return { statusCode: response.statusCode, body: response.body, headers: response.headers };
}
