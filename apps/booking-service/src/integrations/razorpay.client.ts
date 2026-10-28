import { createHmac, timingSafeEqual } from 'crypto';

import { env } from '../configs/env.config';
import { BookingError } from '../errors';

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
};

export type RazorpayGateway = {
  createOrder(input: {
    amountPaise: number;
    currency: string;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<RazorpayOrder>;
  verifyPaymentSignature(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
  publicKeyId(): string;
  isConfigured(): boolean;
};

export class HttpRazorpayGateway implements RazorpayGateway {
  isConfigured(): boolean {
    return Boolean(env.RAZORPAY_KEY_ID?.trim() && env.RAZORPAY_KEY_SECRET?.trim());
  }

  publicKeyId(): string {
    const key = env.RAZORPAY_KEY_ID?.trim();
    if (!key) {
      throw new BookingError('PAYMENT_PROVIDER_UNAVAILABLE', 'Razorpay key id is not configured', 503);
    }
    return key;
  }

  async createOrder(input: {
    amountPaise: number;
    currency: string;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<RazorpayOrder> {
    if (!this.isConfigured()) {
      throw new BookingError('PAYMENT_PROVIDER_UNAVAILABLE', 'Razorpay credentials are not configured', 503);
    }
    if (!Number.isInteger(input.amountPaise) || input.amountPaise < 100) {
      throw new BookingError('PAYMENT_AMOUNT_INVALID', 'Razorpay amount must be at least 100 paise', 400);
    }

    const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
    let response: Response;
    try {
      response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: input.amountPaise,
          currency: input.currency.toUpperCase(),
          receipt: input.receipt.slice(0, 40),
          notes: input.notes,
          payment_capture: 1,
        }),
      });
    } catch {
      throw new BookingError('PAYMENT_PROVIDER_UNAVAILABLE', 'Razorpay order create failed to connect', 502, undefined, true);
    }

    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const description = typeof body.error === 'object' && body.error && 'description' in body.error
        ? String((body.error as { description?: unknown }).description ?? 'Razorpay rejected the order')
        : 'Razorpay rejected the order';
      throw new BookingError('PAYMENT_PROVIDER_REJECTED', description, 502, undefined, true);
    }

    const id = typeof body.id === 'string' ? body.id : '';
    const amount = typeof body.amount === 'number' ? body.amount : NaN;
    const currency = typeof body.currency === 'string' ? body.currency : '';
    const receipt = typeof body.receipt === 'string' ? body.receipt : input.receipt;
    const status = typeof body.status === 'string' ? body.status : 'created';
    if (!id || !Number.isInteger(amount) || !currency) {
      throw new BookingError('PAYMENT_PROVIDER_UNAVAILABLE', 'Razorpay returned an incomplete order', 502);
    }
    return { id, amount, currency, receipt, status };
  }

  verifyPaymentSignature(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean {
    const secret = env.RAZORPAY_KEY_SECRET?.trim();
    if (!secret || !input.orderId || !input.paymentId || !input.signature) return false;
    const expected = createHmac('sha256', secret)
      .update(`${input.orderId}|${input.paymentId}`)
      .digest('hex');
    return equalHex(expected, input.signature);
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secret = env.RAZORPAY_WEBHOOK_SECRET?.trim();
    if (!secret || !rawBody || !signature) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return equalHex(expected, signature);
  }
}

function equalHex(expected: string, actual: string): boolean {
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(actual, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

let gateway: RazorpayGateway | undefined;

export function getRazorpayGateway(): RazorpayGateway {
  if (!gateway) gateway = new HttpRazorpayGateway();
  return gateway;
}

export function setRazorpayGatewayForTests(value: RazorpayGateway | undefined) {
  gateway = value;
}
