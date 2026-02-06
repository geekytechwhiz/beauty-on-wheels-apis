import axios, { type AxiosError } from 'axios';
import type { LabPartnerAdapter, LabPartnerConfig } from './labPartner.adapter';
import type { CreateLabOrderCommand } from '../models/labOrder.command';
import type { LabIntegrationResult } from '../models/labIntegration.result';
import { InvalidPartnerResponseError, PartnerUnavailableError } from '../utils/integrationErrors';
import { getAuthHeadersFromRegistry, getPartnerApiKey } from '../utils/partnerAuth';
import {
  toLabResult,
  toLabResultError,
  type PartnerOrderPayload,
} from '../utils/responseMapper';

const REQUEST_TIMEOUT_MS = 15_000;
const ORANGE_SECRET_ARN_KEY = 'ORANGE_API_KEY_SECRET_ARN';
const ORANGE_API_KEY_ENV = 'ORANGE_API_KEY';

function isAxiosError(err: unknown): err is AxiosError {
  return typeof err === 'object' && err !== null && 'isAxiosError' in err && (err as AxiosError).isAxiosError === true;
}

function translateError(partnerId: string, err: unknown): never {
  if (err instanceof InvalidPartnerResponseError || err instanceof PartnerUnavailableError) throw err;
  if (isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data;
    const message = typeof data === 'object' && data !== null && 'message' in data
      ? String((data as { message?: unknown }).message)
      : err.message;
    if (status === 404) {
      throw new InvalidPartnerResponseError(partnerId, 'Order not found');
    }
    if (status && status >= 500) {
      throw new PartnerUnavailableError(partnerId, message || `Partner returned ${status}`);
    }
    if (status && status >= 400) {
      throw new InvalidPartnerResponseError(partnerId, message || `Partner returned ${status}`);
    }
    if (err.code === 'ECONNABORTED' || err.message?.toLowerCase().includes('timeout')) {
      throw new PartnerUnavailableError(partnerId, 'Partner request timeout');
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ENETUNREACH') {
      throw new PartnerUnavailableError(partnerId, 'Partner unreachable');
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  throw new PartnerUnavailableError(partnerId, msg);
}

export class OrangeAdapter implements LabPartnerAdapter {
  constructor(private readonly config: LabPartnerConfig) {}

  private async getAuthHeaders(): Promise<Record<string, string>> {
    if (this.config.authConfig) {
      return getAuthHeadersFromRegistry(this.config.authConfig);
    }
    const apiKey = await getPartnerApiKey(ORANGE_SECRET_ARN_KEY, ORANGE_API_KEY_ENV);
    return {
      'Content-Type': 'application/json',
      ...(apiKey && { 'X-API-Key': apiKey }),
    };
  }

  private baseUrl(): string {
    return this.config.apiBaseUrl.replace(/\/$/, '');
  }

  private mapCreateOrderBody(command: CreateLabOrderCommand): Record<string, unknown> {
    return {
      patientId: command.patientId,
      ...(command.patientName && { patientName: command.patientName }),
      testCodes: command.testCodes,
      ...(command.specimenType && { specimenType: command.specimenType }),
      ...(command.priority && { priority: command.priority }),
      ...(command.notes && { notes: command.notes }),
      ...(command.externalReferenceId && { externalReferenceId: command.externalReferenceId }),
    };
  }

  async createOrder(command: CreateLabOrderCommand): Promise<LabIntegrationResult> {
    const { partnerId } = this.config;
    const url = `${this.baseUrl()}/lab/orders`;
    const headers = await this.getAuthHeaders();

    try {
      const { data } = await axios.post<PartnerOrderPayload>(url, this.mapCreateOrderBody(command), {
        timeout: REQUEST_TIMEOUT_MS,
        headers,
      });
      return toLabResult(data ?? null, { success: true });
    } catch (err) {
      translateError(partnerId, err);
    }
  }

  async cancelOrder(orderId: string): Promise<LabIntegrationResult> {
    const { partnerId } = this.config;
    const url = `${this.baseUrl()}/lab/orders/${encodeURIComponent(orderId)}/cancel`;
    const headers = await this.getAuthHeaders();

    try {
      const { data } = await axios.post<PartnerOrderPayload>(url, {}, {
        timeout: REQUEST_TIMEOUT_MS,
        headers,
      });
      return toLabResult(data ?? null, { orderId, success: true });
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 404) {
        return toLabResultError(orderId, 'Order not found');
      }
      translateError(partnerId, err);
    }
  }

  async fetchStatus(orderId: string): Promise<LabIntegrationResult> {
    const { partnerId } = this.config;
    const url = `${this.baseUrl()}/lab/orders/${encodeURIComponent(orderId)}/status`;
    const headers = await this.getAuthHeaders();

    try {
      const { data } = await axios.get<PartnerOrderPayload>(url, {
        timeout: REQUEST_TIMEOUT_MS,
        headers,
      });
      return toLabResult(data ?? null, { orderId, success: true });
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 404) {
        return toLabResultError(orderId, 'Order not found');
      }
      translateError(partnerId, err);
    }
  }
}
