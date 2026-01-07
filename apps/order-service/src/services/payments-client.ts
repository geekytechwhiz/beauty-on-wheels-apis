/**
 * Payments API client with timeout, retries, and idempotency support.
 */

import { randomUUID } from "node:crypto";
import { createLogger, serializeError } from "@api-hub/logger";

const log = createLogger({ service: "payments.client", redactPII: true });

export type PaymentsCreateOrderRequest = {
  action: "createOrgOrder";
  payload: {
    customerId?: string;
    amount: number;
    currency: "INR";
    receipt: string;
    notes?: Record<string, any>;
    idempotencyKey?: string;
    gateway: string;
  };
};

export type CapturePaymentRequest = {
  action: "capturePayment";
  payload: {
    paymentProviderOrderId: string;
    amount: number;
    tenantId: string;
    gateway: string;
  };
};

export type RazorpayMeta = {
  orderId: string;
  customerId?: string;
  amount: number;
  currency: "INR";
  receipt: string;
  paymentId?: string;
};

export type PaymentsCreateOrderResponse = {
  success: boolean;
  razorpay?: RazorpayMeta;
  error?: string;
  statusCode?: number;
};


/** Sleep helper */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Add jitter to backoff */
export const withJitter = (baseMs: number) => {
  const jitter = Math.floor(Math.random() * 100);
  return baseMs + jitter;
};

/**
 * Generic retry wrapper with exponential backoff and jitter.
 */
export async function withRetries<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { maxRetries: number; backoffsMs: number[]; deadlineMs: number }
): Promise<T> {
  const start = Date.now();
  let attempt = 0;
  let lastErr: unknown;
  while (true) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      attempt++;
      const elapsed = Date.now() - start;
      if (attempt > opts.maxRetries || elapsed >= opts.deadlineMs) {
        throw err;
      }
      const wait = withJitter(
        opts.backoffsMs[Math.min(attempt - 1, opts.backoffsMs.length - 1)]
      );
      if (elapsed + wait >= opts.deadlineMs) {
        // respect deadline
        throw err;
      }
      await sleep(wait);
    }
  }
}

