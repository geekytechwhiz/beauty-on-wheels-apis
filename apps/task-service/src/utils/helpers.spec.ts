import type { APIGatewayProxyEvent } from 'aws-lambda';

import { bearerToken } from '../__tests__/handler-test-utils';
import { getActorUserIdForRequest, getOrganizationIdForRequest } from './helpers';

function eventWithAuthorizer(claims: Record<string, string>): APIGatewayProxyEvent {
  return {
    requestContext: { authorizer: claims },
  } as unknown as APIGatewayProxyEvent;
}

describe('helpers', () => {
  describe('getActorUserIdForRequest', () => {
    it('reads userID from API Gateway authorizer', () => {
      const event = eventWithAuthorizer({ userID: 'auth-user-1' });
      expect(getActorUserIdForRequest(event, undefined)).toBe('auth-user-1');
    });

    it('reads custom:userID from authorizer', () => {
      const event = eventWithAuthorizer({ 'custom:userID': 'custom-user-1' });
      expect(getActorUserIdForRequest(event, undefined)).toBe('custom-user-1');
    });

    it('reads userId from authorizer', () => {
      const event = eventWithAuthorizer({ userId: 'user-id-1' });
      expect(getActorUserIdForRequest(event, undefined)).toBe('user-id-1');
    });

    it('reads organizationId from authorizer organizationId field', () => {
      const event = eventWithAuthorizer({ organizationId: 'org-from-auth' });
      expect(getOrganizationIdForRequest(event, undefined)).toBe('org-from-auth');
    });

    it('falls back to JWT payload when authorizer absent', () => {
      const event = {} as APIGatewayProxyEvent;
      const authHeader = bearerToken({ 'custom:userID': 'jwt-user-1' });
      expect(getActorUserIdForRequest(event, authHeader)).toBe('jwt-user-1');
    });

    it('returns undefined when no user id available', () => {
      expect(getActorUserIdForRequest({} as APIGatewayProxyEvent, undefined)).toBeUndefined();
    });
  });

  describe('getOrganizationIdForRequest', () => {
    it('reads organizationID from API Gateway authorizer', () => {
      const event = eventWithAuthorizer({ organizationID: 'org-auth' });
      expect(getOrganizationIdForRequest(event, undefined)).toBe('org-auth');
    });

    it('reads custom:organizationID from JWT', () => {
      const event = {} as APIGatewayProxyEvent;
      const authHeader = bearerToken({ 'custom:organizationID': 'org-jwt' });
      expect(getOrganizationIdForRequest(event, authHeader)).toBe('org-jwt');
    });

    it('reads custom:organizationID from authorizer', () => {
      const event = eventWithAuthorizer({ 'custom:organizationID': 'org-custom-auth' });
      expect(getOrganizationIdForRequest(event, undefined)).toBe('org-custom-auth');
    });

    it('reads custom:organizationId from JWT payload', () => {
      const event = {} as APIGatewayProxyEvent;
      const authHeader = bearerToken({ 'custom:organizationId': 'org-jwt-camel' });
      expect(getOrganizationIdForRequest(event, authHeader)).toBe('org-jwt-camel');
    });

    it('returns undefined when org cannot be resolved', () => {
      expect(getOrganizationIdForRequest({} as APIGatewayProxyEvent, bearerToken({ sub: 'u1' }))).toBeUndefined();
    });
  });
});
