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
  RedcliffeCreateOrderCommand,
  RedcliffeRescheduleOrderCommand,
} from '../../commands/redcliffe/redcliffe-order.extension';
import { InvalidPartnerResponseError } from '../../utils/error/custom-errors';

/**
 * Redcliffe Labs partner adapter.
 * Extends BasePartnerAdapter for shared functionality.
 */
export class RedcliffeAdapter
  extends BasePartnerAdapter
  implements PartnerAdapter
{
  constructor(config: PartnerConfig) {
    super(config);
  }

  /**
   * Override to use 'key' header instead of 'Authorization'.
   */
  protected override async getAuthHeaders(): Promise<Record<string, string>> {
    const apiKey = await this.getApiKey();
    return {
      'Content-Type': 'application/json',
      ...(apiKey && { key: apiKey }),
    };
  }

  async createOrder(command: CreateOrderCommand): Promise<ReturnType<typeof toResult>> {
    const redcliffeCommand = command as RedcliffeCreateOrderCommand;
    const url = `${this.baseUrl()}/api/external/v2/center-create-booking/`;
    const headers = await this.getAuthHeaders();

    const body = this.mapCreateOrderBody(redcliffeCommand);

    const { data } = await this.request<{
      booking_id?: number;
      status?: string;
    }>({
      method: 'POST',
      url,
      headers,
      data: body,
    });

    return toResult(data, {
      orderId: data?.booking_id?.toString(),
    });
  }

  async rescheduleOrder(
    orderId: string,
    command: RescheduleOrderCommand
  ): Promise<ReturnType<typeof toResult>> {
    const redcliffeCommand = command as RedcliffeRescheduleOrderCommand;
    const bookingId = parseInt(orderId, 10);

    if (Number.isNaN(bookingId)) {
      return toResultError(orderId, 'Invalid booking ID format');
    }

    const url = `${this.baseUrl()}/api/external/v2/center-update-booking/`;
    const headers = await this.getAuthHeaders();

    const body = {
      booking_id: bookingId,
      booking_status: 'rescheduled',
      collection_slot: redcliffeCommand.collectionSlot,
      collection_date: redcliffeCommand.collectionDate,
      remark: redcliffeCommand.remark ?? 'Order rescheduled',
    };

    const { data } = await this.request({
      method: 'POST',
      url,
      headers,
      data: body,
    });

    return toResult(data, { orderId, success: true });
  }

  async cancelOrder(orderId: string, remark?: string): Promise<ReturnType<typeof toResult>> {
    const bookingId = parseInt(orderId, 10);

    if (Number.isNaN(bookingId)) {
      return toResultError(orderId, 'Invalid booking ID format');
    }

    const url = `${this.baseUrl()}/api/external/v2/center-update-booking/`;
    const headers = await this.getAuthHeaders();

    const body = {
      booking_id: bookingId,
      booking_status: 'cancelled',
      remark: remark ?? 'Order cancelled',
    };

    const { data } = await this.request({
      method: 'POST',
      url,
      headers,
      data: body,
    });

    return toResult(data, { orderId, success: true });
  }

  async fetchStatus(orderId: string): Promise<ReturnType<typeof toResult> | ReturnType<typeof toResultError>> {
    const bookingId = parseInt(orderId, 10);

    if (Number.isNaN(bookingId)) {
      return toResultError(orderId, 'Invalid booking ID format');
    }

    const url = `${this.baseUrl()}/api/external/v2/center-get-booking`;
    const headers = await this.getAuthHeaders();

    const { data } = await this.request<{ errors?: string[] }>({
      method: 'GET',
      url,
      headers,
      params: {
        booking_id: bookingId,
      },
    });

    if (data?.errors?.includes('Dont have a matching booking')) {
      return toResultError(orderId, 'Booking ID does not exist or is not accessible');
    }

    return toResult(data, { orderId, success: true });
  }

  private mapCreateOrderBody(
    command: RedcliffeCreateOrderCommand
  ): Record<string, unknown> {
    const requiredFields = {
      booking_date: command.bookingDate,
      collection_date: command.collectionDate,
      collection_slot: command.collectionSlot,
      customer_name: command.patientName,
      package_code: command.testCodes,
      customer_email: command.customerEmail,
      customer_gender: command.customerGender,
      customer_latitude: command.customerLatitude,
      customer_longitude: command.customerLongitude,
      customer_phonenumber: command.customerPhoneNumber,
      customer_whatsapppnumber: command.customerWhatsAppNumber,
      is_credit: command.isCredit,
      landmark: command.landmark,
      pincode: command.pincode,
    };

    const missingFields = Object.entries(requiredFields)
      .filter(([, value]) => value === undefined || value === null)
      .map(([key]) => key);

    if (missingFields.length > 0) {
      throw new InvalidPartnerResponseError(
        this.config.partnerId,
        `Missing required fields for Redcliffe booking: ${missingFields.join(', ')}`
      );
    }

    return {
      ...requiredFields,
      reference_data: command.patientId ?? command.externalReferenceId,
      ...(command.customerAddress && {
        customer_address: command.customerAddress,
      }),
      ...(command.customerAge && { customer_age: command.customerAge }),
      ...(command.customerAltPhoneNumber && {
        customer_altphonenumber: command.customerAltPhoneNumber,
      }),
      ...(command.additionalMember && {
        additional_member: command.additionalMember,
      }),
    };
  }

  async getServiceableLocations(query: string): Promise<ReturnType<typeof toResult>> {
    const url = `${this.baseUrl()}/api/partner/v2/get-partner-location-2-eloc/`;
    const headers = await this.getAuthHeaders();

    const { data } = await this.request({
      method: 'GET',
      url,
      headers,
      params: {
        place_query: query,
      },
    });

    return toResult(data, { success: true });
  }

  async getPartnerLocation(eloc: string): Promise<ReturnType<typeof toResult>> {
    const url = `${this.baseUrl()}/api/partner/v2/get-partner-loc-2-eloc/`;
    const headers = await this.getAuthHeaders();

    const { data } = await this.request({
      method: 'GET',
      url,
      headers,
      params: {
        eloc,
      },
    });

    return toResult(data, { success: true });
  }

  async searchPackages(query: string): Promise<ReturnType<typeof toResult>> {
    const url = `${this.baseUrl()}/api/external/v2/center-package-data/`;
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
    const url = `${this.baseUrl()}/api/external/v2/package-parameter-data/`;
    const headers = await this.getAuthHeaders();

    const { data } = await this.request({
      method: 'GET',
      url,
      headers,
      params: {
        code,
      },
    });

    return toResult(data, { success: true });
  }

  async getBookingSlots(params: {
    latitude: number;
    longitude: number;
    collectionDate: string;
  }): Promise<ReturnType<typeof toResult>> {
    const url = `${this.baseUrl()}/api/booking/v2/get-time-slot-list/`;
    const headers = await this.getAuthHeaders();

    const { data } = await this.request({
      method: 'GET',
      url,
      headers,
      params: {
        latitude: params.latitude,
        longitude: params.longitude,
        collection_date: params.collectionDate,
      },
    });

    return toResult(data, { success: true });
  }
}
