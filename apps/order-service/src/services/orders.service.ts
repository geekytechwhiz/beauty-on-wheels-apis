 

// PaymentsCreateOrderResponse now imported from payments-client

import { createLogger, serializeError } from "@api-hub/logger";
import { randomUUID } from "crypto";
import { EventEmitter } from "../utils/event-emitter";
import { OrgOrderEntity, UserOrderEntity, OrderLogsEntity, OrderCreatedEvent, gatewayTypeEnum, PaymentStatus, orderStatus } from "../libs/dtos/orders";
import { OrdersRepository } from "../repositories/orders.repository";
import { CreateOrgOrderRequest, CreateOrgOrderResponse } from "../types/api-types";
import { getOrderStatusFromPaymentstatus } from "../utils/helper";
import { generateInvoiceBuffer } from "../utils/invoice-generator";
import { callPaymentsApi, cancelPayment, createRefund, callPaymentCaptureApi, PaymentsCreateOrderResponse, getPayment } from "./payments-client";

export class OrdersService {
  public validateCartRules(req: { meta?: { productId?: string; productType?: string } }) {
    this.logger.debug({ event: 'validateCartRules', orgId: (req as any).orgId, userId: (req as any).userId, productId: req.meta?.productId, productType: req.meta?.productType, platform: (req as any).platform, transactionType: (req as any).transactionType });
    if (!req.meta?.productId) {
      this.logger.info({ event: 'validateCartRules_error', message: 'Validation failed: missing productId in meta' });
      throw this.badRequest("productId must be specified in meta");
    }
    if (!req.meta?.productType) {
      this.logger.info({ event: 'validateCartRules_error', message: 'Validation failed: missing productType in meta' });
      throw this.badRequest("productType must be specified in meta");
    }
    this.logger.debug({ event: 'validateCartRules_success', message: 'Cart rules validated OK' });
  }
  private repo: OrdersRepository;
  private events: EventEmitter;

  private logger = createLogger({ service: "orders.service", redactPII: true });

  constructor(repo?: OrdersRepository, events?: EventEmitter) {
    this.repo = repo ?? new OrdersRepository();
    this.events = events ?? new EventEmitter();
    // No-op init: HTTP client uses env vars directly
    this.logger.debug({ event: 'OrdersService initialized' });
  }

  private badRequest(msg: string) {
    const err = new Error(msg) as any;
    err.statusCode = 400;
    return err;
  }

  private conflict(msg: string) {
    const err = new Error(msg) as any;
    err.statusCode = 409;
    return err;
  }

  private now() {
    return new Date().toISOString();
  }

