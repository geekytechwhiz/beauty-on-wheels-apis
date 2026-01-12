import { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { createLogger, extractCorrelationId, extractAwsRequestId, serializeError, logHttpRequest, createChildLogger } from '@api-hub/logger';
import { CreateOrgOrderRequestSchema } from "../libs/dtos/orders";
import { OrdersService } from "../services/orders.service";
import { successResponse, decodeToken } from "../utils/helper";

const baseLogger = createLogger({ service: 'order-service', redactPII: true });
 
export class OrdersController {
  constructor(private service = new OrdersService()) {}

  async handleCreateOrgOrder(event: APIGatewayProxyEventV2, context?: Context) {
    // Purpose: Create an org order; returns 201 or 202 when payment is pending
    const startTime = Date.now();
    const correlationId = extractCorrelationId(event);
    const awsRequestId = context ? extractAwsRequestId(context) : undefined;
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    
    logger.info({ event: 'createOrgOrder_received' });

    let body: unknown;
    try {
      body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || {};
    } catch (err) {
      logger.error({ event: 'createOrgOrder_parse_error', err: serializeError(err) });
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'POST', event.rawPath || '/orders', 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: "Invalid JSON body",
        }),
      };
    }

    const parsed = CreateOrgOrderRequestSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn({ event: 'createOrgOrder_validation_error', errors: parsed.error.issues });
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'POST', event.rawPath || '/orders', 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: "Validation failed",
          issues: parsed.error.issues,
        }),
      };
    }
    const req = parsed.data;
    const idempotencyKey = req.idempotencyKey;
    if(!idempotencyKey) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'POST', event.rawPath || '/orders', 400, duration, correlationId);
      return {
        statusCode: 400,  
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: "idempotencyKey is required",
        }),
      };
    }
    const authorizer: any = (event as any).requestContext?.authorizer;
    const userId =
      authorizer?.jwt?.claims?.sub ||
      authorizer?.principalId ||
      req.userId;
    const auth = { userId, roles: [] as string[] };
    
    try {
    const res: any = await this.service.createOrder(
      req,
      typeof idempotencyKey === "string" ? idempotencyKey : undefined,
      auth
    );
    const statusCode = (res as any).paymentPending ? 202 : 201;
      const duration = Date.now() - startTime;
      logger.info({ event: 'createOrgOrder_success', statusCode, orderId: res.orderId });
      logHttpRequest(logger,  'POST', event.rawPath || '/orders', statusCode, duration, correlationId);
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        statusCode,
        success: true,
        message: "Order Created successfully",
        data: res
      })
    };
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error({ event: 'createOrgOrder_error', err: serializeError(err) });
      logHttpRequest(logger,  'POST', event.rawPath || '/orders', 500, duration, correlationId);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 500,
          success: false,
          message: (err as Error)?.message || 'Internal server error',
        }),
      };
    }
  }

  async handleGetOrder(event: APIGatewayProxyEventV2, context?: Context) {
    // Purpose: Fetch a single order by orderId (requires orgId)
    const startTime = Date.now();
    const correlationId = extractCorrelationId(event);
    const awsRequestId = context ? extractAwsRequestId(context) : undefined;
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    
    logger.info({ event: 'getOrder_received' });

    let body: unknown;
    try {
      body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || {};
    } catch (err) {
      logger.error({ event: 'getOrder_parse_error', err: serializeError(err) });
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/get', 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: "Invalid JSON body",
        }),
      };
    }

    const { orderId, orgId } = body as { orderId?: string; orgId?: string };
    if (!orderId || !orgId) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/get', 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: "orderId and orgId are required in body"
        }),
      };
    }

    try {
    const res = await this.service.getOrder({ orderId, orgId });
      const duration = Date.now() - startTime;
      if (!res) {
        logHttpRequest(logger,  'POST', event.rawPath || '/orders/get', 404, duration, correlationId);
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 404,
          success: false,
          message: "Order not found",
        }),
      };
      }
      logger.info({ event: 'getOrder_success', orderId, orgId });
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/get', 200, duration, correlationId);
     return successResponse(res, 200, "Order details fetched successfully");
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error({ event: 'getOrder_error', err: serializeError(err), orderId, orgId });
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/get', 500, duration, correlationId);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 500,
          success: false,
          message: (err as Error)?.message || 'Internal server error',
        }),
      };
    }
  }

  async handleGetOrderById(event: APIGatewayProxyEventV2, context?: Context) {
    // Purpose: Fetch a single order via GET /order/{orderId}?orgId=...
    const startTime = Date.now();
    const correlationId = extractCorrelationId(event);
    const awsRequestId = context ? extractAwsRequestId(context) : undefined;
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    
    logger.info({ event: 'getOrderById_received' });

    const orderId = event.pathParameters?.orderId;
    const orgId = event.queryStringParameters?.orgId;
    if (!orderId || !orgId) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'GET', event.rawPath || `/orders/${orderId}`, 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: 'orderId (path) and orgId (query) are required'
        }),
      };
    }

    try {
    const res = await this.service.getOrder({ orderId, orgId });
      const duration = Date.now() - startTime;
    if (!res) {
        logHttpRequest(logger,  'GET', event.rawPath || `/orders/${orderId}`, 404, duration, correlationId);
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 404,
          success: false,
          message: 'Order not found'
        }),
      };
    }
      logger.info({ event: 'getOrderById_success', orderId, orgId });
      logHttpRequest(logger,  'GET', event.rawPath || `/orders/${orderId}`, 200, duration, correlationId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        statusCode: 200,
        success: true,
        message: 'Order details fetched successfully',
        data: res
      })
    };
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error({ event: 'getOrderById_error', err: serializeError(err), orderId, orgId });
      logHttpRequest(logger,  'GET', event.rawPath || `/orders/${orderId}`, 500, duration, correlationId);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 500,
          success: false,
          message: (err as Error)?.message || 'Internal server error',
        }),
      };
    }
  }

  async handleListOrders(event: APIGatewayProxyEventV2, context?: Context) {
    // Purpose: List orders for a user with optional pagination (limit/nextToken)
    const startTime = Date.now();
    const correlationId = extractCorrelationId(event);
    const awsRequestId = context ? extractAwsRequestId(context) : undefined;
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    
    logger.info({ event: 'listOrders_received' });

    try {
    const [userId] = await decodeToken(event?.headers?.Authorization ?? "");
    if (!userId) {
        const duration = Date.now() - startTime;
        logHttpRequest(logger,  'GET', event.rawPath || '/orders', 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: "userId is required",
        }),
      };
    }
    const limit = event.queryStringParameters?.limit
      ? parseInt(event.queryStringParameters?.limit)
      : 20;
    const nextToken = event.queryStringParameters?.nextToken;
    const res = await this.service.listUserOrders({ userId, limit, nextToken });
      const duration = Date.now() - startTime;
      logger.info({ event: 'listOrders_success', userId, limit, hasNextToken: !!nextToken });
      logHttpRequest(logger,  'GET', event.rawPath || '/orders', 200, duration, correlationId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        statusCode: 200,
        success: true,
        message: "Orders fetched successfully",
        data: res
      })
    };
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error({ event: 'listOrders_error', err: serializeError(err) });
      logHttpRequest(logger,  'GET', event.rawPath || '/orders', 500, duration, correlationId);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 500,
          success: false,
          message: (err as Error)?.message || 'Internal server error',
        }),
      };
    }
  }

  async handleRequestPayment(event: APIGatewayProxyEventV2, context?: Context) {
    // Purpose: Trigger payment-order creation for an existing order
    const startTime = Date.now();
    const correlationId = extractCorrelationId(event);
    const awsRequestId = context ? extractAwsRequestId(context) : undefined;
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    
    logger.info({ event: 'requestPayment_received' });

    const orderId = event.pathParameters?.orderId;
    const orgId = event.queryStringParameters?.orgId;
    if (!orderId || !orgId) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'POST', event.rawPath || `/orders/${orderId}/payment`, 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: "orderId and orgId are required",
        }),
      };
    }

    try {
    const res = await this.service.requestPaymentCreation({ orderId, orgId });
      const duration = Date.now() - startTime;
      logger.info({ event: 'requestPayment_success', orderId, orgId });
      logHttpRequest(logger,  'POST', event.rawPath || `/orders/${orderId}/payment`, 200, duration, correlationId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        statusCode: 200,
        success: true,
        message: "Payment creation requested",
        data: res
      })
    };
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error({ event: 'requestPayment_error', err: serializeError(err), orderId, orgId });
      logHttpRequest(logger,  'POST', event.rawPath || `/orders/${orderId}/payment`, 500, duration, correlationId);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 500,
          success: false,
          message: (err as Error)?.message || 'Internal server error',
        }),
      };
    }
  }

  async handlePaymentEvents(event: APIGatewayProxyEventV2, context?: Context) {
    // Purpose: Ingest payment webhook/callback events
    const startTime = Date.now();
    const correlationId = extractCorrelationId(event);
    const awsRequestId = context ? extractAwsRequestId(context) : undefined;
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    
    logger.info({ event: 'paymentEvents_received' });

    let body: unknown;
    try {
      body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || {};
    } catch (err) {
      logger.error({ event: 'paymentEvents_parse_error', err: serializeError(err) });
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'POST', event.rawPath || '/payment/events', 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: "Invalid JSON body",
        }),
      };
    }

    try {
      // Type assertion needed as payment event structure varies by provider
      const res = await this.service.handlePaymentEvent(body as Parameters<typeof this.service.handlePaymentEvent>[0]);
      const duration = Date.now() - startTime;
      logger.info({ event: 'paymentEvents_success' });
      logHttpRequest(logger,  'POST', event.rawPath || '/payment/events', 200, duration, correlationId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        statusCode: 200,
        success: true,
        message: "Payment event handled",
        data: res
      })
    };
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error({ event: 'paymentEvents_error', err: serializeError(err) });
      logHttpRequest(logger,  'POST', event.rawPath || '/payment/events', 500, duration, correlationId);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 500,
          success: false,
          message: (err as Error)?.message || 'Internal server error',
        }),
      };
    }
  }

  async handleCancelOrder(event: APIGatewayProxyEventV2, context?: Context) {
    // Purpose: Cancel an order (best-effort cancel payment if present)
    const startTime = Date.now();
    const correlationId = extractCorrelationId(event);
    const awsRequestId = context ? extractAwsRequestId(context) : undefined;
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    
    logger.info({ event: 'cancelOrder_received' });

    let body: unknown;
    try {
      body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || {};
    } catch (err) {
      logger.error({ event: 'cancelOrder_parse_error', err: serializeError(err) });
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/cancel', 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: "Invalid JSON body",
        }),
      };
    }

    const { orderId, orgId } = body as { orderId?: string; orgId?: string };
    if (!orderId || !orgId) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/cancel', 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: "orderId and orgId are required in body"
        }),
      };
    }

    try {
    const res = await this.service.cancelOrder({ orderId, orgId });
      const duration = Date.now() - startTime;
      logger.info({ event: 'cancelOrder_success', orderId, orgId });
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/cancel', 200, duration, correlationId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        statusCode: 200,
        success: true,
        message: "Order cancelled successfully",
        data: res
      })
    };
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error({ event: 'cancelOrder_error', err: serializeError(err), orderId, orgId });
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/cancel', 500, duration, correlationId);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 500,
          success: false,
          message: (err as Error)?.message || 'Internal server error',
        }),
      };
    }
  }

  async handleRefundPayment(event: APIGatewayProxyEventV2, context?: Context) {
    // Purpose: Request a refund for a specific payment on an order
    const startTime = Date.now();
    const correlationId = extractCorrelationId(event);
    const awsRequestId = context ? extractAwsRequestId(context) : undefined;
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    
    logger.info({ event: 'refundPayment_received' });

    let body: unknown;
    try {
      body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || {};
    } catch (err) {
      logger.error({ event: 'refundPayment_parse_error', err: serializeError(err) });
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'POST', event.rawPath || '/payment/refund', 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: "Invalid JSON body",
        }),
      };
    }

    const { orderId, paymentId, entityId, orgId, amount, userId, gateway, reason } = body as {
      orderId?: string;
      paymentId?: string;
      entityId?: string;
      orgId?: string;
      amount?: number;
      userId?: string;
      gateway?: string;
      reason?: string;
    };
    if (!paymentId || !amount) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'POST', event.rawPath || '/payment/refund', 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: "paymentId and amount are required in body",
        }),
      };
    }

    try {
      // paymentId and amount are already validated above, so they're guaranteed to be defined
      const res = await this.service.refundPayment({
        orderId: orderId ?? '',
        orgId: orgId ?? '',
        paymentId,
        amount,
        entityId: entityId ?? '',
        userId: userId ?? '',
        gateway: gateway ?? '',
        reason: reason ?? undefined
      });
      const duration = Date.now() - startTime;
      logger.info({ event: 'refundPayment_success', paymentId, orderId, amount });
      logHttpRequest(logger,  'POST', event.rawPath || '/payment/refund', 200, duration, correlationId);
       return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        statusCode: 200,
        success: true,
        message: "Refund processed successfully",
        data: res
      })
    };
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error({ event: 'refundPayment_error', err: serializeError(err), paymentId, orderId });
      logHttpRequest(logger,  'POST', event.rawPath || '/payment/refund', 500, duration, correlationId);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 500,
          success: false,
          message: (err as Error)?.message || 'Internal server error',
        }),
      };
    }
  }

  async handleCreatePharmacyOrder(event: APIGatewayProxyEventV2, context?: Context) {
    // Purpose: Create a pharmacy-only order (medications only)
    const startTime = Date.now();
    const correlationId = extractCorrelationId(event);
    const awsRequestId = context ? extractAwsRequestId(context) : undefined;
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    
    logger.info({ event: 'createPharmacyOrder_received' });

    let body: unknown;
    try {
      body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || {};
    } catch (err) {
      logger.error({ event: 'createPharmacyOrder_parse_error', err: serializeError(err) });
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/pharmacy', 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: "Invalid JSON body",
        }),
      };
    }

    try {
    const res = await this.service.createPharmacyOrder(body);
      const duration = Date.now() - startTime;
      logger.info({ event: 'createPharmacyOrder_success', orderId: (res as any)?.orderId });
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/pharmacy', 201, duration, correlationId);
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        statusCode: 201,
        success: true,
        message: "Pharmacy order created successfully",
        data: res
      })
    };
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error({ event: 'createPharmacyOrder_error', err: serializeError(err) });
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/pharmacy', 500, duration, correlationId);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 500,
          success: false,
          message: (err as Error)?.message || 'Internal server error',
        }),
      };
    }
  }

  async handleMarkPaid(event: APIGatewayProxyEventV2, context?: Context) {
    // Purpose: Mark an order as paid (internal/admin endpoint)
    const startTime = Date.now();
    const correlationId = extractCorrelationId(event);
    const awsRequestId = context ? extractAwsRequestId(context) : undefined;
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    
    logger.info({ event: 'markPaid_received' });

    let body: unknown;
    try {
      body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || {};
    } catch (err) {
      logger.error({ event: 'markPaid_parse_error', err: serializeError(err) });
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/mark-paid', 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: "Invalid JSON body",
        }),
      };
    }

    const { orderId, orgId } = body as { orderId?: string; orgId?: string };
    if (!orderId || !orgId) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/mark-paid', 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: "orderId and orgId are required in body",
        }),
      };
    }

    try {
    const res = await this.service.markPaid({ orderId, orgId });
      const duration = Date.now() - startTime;
      logger.info({ event: 'markPaid_success', orderId, orgId });
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/mark-paid', 200, duration, correlationId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        statusCode: 200,
        success: true,
        message: "Order marked as completed",
        data: res
      })
    };
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error({ event: 'markPaid_error', err: serializeError(err), orderId, orgId });
      const statusCode = (err as { statusCode?: number })?.statusCode || 500;
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/mark-paid', statusCode, duration, correlationId);
    return {
        statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
          statusCode,
        success: false,
          message: (err as Error)?.message || "Internal server error",
      })
    };
  }
}

  async handleGenerateInvoice(event: APIGatewayProxyEventV2, context?: Context) {
    // Purpose: Request invoice generation for an order
    const startTime = Date.now();
    const correlationId = extractCorrelationId(event);
    const awsRequestId = context ? extractAwsRequestId(context) : undefined;
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    
    logger.info({ event: 'generateInvoice_received' });

    let body: unknown;
    try {
      body = typeof event.body === "string" ? JSON.parse(event.body) : event.body || {};
    } catch (err) {
      logger.error({ event: 'generateInvoice_parse_error', err: serializeError(err) });
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/invoice', 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: "Invalid JSON body",
        }),
      };
    }

    const { orderId, orgId } = body as { orderId?: string; orgId?: string };
    if (!orderId || !orgId) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/invoice', 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 400,
          success: false,
          message: "orderId and orgId are required in body",
        }),
      };
    }

    try {
    const res = await this.service.generateInvoice({ orderId, orgId });
      const duration = Date.now() - startTime;
      logger.info({ event: 'generateInvoice_success', orderId, orgId });
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/invoice', 200, duration, correlationId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        statusCode: 200,
        success: true,
        message: "Invoice generated successfully",
        data: res
      })
    };
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error({ event: 'generateInvoice_error', err: serializeError(err), orderId, orgId });
      logHttpRequest(logger,  'POST', event.rawPath || '/orders/invoice', 500, duration, correlationId);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 500,
          success: false,
          message: (err as Error)?.message || 'Internal server error',
        }),
      };
    }
  }

  async handleGetPaymentStatus(event: APIGatewayProxyEventV2, context?: Context) {
    // Purpose: Request payment status for an order
    const startTime = Date.now();
    const correlationId = extractCorrelationId(event);
    const awsRequestId = context ? extractAwsRequestId(context) : undefined;
    const logger = createChildLogger(baseLogger, { correlationId, ...(awsRequestId && { awsRequestId }) });
    
    logger.info({ event: 'getPaymentStatus_received' });
    
    const paymentId = event.pathParameters?.paymentId;
    const { userId, entityId } = event.queryStringParameters || {};
    if(paymentId?.startsWith('cash_') && (!userId || !entityId)) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'GET', event.rawPath || `/payment/${paymentId}/status`, 400, duration, correlationId);
       return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: "userId and entityId are required in query parameters for cash payments" }),
      };
    }
    if (!paymentId) {
      const duration = Date.now() - startTime;
      logHttpRequest(logger,  'GET', event.rawPath || '/payment/status', 400, duration, correlationId);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: "paymentId is required in path parameters" }),
      };
    }
    
    try {
    const res = await this.service.getPaymentStatus(paymentId, userId, entityId);
      const duration = Date.now() - startTime;
      logger.info({ event: 'getPaymentStatus_success', paymentId });
      logHttpRequest(logger,  'GET', event.rawPath || `/payment/${paymentId}/status`, 200, duration, correlationId);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(res) };
    } catch (err) {
      const duration = Date.now() - startTime;
      logger.error({ event: 'getPaymentStatus_error', err: serializeError(err), paymentId });
      logHttpRequest(logger,  'GET', event.rawPath || `/payment/${paymentId}/status`, 500, duration, correlationId);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statusCode: 500,
          success: false,
          message: (err as Error)?.message || 'Internal server error',
        }),
      };
    }
  }
}
