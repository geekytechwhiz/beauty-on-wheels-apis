import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  serializeError,
  logHttpRequest,
  createChildLogger,
} from '@api-hub/logger';
import { ApiResponse } from '@api-hub/utils';
import { validateContactsSchema } from '../validation/user.validation';
import { CognitoService } from '../services/cognito.service';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

const PATH = '/user/validate-contacts';

function normalizePhone(phone: string): string {
  if (!phone) return '';
  return phone.replace(/\s|-|\(|\)/g, '');
}

export async function main(event: APIGatewayProxyEvent, context?: Context): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();
  const correlationId = extractCorrelationId(event);
  const awsRequestId = context ? extractAwsRequestId(context) : undefined;

  const logger = createChildLogger(baseLogger, {
    correlationId,
    ...(awsRequestId && { awsRequestId }),
  });
  logger.info({ event: 'validateContacts_received' });

  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (err) {
    logger.error({ event: 'validateContacts_parse_error', err: serializeError(err) });
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'COMMON.INVALID_JSON',
      { requestId: correlationId, event },
      { code: 'BAD_REQUEST' },
    );
  }

  const validationResult = validateContactsSchema.safeParse(body);
  if (!validationResult.success) {
    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 400, duration, correlationId);
    return ApiResponse.badRequest(
      'VALIDATION.FIELD_REQUIRED',
      { requestId: correlationId, event },
      {
        code: 'VALIDATION_ERROR',
        details: validationResult.error.issues.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        })),
      },
    );
  }

  const { emailAddress, phoneNumber } = validationResult.data;
  const region = process.env.DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1';
  const userPoolId = process.env.COGNITO_USER_POOL_ID || '';

  const cognitoService = new CognitoService(region, userPoolId);

  let emailAddressExists = false;
  let phoneNumberExists = false;

  try {
    if (emailAddress && emailAddress.trim() !== '') {
      emailAddressExists = await cognitoService.userExistsIdentifier(emailAddress.trim().toLowerCase());
    }
    if (phoneNumber && phoneNumber.trim() !== '') {
      const normalized = normalizePhone(phoneNumber.trim());
      if (normalized) {
        phoneNumberExists = await cognitoService.userExistsIdentifier(normalized);
      }
    }

    const duration = Date.now() - startTime;
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 200, duration, correlationId);
    return ApiResponse.ok(
      { emailAddressExists, phoneNumberExists },
      'INVITE.VALIDATE_CONTACTS_SUCCESS',
      { requestId: correlationId, event },
    );
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({ event: 'validateContacts_error', err: serializeError(err) });
    logHttpRequest(logger, event.httpMethod || 'POST', PATH, 500, duration, correlationId);
    return ApiResponse.internalServerError(
      'COMMON.INTERNAL_SERVER_ERROR',
      { requestId: correlationId, event },
      { code: 'INTERNAL_SERVER_ERROR' },
    );
  }
}