  async createOrder(
    req: CreateOrgOrderRequest,
    idempotencyKey?: string,
    auth?: { userId: string; roles?: string[] }
  ) {
    this.logger.info({ event: 'createOrder_received',
      orgId: req.orgId,
      userId: req.userId,
      platform: req.platform,
      transactionType: req.transactionType,
      hasIdempotencyKey: !!idempotencyKey,
    });

    this.validateCartRules(req);
    this.logger.debug({ event: 'createOrder_cart_validation_passed' });

    const orderId = randomUUID();
    const createdAt = this.now();
    const updatedAt = createdAt;
    const sk1 = `STATUS#created`;
    const sk2 = `MODE#${req.transactionType}`;
    const sk3 = `CUR#INR`;
    this.logger.debug({ event: 'createOrder_entities_prepared', orderId, orgId: req.orgId, userId: req.userId, status: "created" });

    const orgOrder: OrgOrderEntity = {
      pk: `ORDERS#${req.orgId}#ORDERS`,
      sk: `ORDER#${orderId}`,
      orderId,
      orgId: req.orgId,
      userId: req.userId,
      platform: req.platform,
      transactionType: req.transactionType,
      currency: "INR",
      status: "created",
      amount: req.meta.amount,
      productId: req.meta.productId,
      productType: req.meta.productType,
      metadata: idempotencyKey ? { idempotencyKey } : {},
      sk1,
      sk2,
      sk3,
      createdAt,
      updatedAt,
    };

    const userOrder: UserOrderEntity = {
      pk: `USER#${req.userId}#ORDERS`,
      sk: `ORDER#${orderId}`,
      orderId,
      orgId: req.orgId,
      userId: req.userId,
      status: "created",
      createdAt,
    };

    const logs: OrderLogsEntity = {
      pk: `ORDERS#${req.orgId}#ORDERS_LOGS`,
      sk: `ORDER#${orderId}#TS#${createdAt}`,
      orderId,
      orgId: req.orgId,
      event: "created",
      at: createdAt,
    };

            // Persist with transaction
    
    this.logger.info({ event: 'createOrder_persisting', orderId, orgId: req.orgId });

    await this.persistOrgAndUserOrders(orgOrder, userOrder, logs);
    this.logger.info({ event: 'createOrder_persisted', orderId, orgId: req.orgId });

    // Emit ORDER_CREATED event
    const createdEvent: OrderCreatedEvent = {
      type: "ORDER_CREATED",
      orderId,
      orgId: req.orgId,
      userId: req.userId,
      createdAt,
      platform: req.platform,
      transactionType: req.transactionType,
      metadata: orgOrder.metadata,
    };
    await this.emitStreamEvent(createdEvent); 
    this.logger.debug({ event: 'createOrder_event_emitted', orderId, orgId: req.orgId, eventType: 'ORDER_CREATED' });
    // Synchronous HTTP call to Payments API
    let paymentProvider: CreateOrgOrderResponse["paymentProvider"] | undefined =
      undefined;
    let paymentPending = false;
    const idempKey = orgOrder.metadata?.idempotencyKey || `order-${orderId}`;
    const resp = await callPaymentsApi(
      {
        action: "createOrgOrder",
        payload: {
          customerId: req.userId,
          amount: req.meta.amount,
          currency: "INR",
          receipt: orderId,
          gateway: req.transactionType === gatewayTypeEnum.enum.cash ? gatewayTypeEnum.enum.cash : gatewayTypeEnum.enum.razorpay,
          idempotencyKey: idempotencyKey,
          notes: { orgId: req?.orgId, userId: req?.userId, orderId, productId: req?.meta?.productId, productType: req?.meta?.productType },
        },
      },
      idempKey
    );

    this.logger.debug({ event: 'createOrder_payments_response', orderId, success: resp.success, hasPaymentProvider: !!resp.razorpay, errorMessage: resp.error });
    if (resp.success && resp.razorpay) {
      paymentProvider = {
        ...resp.razorpay,
        orgId: req.orgId,
        paymentProviderType: gatewayTypeEnum.enum.razorpay // hardcoded for now
      };
      await this.repo.updateOrgOrderMetadata(orderId, req.orgId, {
        ...orgOrder.metadata,
        paymentProvider,
      });
      this.logger.info({ event: 'createOrder_payment_created', orderId, rpOrderId: resp.razorpay.orderId });
    } else {
      // Fallback: leave status as created, add metadata flag and logs; client will see pending
      paymentPending = true;
      await this.repo.updateOrgOrderMetadata(orderId, req.orgId, {
        ...orgOrder.metadata,
        paymentCreationStatus: "failed",
        paymentCreationError: resp.error || "UNKNOWN",
      });
      const failLogs: OrderLogsEntity = {
        pk: `ORDERS#${req.orgId}#ORDERS_LOGS`,
        sk: `ORDER#${orderId}#TS#${this.now()}`,
        orderId,
        orgId: req.orgId,
        event: "payment_creation_failed",
        reason: resp.error,
        at: this.now(),
      };
      await this.repo.createOrderLogs(failLogs);
      this.logger.info({ event: 'createOrder_payment_failed', orderId, errorMessage: resp.error || "UNKNOWN" });
    }

    // Notifications via SQS were removed; keep a debug log instead.
    this.logger.debug({ event: 'createOrder_notification_skipped', orderId, reason: 'SQS removed' });

    const response: CreateOrgOrderResponse = {
      orderId,
      status: "created",
      amount: req.meta.amount,
      currency: "INR",
      paymentProvider: paymentProvider
        ? {
          ...paymentProvider,
          paymentProviderType: "razorpay" // hardcoded for now
        }
        : undefined,
    };
    // If payment is pending due to fallback, caller can translate to 202 Accepted
    if (paymentPending) {
      (response as any).paymentPending = true;
      (response as any).message =
        "Payment order creation pending. Retry later or use async webhook.";
      this.logger.info({ event: 'createOrder_response_pending', orderId, amount: req.meta.amount });
    } else {
      this.logger.info({ event: 'createOrder_response_success', orderId, amount: req.meta.amount });
    }
    return response;
  }

