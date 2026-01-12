// Swagger type definitions used by serverless-auto-swagger (referenced via bodyType/responseData)

export interface HealthCheckResponse {
  status: string;
}

// Orders: Create
export interface orderMeta {
      productId?: string;
      productType: "package" | "addon";
      amount: number
    };

export interface CreateOrgOrderRequest {
  orgId: string;
  userId: string;
  idempotencyKey: string;
  meta: orderMeta;
  platform: "web" | "mobile";
  transactionType: "paymentgateway" | "cash";
  idempotencyKey?: string;
}


export interface PaymentProviderMeta {
  orderId?: string;
  orgId?: string;
  customerId?: string;
  amount?: number;
  currency?: "INR";
  receipt?: string;
  paymentProviderType?: string;
}


export interface CreateOrgOrderResponse {
  orderId: string;
  status: "created" | "failed";
  amount: number;
  currency: "INR";
  paymentProvider?: PaymentProviderMeta;
  paymentPending?: boolean;
  message?: string;
}

// Webhook (payments events -> orders)
export interface PaymentEventWebhook {
  type: "PaymentSucceeded" | "PaymentFailed";
  orderId: string;
  orgId: string;
  paymentId?: string;
  reason?: string;
}
