import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { createLogger, serializeError, createChildLogger } from '@api-hub/observability';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const lambdaClient = new LambdaClient({});

const parseLambdaPayload = (payload?: Uint8Array): any => {
  if (!payload || payload.length === 0) return null;
  const text = new TextDecoder().decode(payload);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed?.body && typeof parsed.body === 'string') {
      try {
        return JSON.parse(parsed.body);
      } catch {
        return parsed.body;
      }
    }
    return parsed;
  } catch {
    return text;
  }
};

export class UserLinkRepository {
  async linkUser(payload: Record<string, unknown>): Promise<any | null> {
    const functionName = process.env.USER_LINK_LAMBDA;
    const logger = createChildLogger(baseLogger, { functionName });
    if (!functionName) {
      logger.warn({ event: 'user_link_lambda_missing' });
      return null;
    }
    try {
      const response = await lambdaClient.send(
        new InvokeCommand({
          FunctionName: functionName,
          Payload: Buffer.from(JSON.stringify(payload)),
        }),
      );
      return parseLambdaPayload(response.Payload as Uint8Array | undefined);
    } catch (err) {
      logger.error({ event: 'user_link_lambda_failed', err: serializeError(err) });
      return null;
    }
  }
}