  async getOrder(args: { orderId: string; orgId: string }) {
    this.logger.debug({ event: 'getOrder', orderId: args.orderId, orgId: args.orgId });
    const pk = `ORDERS#${args.orgId}#ORDERS`;
    const sk = `ORDER#${args.orderId}`;
    const orderData = await this.repo.getOrderById(pk, sk);
    const userId = orderData?.userId ?? '';
    let userDetails;
    let invoiceDetails;

    if (userId) {
      const user_pk = `USER#${userId}#ORDERS`;
      const userOrderDetails = (await this.repo.getUserOrderById(user_pk, sk)) ?? ({} as UserOrderEntity);
      userDetails = userOrderDetails?.userDetails ?? {};
      invoiceDetails = await this.repo.getOrderInvoice(args.orderId);
    
    }

    return { ...orderData, userDetails, invoiceDetails }
  }

  async listUserOrders(args: {
    userId: string;
    limit?: number;
    nextToken?: string;
  }) {
    this.logger.debug({ event: 'listUserOrders', userId: args.userId, limit: args.limit ?? 20, hasNextToken: !!args.nextToken });
    const res = await this.repo.queryUserOrders(
      args.userId,
      args.limit ?? 20,
      args.nextToken
    );
    this.logger.debug({ event: 'listUserOrders_result', userId: args.userId, count: res.items?.length ?? 0, hasNextToken: !!res.nextToken });
    return res;
  }

  async requestPaymentCreation(args: { orderId: string; orgId: string }) {
    this.logger.info({ event: 'requestPaymentCreation', orderId: args.orderId, orgId: args.orgId });
    const order = await this.getOrder(args);
    if (!order) {
      this.logger.info({ event: 'requestPaymentCreation_order_not_found', orderId: args.orderId, orgId: args.orgId });
      throw this.badRequest("Order not found");
    }
    const orderId = order.orderId || '';
    const orgId = order.orgId || '';
    const amount = order?.amount || 0;
    const resp = await callPaymentsApi(
      {
        action: "createOrgOrder",
        payload: {
          amount,
          currency: "INR",
          receipt: order?.orderId || '',
          gateway: order.transactionType === gatewayTypeEnum.enum.cash ? gatewayTypeEnum.enum.cash : gatewayTypeEnum.enum.razorpay,
          notes: {
            orgId: order.orgId,
            userId: order.userId,
            orderId: order.orderId,
          },
        },
      },
      order.metadata?.idempotencyKey || `order-${order.orderId}`
    );
    if (!resp.success) {
      this.logger.error({ event: 'requestPaymentCreation_failed', orderId: order.orderId, orgId: order.orgId, errorMessage: resp.error });
      throw new Error("Failed to create payment order");
    }
    if (resp.razorpay) {
      await this.repo.updateOrgOrderMetadata(orderId, orgId, {
        ...(order.metadata || {}),
        paymentProvider: resp.razorpay,
      });
      this.logger.info({ event: 'requestPaymentCreation_success', orderId: order.orderId, rpOrderId: resp.razorpay?.orderId });
    }
    return { razorpay: resp.razorpay };
  }