/** Build headers including API key and idempotency. */
function buildHeaders(idempotencyKey: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
  };
  const bearer = process.env.PAYMENTS_BEARER_TOKEN;
  const apiKey = process.env.PAYMENTS_API_KEY;
  if (bearer) {
    headers["Authorization"] = `Bearer ${bearer}`;
  } else if (apiKey) {
    // Prefer API Gateway style x-api-key; avoid setting Authorization to non-standard scheme
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

/**
 * Calls Payments API create-order with timeout, retries, and strict parsing.
 */
export async function callPaymentsApi(
  body: PaymentsCreateOrderRequest,
  idempotencyKey?: string
): Promise<PaymentsCreateOrderResponse> {

  let url = process.env.PAYMENTS_API_BASE_URL;
  if (!url) {
    return { success: false, error: "MISSING_PAYMENTS_API_BASE_URL" };
  }
  url = `${url}/payments/orders`;
  const timeoutMs = Number(process.env.PAYMENTS_REQUEST_TIMEOUT_MS || 3000);
  const maxRetries = Number(process.env.PAYMENTS_MAX_RETRIES || 2);
  const deadlineMs = 6000; // strict per-request deadline
  const backoffs = [300, 900];

  const key = idempotencyKey || `order-${body.payload.receipt}` || randomUUID();
  log.debug({ event: 'callPaymentsApi_request', receipt: body.payload.receipt, amount: body.payload.amount, timeoutMs, maxRetries });

  const exec = async (
    _attempt: number
  ): Promise<PaymentsCreateOrderResponse> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      log.debug({ event: 'callPaymentsApi_attempt', attempt: _attempt + 1 });
      log.debug({ event: 'callPaymentsApi_request_body', payload: body.payload });
      const res = await fetch(url, {
        method: "POST",
        headers: buildHeaders(key),
        body: JSON.stringify(body.payload),
        signal: ctrl.signal,
      } as RequestInit);

      const status = res.status;
      // 2xx path
      if (res.ok) {
        let json: any;
        try {
          json = await res.json();
        } catch (err) {
          log.error({ event: 'callPaymentsApi_json_parse_failed', err: serializeError(err) });
          throw new Error("INVALID_JSON");
        }
        // Case 1: legacy shape { success: true, razorpay: {...} }
        if (
          json &&
          json.razorpay &&
          typeof json.razorpay.orderId === "string" &&
          typeof json.razorpay.amount === "number" &&
          json.razorpay.currency === "INR"
        ) {
          log.info({ event: 'callPaymentsApi_success_legacy', rpOrderId: json.razorpay.orderId, amount: json.razorpay.amount });
          return json as PaymentsCreateOrderResponse;
        }
        // Case 2: new shape { data: { entity: 'order', id, amount, currency, receipt, ... }, ... }
        if (
          json &&
          json.data &&
          json.data.entity === "order" &&
          typeof json.data.id === "string" &&
          typeof json.data.amount === "number" &&
          json.data.currency === "INR"
        ) {
          log.info({ event: 'callPaymentsApi_success_new', rpOrderId: json.data.id, amount: json.data.amount });
          return {
            success: true,
            razorpay: {
              amount_due: json.data.amount_due,
              amount_paid: json.data.amount_paid,
              orderId: json.data.id,
              amount: json.data.amount,
              currency: json.data.currency,
              receipt: json.data.receipt,
              razorpayKeyId: json.data?.razorpayKeyId,
            },
          } as PaymentsCreateOrderResponse;
        }
        log.error({ event: 'callPaymentsApi_invalid_response_shape' });
        throw new Error("INVALID_PAYMENTS_RESPONSE");
      }

      // Non-2xx: determine retryability
      if (status === 429 || (status >= 500 && status < 600)) {
        log.debug({ event: 'callPaymentsApi_retryable_error', status });
        throw new Error(`RETRYABLE_${status}`);
      }
      // 4xx non-retryable
      let errText = "";
      try {
        errText = await res.text();
      } catch { }
      log.info({ event: 'callPaymentsApi_non_retryable_error', status, errLen: errText?.length || 0 });
      return {
        success: false,
        error: `NON_RETRYABLE_${status}:${errText}`,
        statusCode: status,
      };
    } catch (e: any) {
      // Network/timeout/abort => retryable
      if (e?.name === "AbortError") {
        log.debug({ event: 'callPaymentsApi_timeout' });
        throw new Error("TIMEOUT");
      }
      log.debug({ event: 'callPaymentsApi_request_failed', err: serializeError(e) });
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const result = await withRetries(exec, {
      maxRetries,
      backoffsMs: backoffs,
      deadlineMs,
    });
    return result;
  } catch (e: any) {
    log.error({ event: 'callPaymentsApi_failed_after_retries', err: serializeError(e) });
    return { success: false, error: e?.message || "PAYMENTS_API_ERROR" };
  }
}

/**
 * Calls Payment Capture API for cash payment with timeout, retries, and strict parsing.
 */
