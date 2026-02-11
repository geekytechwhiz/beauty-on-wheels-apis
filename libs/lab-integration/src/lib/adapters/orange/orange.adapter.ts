import { BasePartnerAdapter } from '../base/base.adapter';
import type { PartnerAdapter, PartnerConfig } from '../base/adapter.interface';
import type {
  CreateOrderCommand,
  RescheduleOrderCommand,
} from '../../commands/base/order-command.types';
import {
  toResult,
  toResultError,
} from '../../utils/types/integration-result';
import type {
  OrangeCreateOrderCommand,
  OrangeRescheduleOrderCommand,
} from '../../commands/orange/orange-order.extension';
import { InvalidPartnerResponseError } from '../../utils/error/custom-errors';

export class OrangeAdapter
  extends BasePartnerAdapter
  implements PartnerAdapter
{
  constructor(config: PartnerConfig) {
    super(config);
  }

  protected override async getAuthHeaders(): Promise<Record<string, string>> {
    const apiKey = await this.getApiKey();
    return {
      'Content-Type': 'application/json',
      ...(apiKey && { api_key: apiKey }),
    };
  }

  async createOrder(command: CreateOrderCommand): Promise<ReturnType<typeof toResult>> {
    const orangeCommand = command as OrangeCreateOrderCommand;
    const url = `${this.baseUrl()}/lab/orders`;
    const headers = await this.getAuthHeaders();

    const body = this.mapCreateOrderBody(orangeCommand);

    const { data } = await this.request<{
      orderId?: string;
      id?: string;
      status?: string;
    }>({
      method: 'POST',
      url,
      headers,
      data: body,
    });

    return toResult(data, {
      orderId: data?.orderId ?? data?.id,
    });
  }

  async rescheduleOrder(
    orderId: string,
    command: RescheduleOrderCommand
  ): Promise<ReturnType<typeof toResult>> {
    const orangeCommand = command as OrangeRescheduleOrderCommand;
    const url = `${this.baseUrl()}/lab/orders/${encodeURIComponent(orderId)}/reschedule`;
    const headers = await this.getAuthHeaders();

    const body: Record<string, unknown> = {};
    if (orangeCommand.newScheduledDate) {
      body.newScheduledDate = orangeCommand.newScheduledDate;
    }

    const { data } = await this.request({
      method: 'POST',
      url,
      headers,
      data: body,
    });

    return toResult(data, { orderId, success: true });
  }

  async cancelOrder(
    orderId: string,
    remark?: string
  ): Promise<ReturnType<typeof toResult>> {
    const url = `${this.baseUrl()}/lab/orders/${encodeURIComponent(orderId)}/cancel`;
    const headers = await this.getAuthHeaders();

    const body: Record<string, unknown> = {};
    if (remark) {
      body.remark = remark;
    }

    const { data } = await this.request({
      method: 'POST',
      url,
      headers,
      data: body,
    });

    return toResult(data, { orderId, success: true });
  }

  async fetchStatus(
    orderId: string
  ): Promise<ReturnType<typeof toResult> | ReturnType<typeof toResultError>> {
    const url = `${this.baseUrl()}/lab/orders/${encodeURIComponent(orderId)}/status`;
    const headers = await this.getAuthHeaders();

    const { data } = await this.request<{ errors?: string[] }>({
      method: 'GET',
      url,
      headers,
    });

    if (data?.errors?.includes('Order not found')) {
      return toResultError(orderId, 'Order ID does not exist or is not accessible');
    }

    return toResult(data, { orderId, success: true });
  }

  private mapCreateOrderBody(
    command: OrangeCreateOrderCommand
  ): Record<string, unknown> {
    const requiredFields = {
      patientId: command.patientId,
      testCodes: command.testCodes,
    };

    const missingFields = Object.entries(requiredFields)
      .filter(([, value]) => value === undefined || value === null)
      .map(([key]) => key);

    if (missingFields.length > 0) {
      throw new InvalidPartnerResponseError(
        this.config.partnerId,
        `Missing required fields for Orange Health order: ${missingFields.join(', ')}`
      );
    }

    return {
      ...requiredFields,
      ...(command.patientName && { patientName: command.patientName }),
      ...(command.scheduledDate && { scheduledDate: command.scheduledDate }),
      ...(command.priority && { priority: command.priority }),
      ...(command.notes && { notes: command.notes }),
      ...(command.externalReferenceId && {
        externalReferenceId: command.externalReferenceId,
      }),
      ...(command.specimenType && { specimenType: command.specimenType }),
    };
  }

  async getServiceableLocations(query: string): Promise<ReturnType<typeof toResult>> {
    const url = `${this.baseUrl()}/lab/locations`;
    const headers = await this.getAuthHeaders();

    const { data } = await this.request({
      method: 'GET',
      url,
      headers,
      params: {
        query,
      },
    });

    return toResult(data, { success: true });
  }

  async getPartnerLocation(eloc: string): Promise<ReturnType<typeof toResult>> {
    const url = `${this.baseUrl()}/lab/locations/${encodeURIComponent(eloc)}`;
    const headers = await this.getAuthHeaders();

    const { data } = await this.request({
      method: 'GET',
      url,
      headers,
    });

    return toResult(data, { success: true });
  }

  async searchPackages(query: string): Promise<ReturnType<typeof toResult>> {
    const url = `${this.baseUrl()}/lab/packages`;
    const headers = await this.getAuthHeaders();

    const { data } = await this.request({
      method: 'GET',
      url,
      headers,
      params: {
        search: query,
      },
    });

    return toResult(data, { success: true });
  }

  async getPackageDetails(code: string): Promise<ReturnType<typeof toResult>> {
    const url = `${this.baseUrl()}/lab/packages/${encodeURIComponent(code)}`;
    const headers = await this.getAuthHeaders();

    const { data } = await this.request({
      method: 'GET',
      url,
      headers,
    });

    return toResult(data, { success: true });
  }

  async getBookingSlots(params: {
    latitude: number;
    longitude: number;
    collectionDate: string;
  }): Promise<ReturnType<typeof toResult>> {
    const url = `${this.baseUrl()}/lab/slots`;
    const headers = await this.getAuthHeaders();

    const { data } = await this.request({
      method: 'GET',
      url,
      headers,
      params: {
        latitude: params.latitude,
        longitude: params.longitude,
        collectionDate: params.collectionDate,
      },
    });

    return toResult(data, { success: true });
  }

  async confirmBooking(orderId: string, remark?: string): Promise<ReturnType<typeof toResult>> {
    const url = `${this.baseUrl()}/lab/orders/${encodeURIComponent(orderId)}/confirm`;
    const headers = await this.getAuthHeaders();

    const body: Record<string, unknown> = {};
    if (remark) {
      body.remark = remark;
    }

    const { data } = await this.request({
      method: 'POST',
      url,
      headers,
      data: body,
    });

    return toResult(data, { orderId, success: true });
  }

  async updatePackage(
    packageCode: string,
    updateData: Record<string, unknown>
  ): Promise<ReturnType<typeof toResult>> {
    const url = `${this.baseUrl()}/lab/packages/${encodeURIComponent(packageCode)}`;
    const headers = await this.getAuthHeaders();

    const { data } = await this.request({
      method: 'PUT',
      url,
      headers,
      data: updateData,
    });

    return toResult(data, { packageCode, success: true });
  }

  async getConsolidatedReport(orderId: string): Promise<ReturnType<typeof toResult>> {
    const url = `${this.baseUrl()}/lab/orders/${encodeURIComponent(orderId)}/reports/consolidated`;
    const headers = await this.getAuthHeaders();

    const { data } = await this.request({
      method: 'GET',
      url,
      headers,
    });

    return toResult(data, { orderId, success: true });
  }

  async getDigitalReport(
    orderId: string,
    format?: string
  ): Promise<ReturnType<typeof toResult>> {
    const url = `${this.baseUrl()}/lab/orders/${encodeURIComponent(orderId)}/reports/digital`;
    const headers = await this.getAuthHeaders();

    const params: Record<string, unknown> = {};
    if (format) {
      params.format = format;
    }

    const { data } = await this.request({
      method: 'GET',
      url,
      headers,
      params,
    });

    return toResult(data, { orderId, success: true });
  }
}