  async handlePaymentEvent(evt: {
    paymentStatus: PaymentStatus;
    orderId: string;
    orgId: string;
    userId: string;
    paymentId?: string;
    entityId?: string;
    reason?: string;
  }) {
    console.log("event--", JSON.stringify(evt));
    this.logger.info({ event: 'handlePaymentEvent', paymentStatus: evt.paymentStatus, orderId: evt.orderId, orgId: evt.orgId, entityId: evt.entityId, paymentId: evt.paymentId, reason: evt.reason, userId: evt.userId });
    const status = getOrderStatusFromPaymentstatus(evt.paymentStatus);
    console.log("mapped status --", status);
    await this.repo.updateOrgOrderStatus(evt.orderId, evt.orgId, status, evt.paymentId, evt.entityId);
    await this.repo.createOrderLogs({
      pk: `ORDERS#${evt.orgId}#ORDERS_LOGS`,
      sk: `ORDER#${evt.orderId}#TS#${this.now()}`,
      orderId: evt.orderId,
      orgId: evt.orgId,
      event: status,
      reason: evt.reason,
      at: this.now(),
    });
    await this.repo.updateUserOrderStatus(evt.orderId, evt.userId, status, evt.paymentId ? { paymentId: evt.paymentId, entityId: evt.entityId } : undefined);

    // await this.events.publishEvent({
    //   type: `ORDER_${evt.status.toUpperCase()}`,
    //   orderId: evt.orderId,
    //   orgId: evt.orgId,
    // });
    this.logger.info({ event: 'handlePaymentEvent_status_updated', orderId: evt.orderId, orgId: evt.orgId, status, paymentId: evt.paymentId, entityId: evt.entityId });
    return { ok: true };
  }

  async cancelOrder(args: { orderId: string; orgId: string }) {
    this.logger.info({ event: 'cancelOrder', orderId: args.orderId, orgId: args.orgId });
    // TODO: enforce policy (disallow after paid/shipped etc.)
    // Best-effort cancel against Payments API if we have a payment/order id
    try {
      const current = await this.getOrder({
        orderId: args.orderId,
        orgId: args.orgId,
      });
      const rpId =
        (current?.metadata as any)?.razorpayOrder?.orderId ||
        (current?.metadata as any)?.paymentId;
      if (rpId) {
        this.logger.debug({ event: 'cancelOrder_payment_cancellation', orderId: args.orderId, rpId });
        await cancelPayment(rpId, `cancel-${args.orderId}`);
      } else {
        this.logger.debug({ event: 'cancelOrder_no_payment_reference', orderId: args.orderId });
      }
    } catch (e: any) {
      this.logger.info({ event: 'cancelOrder_payment_cancellation_failed', orderId: args.orderId, err: serializeError(e) });
    }
    await this.repo.updateOrgOrderStatus(args.orderId, args.orgId, orderStatus.CANCELLED);
    const current = await this.getOrder({ orderId: args.orderId, orgId: args.orgId });
    if (current?.userId) {
      await this.repo.updateUserOrderStatus(args.orderId, current.userId, orderStatus.CANCELLED);
    }
    await this.repo.createOrderLogs({
      pk: `ORDERS#${args.orgId}#ORDERS_LOGS`,
      sk: `ORDER#${args.orderId}#TS#${this.now()}`,
      orderId: args.orderId,
      orgId: args.orgId,
      event: "cancelled",
      at: this.now(),
    });
    await this.events.publishEvent({
      type: "ORDER_CANCELLED",
      orderId: args.orderId,
      orgId: args.orgId,
    });
    this.logger.info({ event: 'cancelOrder_success', orderId: args.orderId, orgId: args.orgId });
    return { status: "cancelled" };
  }