export async function callPaymentCaptureApi(
  body: CapturePaymentRequest,
): Promise<PaymentsCreateOrderResponse> {

  let url = process.env.PAYMENTS_API_BASE_URL;
  if (!url) {
    return { success: false, error: "MISSING_PAYMENTS_API_BASE_URL" };
  }
  url = `${url}/payments/${body.payload.paymentProviderOrderId}/capture`;
  const timeoutMs = Number(process.env.PAYMENTS_REQUEST_TIMEOUT_MS || 3000);
  const maxRetries = Number(process.env.PAYMENTS_MAX_RETRIES || 2);
  const deadlineMs = 6000; // strict per-request deadline
  const backoffs = [300, 900];

  log.debug({ event: 'callPaymentCaptureApi_request', paymentProviderOrderId: body.payload.paymentProviderOrderId, amount: body.payload.amount, timeoutMs, maxRetries });
    const key = `order-${body.payload.paymentProviderOrderId}` || randomUUID();

  const exec = async (
    _attempt: number
  ): Promise<PaymentsCreateOrderResponse> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      log.debug({ event: 'callPaymentCaptureApi_attempt', attempt: _attempt + 1 });
      log.debug({ event: 'callPaymentCaptureApi_request_body', payload: body.payload });
      const res = await fetch(url, {
        method: "POST",
        headers: buildHeaders(key),
        body: JSON.stringify(body.payload),
        signal: ctrl.signal,
      } as RequestInit);

      // const status = res.status;
      // 2xx path
      if (res.ok) {
        let json: any;
        try {
          json = await res.json();
          console.log("capture response", JSON.stringify(json));
        } catch (err) {
          log.error({ event: 'callPaymentCaptureApi_json_parse_failed', err: serializeError(err) });
          throw new Error("INVALID_JSON");
        }
        // Case 1: legacy shape { success: true, razorpay: {...} }
        if (
          json &&
          // json.success === true &&
          json.data &&
          typeof json.data.id === "string" &&
          typeof json.data.amount === "number" &&
          json.data.currency === "INR"
        ) {
          // log.info?.("Payments order created (legacy shape)", {
          //   rpOrderId: json.razorpay.orderId,
          //   amount: json.razorpay.amount,
          // });
          
          const razorpay = json.data;
          console.log("razorpay--", JSON.stringify(razorpay));
          razorpay.paymentId = razorpay.id;
          delete json.data;
          const jsonResp = {...json, razorpay};
          console.log("jsonResp--", JSON.stringify(jsonResp));

          jsonResp.success = true;
          return jsonResp as PaymentsCreateOrderResponse;
        }
        // If response is ok but does not match expected shape
        // return {
        //   success: false,
        //   error: "INVALID_PAYMENTS_RESPONSE",
        //   statusCode: res.status,
        // };
      }

      // Non-2xx: determine retryability
      // if (status === 429 || (status >= 500 && status < 600)) {
      //   log.debug?.("Retryable payments error", { status });
      //   throw new Error(`RETRYABLE_${status}`);
      // }
      // // 4xx non-retryable
      // let errText = "";
      // try {
      //   errText = await res.text();
      // } catch { }
      // log.info?.("Non-retryable payments error", {
      //   status,
      //   errLen: errText?.length || 0,
      // });
      // return {
      //   success: false,
      //   error: `NON_RETRYABLE_${status}:${errText}`,
      //   statusCode: status,
      // };
      // If response is not ok and not handled above, return generic error
      return {
        success: false,
        error: "PAYMENTS_API_ERROR",
        statusCode: res.status || 500,
      };
    } catch (e: any) {
      // Network/timeout/abort => retryable
      if (e?.name === "AbortError") {
        log.debug({ event: 'callPaymentCaptureApi_timeout' });
        throw new Error("TIMEOUT");
      }
      log.debug({ event: 'callPaymentCaptureApi_request_failed', err: serializeError(e) });
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const result = await withRetries(exec, {
      maxRetries,
      backoffsMs: backoffs,
      deadlineMs,
    });
    return result;
  } catch (e: any) {
    log.error({ event: 'callPaymentCaptureApi_failed_after_retries', err: serializeError(e) });
    return { success: false, error: e?.message || "PAYMENTS_API_ERROR" };
  }
}

// ===== Additional endpoints integration =====

type Json = Record<string, any> | undefined;

function getBaseUrl(): string | undefined {
  return process.env.PAYMENTS_API_BASE_URL;
}

