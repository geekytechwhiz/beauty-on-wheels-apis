import { BaseError } from '@api-hub/utils';

import type { CognitoAttributeDefaults } from '../config/cognito.config';
import {
  cognitoDefaultEnvName,
  REQUIRED_WRITABLE_COGNITO_ATTRIBUTES,
} from '../config/cognito.config';

export interface CognitoUserAttribute {
  Name: string;
  Value: string;
}

export interface CognitoCreateUserAttributeInput {
  email?: string;
  phoneNumber?: string;
  name?: string;
  markDestinationVerified?: boolean;
}

/**
 * Required writable attributes on bw-user-pool (`us-east-1_LeQxyLZ3x`):
 * `email`, `phone_number`, `name`. `sub` is required but assigned by Cognito.
 */
const INPUT_TO_SCHEMA: Record<
  keyof CognitoCreateUserAttributeInput,
  (typeof REQUIRED_WRITABLE_COGNITO_ATTRIBUTES)[number]
> = {
  email: 'email',
  phoneNumber: 'phone_number',
  name: 'name',
};

export function interpolateCognitoDefault(
  template: string,
  username: string,
): string {
  if (!template.includes('{')) {
    return template;
  }

  let value = template.replaceAll('{username}', username);
  if (value.includes('{digits}')) {
    const hex = username.replace(/[^0-9a-f]/gi, '') || '0';
    const digits = BigInt(`0x${hex.slice(0, 13)}`)
      .toString()
      .padStart(10, '0')
      .slice(-10);
    value = value.replaceAll('{digits}', digits);
  }
  return value;
}

function present(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/**
 * Builds AdminCreateUser attributes from caller input, filling only missing
 * required schema attributes from `COGNITO_DEFAULT_*` env-backed defaults.
 */
export function resolveCognitoCreateUserAttributes(
  input: CognitoCreateUserAttributeInput,
  defaults: CognitoAttributeDefaults,
  username: string,
): CognitoUserAttribute[] {
  const attributes: CognitoUserAttribute[] = [];
  const provided = new Set<string>();

  const email = present(input.email);
  const phoneNumber = present(input.phoneNumber);
  const name = present(input.name);

  if (email) {
    attributes.push({ Name: 'email', Value: email });
    if (input.markDestinationVerified !== false) {
      attributes.push({ Name: 'email_verified', Value: 'true' });
    }
    provided.add(INPUT_TO_SCHEMA.email);
  }
  if (phoneNumber) {
    attributes.push({ Name: 'phone_number', Value: phoneNumber });
    if (input.markDestinationVerified !== false) {
      attributes.push({ Name: 'phone_number_verified', Value: 'true' });
    }
    provided.add(INPUT_TO_SCHEMA.phoneNumber);
  }
  if (name) {
    attributes.push({ Name: 'name', Value: name });
    provided.add(INPUT_TO_SCHEMA.name);
  }

  for (const attributeName of REQUIRED_WRITABLE_COGNITO_ATTRIBUTES) {
    if (provided.has(attributeName)) {
      continue;
    }

    const rawDefault = present(defaults[attributeName]);
    if (!rawDefault) {
      throw new BaseError(
        `Cognito user is missing required attribute '${attributeName}' and ${cognitoDefaultEnvName(attributeName)} is not configured`,
        500,
        'COGNITO_ATTRIBUTE_MISSING',
      );
    }

    attributes.push({
      Name: attributeName,
      Value: interpolateCognitoDefault(rawDefault, username),
    });
  }

  return attributes;
}