  async refundPayment(args: {
    orderId: string;
    orgId: string;
    paymentId: string;
    amount: number,
    entityId: string;
    userId: string;
    gateway: string;
    reason?: string;
  }) {
    this.logger.info({ event: 'refundPayment', orderId: args.orderId, orgId: args.orgId, paymentId: args.paymentId });
    const current = await this.getOrder({ orderId: args.orderId, orgId: args.orgId });
    try {
      await createRefund(
        args.paymentId,
        args.amount,
        args.userId,
        args.entityId,
        args.orgId,
        args.orderId,
        `refund-${args.orderId}-${args.paymentId}`,
        args.gateway,
        args.reason,
      );
      this.logger.info({ event: 'refundPayment_triggered', orderId: args.orderId, paymentId: args.paymentId });
    } catch(e) {
      this.logger.error({ event: 'refundPayment_failed', orderId: args.orderId, paymentId: args.paymentId, err: serializeError(e) });
    }
    // await this.events.publishEvent({
    //   type: "PAYMENT_REFUND_REQUESTED",
    //   ...args,
    // });
    await this.repo.createOrderLogs({
      pk: `ORDERS#${args.orgId}#ORDERS_LOGS`,
      sk: `ORDER#${args.orderId}#TS#${this.now()}`,
      orderId: args.orderId,
      orgId: args.orgId,
      event: "refund_requested",
      at: this.now(),
    });
    await this.repo.updateOrgOrderStatus(args.orderId, args.orgId, args.gateway === gatewayTypeEnum.enum.cash ? orderStatus.REFUNDED : orderStatus.REFUND_INITIATED);
    if (current?.userId) {
      await this.repo.updateUserOrderStatus(args.orderId, current.userId, args.gateway === gatewayTypeEnum.enum.cash ? orderStatus.REFUNDED : orderStatus.REFUND_INITIATED);
    }
    await this.repo.createOrderLogs({
      pk: `ORDERS#${args.orgId}#ORDERS_LOGS`,
      sk: `ORDER#${args.orderId}#TS#${this.now()}`,
      orderId: args.orderId,
      orgId: args.orgId,
      event: "refund_initiated",
      at: this.now(),
    });
    const updated = await this.getOrder({ orderId: args.orderId, orgId: args.orgId });
    this.logger.debug({ event: 'refundPayment_completed', orderId: args.orderId });
    return { ok: true, status: args.gateway === gatewayTypeEnum.enum.cash ? orderStatus.REFUNDED : orderStatus.REFUND_INITIATED, order: updated };
  }

  async createPharmacyOrder(body: any) {
    this.logger.info({ event: 'createPharmacyOrder' });
    // Expect only medications for pharmacy order
    const req: CreateOrgOrderRequest = body;
    const res = await this.createOrder(req, req?.idempotencyKey, {
      userId: req.userId,
      roles: [],
    });
    this.logger.info({ event: 'createPharmacyOrder_success', orderId: res.orderId });
    return res;
  }

  async markPaid(args: { orderId: string; orgId: string }) {
    this.logger.info({ event: 'markPaid', orderId: args.orderId, orgId: args.orgId });

    try{
      const orderDetails = await this.getOrder({ orderId: args.orderId, orgId: args.orgId });
      if(!orderDetails){
        this.logger.error({ event: 'markPaid_order_not_found', orderId: args.orderId, orgId: args.orgId });
        throw this.badRequest("Order not found");
      }
      
       if(!orderDetails.userId){
        this.logger.error({ event: 'markPaid_userId_not_found', orderId: args.orderId, orgId: args.orgId });
        throw this.badRequest("Order not found");
      }

      const paymentProviderOrderId = (orderDetails?.metadata as any)?.paymentProvider?.orderId;

       const resp = await callPaymentCaptureApi(
      {
        action: "capturePayment",
        payload: {
          paymentProviderOrderId: paymentProviderOrderId,
          amount: orderDetails.amount ?? 0,
          tenantId: orderDetails.userId ?? '',
          gateway: gatewayTypeEnum.enum.cash,
        },
      });

      console.log("capture resp--", JSON.stringify(resp));

    this.logger.debug({ event: 'markPaid_payments_response', orderId: args.orderId, success: resp.success, hasPaymentProvider: !!resp.razorpay, errorMessage: resp.error });
    if (resp.success && resp.razorpay) {

      const paymentProvider = {
        ...resp.razorpay,
        paymentProviderType: "razorpay" // hardcoded for now
      };
    await this.repo.updateOrgOrderStatus(args.orderId, args.orgId, orderStatus.COMPLETED, paymentProvider.paymentId, paymentProviderOrderId);
    const current = await this.getOrder({ orderId: args.orderId, orgId: args.orgId });
    if (current?.userId) {
      await this.repo.updateUserOrderStatus(args.orderId, current.userId, orderStatus.COMPLETED);
    }
    await this.repo.createOrderLogs({
      pk: `ORDERS#${args.orgId}#ORDERS_LOGS`,
      sk: `ORDER#${args.orderId}#TS#${this.now()}`,
      orderId: args.orderId,
      orgId: args.orgId,
      event: "completed",
      at: this.now(),
    });
    } else {
      // Fallback: leave status as created, add metadata flag and logs; client will see pending
         await this.repo.updateOrgOrderStatus(args.orderId, args.orgId, orderStatus.FAILED);

      const failLogs: OrderLogsEntity = {
        pk: `ORDERS#${args.orgId}#ORDERS_LOGS`,
        sk: `ORDER#${args.orderId}#TS#${this.now()}`,
        orderId: args.orderId,
        orgId: args.orgId,
        event: "payment_creation_failed",
        reason: resp.error,
        at: this.now(),
      };
      await this.repo.createOrderLogs(failLogs);
      this.logger.info({ event: 'markPaid_payment_failed', orderId: args.orderId, errorMessage: resp.error || "UNKNOWN" });
    }

 
    // await this.events.publishEvent({
    //   type: "ORDER_COMPLETED",
    //   orderId: args.orderId,
    //   orgId: args.orgId,
    // });
    this.logger.info({ event: 'markPaid_success', orderId: args.orderId, orgId: args.orgId });
    return { status: "completed" }


    }catch(e){
      this.logger.error({ event: 'markPaid_error', orderId: args.orderId, orgId: args.orgId, err: serializeError(e) });
      throw e;
    }
  }
  