async function sendRequest<T = any>(
  method: "GET" | "POST",
  path: string,
  body?: Json,
  idempotencyKey?: string,
  query?: Record<string, string | number | boolean | (string | number | boolean)[] | undefined | null>
): Promise<{
  ok: boolean;
  status: number;
  data?: T;
  text?: string;
  error?: string;
}> {
  const base = getBaseUrl();
  if (!base) return { ok: false, status: 0, error: "MISSING_BASE_URL" };
  const url = `${base.replace(/\/$/, "")}${path}`;
  const timeoutMs = Number(process.env.PAYMENTS_REQUEST_TIMEOUT_MS || 3000);
  const maxRetries = Number(process.env.PAYMENTS_MAX_RETRIES || 2);
  const deadlineMs = 6000;
  const backoffs = [300, 900];
  const headers = buildHeaders(idempotencyKey || `req-${randomUUID()}`);
    // 🔹 Build query string supporting multiple same-key params
  const queryString = query
    ? "?" +
      Object.entries(query)
        .flatMap(([key, value]) => {
          if (value === undefined || value === null) return [];
          if (Array.isArray(value)) {
            return value.map(
              (v) => `${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`
            );
          }
          return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
        })
        .join("&")
    : "";
  log.debug({ event: 'sendRequest', method, path, url: url, timeoutMs, maxRetries });

  const exec = async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const url = `${base.replace(/\/$/, "")}${path}${queryString}`;
    console.log("final url--", url);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      } as RequestInit);
      console.log("response--", JSON.stringify(res));
      const status = res.status;
      if (res.ok) {
        try {
          const data = (await res.json()) as T;
          log.debug({ event: 'sendRequest_success', method, path, status });
          return { ok: true, status, data };
        } catch {
          log.debug({ event: 'sendRequest_success_no_json', method, path, status });
          return { ok: true, status };
        }
      }
      if (status === 429 || (status >= 500 && status < 600)) {
        log.debug({ event: 'sendRequest_retryable_error', method, path, status });
        throw new Error(`RETRYABLE_${status}`);
      }
      const text = await res.text().catch(() => "");
      log.info({ event: 'sendRequest_non_retryable_error', method, path, status, errLen: text?.length || 0 });
      return { ok: false, status, text };
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error("TIMEOUT");
      log.debug({ event: 'sendRequest_failed', method, path, err: serializeError(e) });
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await withRetries(exec, {
      maxRetries,
      backoffsMs: backoffs,
      deadlineMs,
    });
  } catch (e: any) {
    return { ok: false, status: 0, error: e?.message || "REQUEST_ERROR" };
  }
}

/** GET /payments/{id} */
export async function getPayment(id: string, userId?: string, entityId?: string) {
  return sendRequest<any>("GET", `/payments/${encodeURIComponent(id)}`, undefined, undefined, {
    userId,
    entityId,
  });
}

/** GET /payments/{id}/status */
export async function getPaymentStatus(id: string) {
  return sendRequest<any>("GET", `/payments/${encodeURIComponent(id)}/status`);
}

/** POST /payments/{id}/cancel */
export async function cancelPayment(id: string, idempotencyKey?: string) {
  return sendRequest<any>(
    "POST",
    `/payments/${encodeURIComponent(id)}/cancel`,
    {},
    idempotencyKey
  );
}

/** POST /payments/{id}/complete */
export async function completePayment(id: string, idempotencyKey?: string) {
  return sendRequest<any>(
    "POST",
    `/payments/${encodeURIComponent(id)}/complete`,
    {},
    idempotencyKey
  );
}

/** POST /payments/{id}/capture */
export async function capturePayment(
  id: string,
  amount?: number,
  idempotencyKey?: string
) {
  const body = typeof amount === "number" ? { amount } : undefined;
  return sendRequest<any>(
    "POST",
    `/payments/${encodeURIComponent(id)}/capture`,
    body,
    idempotencyKey
  );
}

/** POST /refunds */
export async function createRefund(
  paymentId: string,
  amount: number,
  userId: string,
  entityId: string,
  orgId: string,
  orderId: string,
  idempotencyKey: string,
  gateway: string,
  reason?: string,
) {
  const body: Record<string, any> = { paymentId };
  if (typeof amount === "number") body.amount = amount;
  if (reason) body.reason = reason;
  if (userId) body.userId = userId;
  if (entityId) body.entityId = entityId;
  if (orgId) body.orgId = orgId;
  if (orderId) body.orderId = orderId;
  if (gateway) body.gateway = gateway;
  if (paymentId) body.paymentId = paymentId;
  if (idempotencyKey) body.idempotencyKey = idempotencyKey;
  return sendRequest<any>("POST", `/payments/refunds`, body, idempotencyKey);
}
