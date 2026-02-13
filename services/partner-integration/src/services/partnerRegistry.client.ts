/**
 * Read-only client for Partner Registry.
 * Fetches partner config via HTTP GET. No persistence, no write operations.
 */

import axios, { type AxiosError } from 'axios';
import type { Partner } from '@api-hub/partners';
import type { PartnerConfig } from '../adapters/partner.adapter';

/** Partner with optional authConfig and adapterKey (registry fields). */
interface PartnerWithAuth extends Partner {
  authConfig?: PartnerConfig['authConfig'];
  adapterKey?: string;
}
import { PartnerUnavailableError } from '../utils/integrationErrors';

const ENDPOINT_TYPE_API = 'API';
const REQUEST_TIMEOUT_MS = 10_000;

function getBaseUrl(): string {
  const endpoint = process.env.PARTNER_REGISTRY_ENDPOINT;
  if (!endpoint) {
    throw new Error('PARTNER_REGISTRY_ENDPOINT is not set');
  }
  return endpoint.replace(/\/$/, '');
}

function isAxiosError(err: unknown): err is AxiosError {
  return typeof err === 'object' && err !== null && 'isAxiosError' in err && (err as AxiosError).isAxiosError === true;
}

/**
 * Fetches partner by id from Partner Registry (READ-ONLY).
 * Returns PartnerConfig with apiBaseUrl from partner's API endpoint.
 */
export async function getPartnerConfig(partnerId: string): Promise<PartnerConfig> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/partner/${encodeURIComponent(partnerId)}`;

  try {
    const response = await axios.get<PartnerWithAuth>(url, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    });

    const partner = response.data as PartnerWithAuth | null;
    if (!partner || typeof partner !== 'object') {
      throw new PartnerUnavailableError(partnerId, 'Invalid partner response body');
    }

    if (partner.status !== 'ACTIVE') {
      throw new PartnerUnavailableError(
        partnerId,
        `Partner is not active (status: ${partner.status}). Only ACTIVE partners can be used for outbound calls.`
      );
    }

    const apiEndpoint = partner.endpoints?.find((e) => e.type === ENDPOINT_TYPE_API);
    if (!apiEndpoint?.url) {
      throw new PartnerUnavailableError(partnerId, 'Partner has no API endpoint configured');
    }

    return {
      partnerId: partner.partnerId,
      apiBaseUrl: apiEndpoint.url,
      authConfig: partner.authConfig,
      adapterKey: partner.adapterKey,
    };
  } catch (err) {
    if (err instanceof PartnerUnavailableError) throw err;

    if (isAxiosError(err)) {
      const status = err.response?.status;
      const message = err.response?.data && typeof err.response.data === 'object' && 'message' in err.response.data
        ? String((err.response.data as { message?: unknown }).message)
        : err.message;

      if (status === 404) {
        throw new PartnerUnavailableError(partnerId, 'Partner not found');
      }
      if (status && status >= 500) {
        throw new PartnerUnavailableError(partnerId, `Partner registry error: ${status}`);
      }
      if (status && status >= 400) {
        throw new PartnerUnavailableError(partnerId, message || `Partner registry returned ${status}`);
      }
      if (err.code === 'ECONNABORTED' || err.message?.toLowerCase().includes('timeout')) {
        throw new PartnerUnavailableError(partnerId, 'Partner registry request timeout');
      }
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ENETUNREACH') {
        throw new PartnerUnavailableError(partnerId, 'Partner registry unreachable');
      }
    }

    const message = err instanceof Error ? err.message : String(err);
    throw new PartnerUnavailableError(partnerId, message);
  }
}