  async generateInvoice(args: { orderId: string; orgId: string }) {
    this.logger.info({ event: 'generateInvoice', orderId: args.orderId, orgId: args.orgId });
    const invoice = await this.repo.getOrderInvoice(args.orderId);
    if (invoice) {

      const pdfBuffer = await generateInvoiceBuffer(invoice);
      return {
        pdfUrl: `data:application/pdf;base64,${pdfBuffer.toString('base64')}`
      };
    }
    return { error: 'Invoice entity not found' };
  }

  async persistOrgAndUserOrders(
    orgOrder: OrgOrderEntity,
    userOrder: UserOrderEntity,
    logs: OrderLogsEntity
  ) {
    this.logger.debug({ event: 'persistOrgAndUserOrders', orderId: orgOrder.orderId, orgId: orgOrder.orgId, userId: orgOrder.userId, status: orgOrder.status });
    try {
      await this.repo.transactCreate(orgOrder, userOrder, logs);
      this.logger.debug({ event: 'persistOrgAndUserOrders_success', orderId: orgOrder.orderId });
    } catch (e: any) {
      this.logger.error({ event: 'persistOrgAndUserOrders_failed', orderId: orgOrder.orderId, orgId: orgOrder.orgId, err: serializeError(e) });
      if (e.name === "TransactionCanceledException") {
        throw this.conflict("Duplicate order or idempotency conflict");
      }
      throw e;
    }
  }

  // Deprecated: HTTP path used directly in createOrder
  async callPaymentsServiceIfNeeded(payload: {
    amount: number;
    currency: "INR";
    receipt: string;
    notes: Record<string, any>;
  }) {
    this.logger.debug({ event: 'callPaymentsServiceIfNeeded', receipt: payload.receipt, amount: payload.amount, note: 'deprecated' });
    return { success: false, error: "NOT_USED" } as PaymentsCreateOrderResponse;
  }

  async emitStreamEvent(evt: OrderCreatedEvent) {
    this.logger.debug({ event: 'emitStreamEvent', type: evt.type, orderId: evt.orderId, orgId: evt.orgId });
    // await this.events.publishEvent(evt);
    console.log("Event publishing disabled in dev");
    this.logger.debug({ event: 'emitStreamEvent_published', type: evt.type, orderId: evt.orderId, orgId: evt.orgId });
  }
  async getPaymentStatus(paymentId: string, userId?: string, entityId?: string) {
    this.logger.info({ event: 'getPaymentStatus', paymentId, userId, entityId });
    try {
      const result = await getPayment(paymentId, userId, entityId);
      this.logger.info({ event: 'getPaymentStatus_success', paymentId, result });
      return { ok: true, status: result };
    } catch (error: any) {
      this.logger.error({ event: 'getPaymentStatus_error', paymentId, err: serializeError(error) });
      return { ok: false, status: undefined };
    }
  }
}
