import { BaseError } from '@api-hub/utils';

import type { CognitoAttributeDefaults } from '../config/cognito.config';
import {
  interpolateCognitoDefault,
  resolveCognitoCreateUserAttributes,
} from './cognito-user-attributes';

const defaults: CognitoAttributeDefaults = {
  email: 'dev+{username}@beautyonwheels.test',
  phone_number: '+1{digits}',
  name: 'Beauty On Wheels User',
};

const username = 'bow_abc123def4567890';

function attrMap(attrs: { Name: string; Value: string }[]) {
  return Object.fromEntries(attrs.map((attr) => [attr.Name, attr.Value]));
}

describe('resolveCognitoCreateUserAttributes', () => {
  it('fills missing required schema attributes from COGNITO_DEFAULT_* values', () => {
    const attributes = resolveCognitoCreateUserAttributes(
      { phoneNumber: '+15551234567' },
      defaults,
      username,
    );
    const values = attrMap(attributes);

    expect(values.phone_number).toBe('+15551234567');
    expect(values.phone_number_verified).toBe('true');
    expect(values.email).toBe(`dev+${username}@beautyonwheels.test`);
    expect(values.email_verified).toBeUndefined();
    expect(values.name).toBe('Beauty On Wheels User');
    expect(values.sub).toBeUndefined();
  });

  it('preserves provided email, phone_number, and name instead of defaults', () => {
    const attributes = resolveCognitoCreateUserAttributes(
      {
        email: 'ada@example.com',
        phoneNumber: '+15559876543',
        name: 'Ada Lovelace',
      },
      defaults,
      username,
    );
    const values = attrMap(attributes);

    expect(values.email).toBe('ada@example.com');
    expect(values.email_verified).toBe('true');
    expect(values.phone_number).toBe('+15559876543');
    expect(values.phone_number_verified).toBe('true');
    expect(values.name).toBe('Ada Lovelace');
  });

  it('treats blank input as missing and applies defaults', () => {
    const attributes = resolveCognitoCreateUserAttributes(
      { email: '  ', phoneNumber: '', name: '\t' },
      defaults,
      username,
    );
    const values = attrMap(attributes);

    expect(values.email).toBe(`dev+${username}@beautyonwheels.test`);
    expect(values.phone_number).toMatch(/^\+1\d{10}$/);
    expect(values.name).toBe('Beauty On Wheels User');
    expect(values.email_verified).toBeUndefined();
    expect(values.phone_number_verified).toBeUndefined();
  });

  it('throws when a required attribute is missing and no default is configured', () => {
    expect(() =>
      resolveCognitoCreateUserAttributes(
        { email: 'ada@example.com' },
        { email: 'unused@example.com' },
        username,
      ),
    ).toThrow(BaseError);

    try {
      resolveCognitoCreateUserAttributes(
        { email: 'ada@example.com' },
        { email: 'unused@example.com' },
        username,
      );
      fail('expected missing Cognito default to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      expect((err as BaseError).code).toBe('COGNITO_ATTRIBUTE_MISSING');
    }
  });
});

describe('interpolateCognitoDefault', () => {
  it('substitutes {username} and {digits} from the generated Cognito username', () => {
    expect(
      interpolateCognitoDefault('dev+{username}@beautyonwheels.test', username),
    ).toBe(`dev+${username}@beautyonwheels.test`);
    expect(interpolateCognitoDefault('+1{digits}', username)).toMatch(
      /^\+1\d{10}$/,
    );
  });
});
