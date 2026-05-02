import {   withApiHandler, successResponse } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { CognitoService } from '../../services/cognito.service';
import { validateContacts } from '../../validation/request.validators';

function normalizePhone(phone: string): string {
  if (!phone) return '';
  return phone.replace(/\s|-|\(|\)/g, '');
}

interface Body {
  emailAddress?: string;
  phoneNumber?: string;
}

const handler = async (req: LambdaRequest<Record<string, unknown>, Body>) => {
  const body = req.body ?? {};
  const region = process.env.DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1';
  const userPoolId = process.env.COGNITO_USER_POOL_ID || '';
  const cognitoService = new CognitoService(region, userPoolId);

  let emailAddressExists = false;
  let phoneNumberExists = false;

  if (body.emailAddress && body.emailAddress.trim() !== '') {
    emailAddressExists = await cognitoService.userExistsIdentifier(body.emailAddress.trim().toLowerCase());
  }
  if (body.phoneNumber && body.phoneNumber.trim() !== '') {
    const normalized = normalizePhone(body.phoneNumber.trim());
    if (normalized) {
      phoneNumberExists = await cognitoService.userExistsIdentifier(normalized);
    }
  }

  return { emailAddressExists, phoneNumberExists };
};

export const main =   withApiHandler(
          {
            operation: 'validateContacts',
            validator: (req) => validateContacts(req as any),
          },
          async (req) => {
            const correlationId =
              (req.context as { correlationId?: string }).correlationId ?? 'unknown';

            const result = await (handler as any)(req);

            return successResponse(result, undefined, { correlationId });
          }
        );
