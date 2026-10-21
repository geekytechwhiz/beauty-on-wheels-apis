import { env } from '../configs/env.config';
import { CustomerProfile } from '../domain/create-booking';
import { BookingError } from '../errors';
import { authHeaders, requestJson, requireBaseUrl } from './http';

export interface UserGateway {
  getProfile(userId: string, authorizationHeader?: string): Promise<CustomerProfile>;
  assertAddress(userId: string, addressId: string, authorizationHeader?: string): Promise<Record<string, string> | undefined>;
}

export class HttpUserGateway implements UserGateway {
  async getProfile(userId: string, authorizationHeader?: string): Promise<CustomerProfile> {
    const base = requireBaseUrl(env.USER_BASE_URL, 'USER_BASE_URL');
    console.log('getProfile_base', base);
    const body = await requestJson(
      `${base}/customers/${encodeURIComponent(userId)}`,
      { method: 'GET', headers: authHeaders(authorizationHeader) },
    );
    const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const communityIds = Array.isArray(record.communityIds)
      ? record.communityIds.filter((value): value is string => typeof value === 'string')
      : [];
    return { communityIds };
  }

  async assertAddress(userId: string, addressId: string, authorizationHeader?: string): Promise<Record<string, string> | undefined> {
    const base = requireBaseUrl(env.USER_BASE_URL, 'USER_BASE_URL');
    try {
      const body = await requestJson(
        `${base}/users/${encodeURIComponent(userId)}/addresses/${encodeURIComponent(addressId)}`,
        { method: 'GET', headers: authHeaders(authorizationHeader) },
      );
      const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
      const details = Object.fromEntries(
        ['addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'communityName']
          .flatMap((key) => typeof record[key] === 'string' ? [[key, record[key] as string]] : []),
      );
      return Object.keys(details).length ? details : undefined;
    } catch (error) {
      if (error instanceof BookingError && error.statusCode === 404) {
        throw new BookingError('ADDRESS_NOT_FOUND', 'Address was not found for the customer', 404, 'location.addressId', false);
      }
      throw error;
    }
  }
}

let gateway: UserGateway | undefined;

export function getUserGateway(): UserGateway {
  if (!gateway) {
    gateway = new HttpUserGateway();
  }
  return gateway;
}
