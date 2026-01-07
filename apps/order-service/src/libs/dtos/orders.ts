import { z } from "zod";

export const ProductTypeEnum = z.enum(["package", "addon"]);

export const PlatformTypeEnum = z.enum(["web", "mobile"]);

export const PaymentTypeEnum = z.enum(["paymentgateway", "cash"]);

export const gatewayTypeEnum = z.enum(["razorpay", "cash"]);

export const orderMeta = z.object({
  productId: z.string().min(1).optional(),
  productType: ProductTypeEnum,
  amount: z.number().nonnegative(),
});

export const CreateOrgOrderRequestSchema = z.object({
  orgId: z.string().min(1),
  userId: z.string().min(1),
  idempotencyKey: z.string(),
  meta: orderMeta,
  platform: PlatformTypeEnum,
  transactionType: PaymentTypeEnum,
});

export type CreateOrgOrderRequest = z.infer<typeof CreateOrgOrderRequestSchema>;

export type PaymentProviderMeta = {
  orderId?: string;
  orgId: string;
  customerId?: string;
  amount?: number;
  currency?: "INR";
  paymentProviderKey?: string;
  paymentProviderType?: string;
  receipt?: string;
};

export type CreateOrgOrderResponse = {
  orderId: string;
  status: "created" | "failed";
  amount: number;
  currency: "INR";
  paymentProvider?: PaymentProviderMeta;
  invoiceId?: string;
};
export type services = {
  amount: number;
  discount: { type: string; value: number };
  metadata: Record<string, any>;
  quantity: number;
  title: string;
  type: string;
  unitPrice: number;
  subtotal: number;
  tax: number;
  taxInfo: string;
  totalBeforeTax: number;
  finalAmount: number;
  currency: string;
  currencySymbol: string;
  description: string;
};

export type userDetails = {
  email: string;
  name: string;
  phone: string;
  city: string;
  country: string;
  state: string;
  address: string;
};

export type orgDetails = {
  address: string;
  businessTaxId: string;
  city: string;
  country: string;
  email: string;
  logoUrl: string;
  name: string;
  phone: string;
  state: string;
  wesite: string;
};

export type OrgOrderEntity = {
  pk: string; // ORDERS#{ORG_ID}#ORDERS
  sk: string; // ORDER#{ORDER_ID}
  orderId: string;
  orgId: string;
  userId: string; // patientId
  platform: "web" | "mobile";
  transactionType: z.infer<typeof PaymentTypeEnum>;
  currency: "INR";
  status: "created" | "failed" | "completed" | "cancelled" | "refunded" | "refund_initiated" | "partially_refunded";
  productId?: string;
  productType?: z.infer<typeof ProductTypeEnum>;
  services?: services[];
  orgDetails?: orgDetails;
  amount: number;
  metadata?: Record<string, any> & { paymentProvider?: PaymentProviderMeta };
  sk1?: string; // status
  sk2?: string; // mode
  sk3?: string; // currency
  createdAt: string;
  updatedAt: string;
};

export type UserOrderEntity = {
  pk: string; // USER#{USER_ID}#ORDERS
  sk: string; // ORDER#{ORDER_ID}
  orderId: string;
  orgId: string;
  userId: string;
  status: OrgOrderEntity["status"];
  userDetails?: userDetails;
  createdAt: string;
};

export type OrderLogsEntity = {
  pk: string; // ORDERS#{ORG_ID}#ORDERS_LOGS
  sk: string; // ORDER#{ORDER_ID}#TS#{ISO}
  orderId: string;
  orgId: string;
  event: string;
  reason?: string;
  at: string;
};

export type OrderCreatedEvent = {
  type: "ORDER_CREATED";
  orderId: string;
  orgId: string;
  userId: string;
  createdAt: string;
  platform: "web" | "mobile";
  transactionType: z.infer<typeof PaymentTypeEnum>;
  metadata?: Record<string, any> & { paymentProvider?: PaymentProviderMeta };
};

export const enum EventTypes {
  ORDER_CREATED = "ORDER_CREATED",
}

// Invoice entity for order invoices (PRIMARY, REFUND, etc.)
export type InvoiceEntity = {
  pk: string; // ORDER#{orderId}#INVOICES
  sk: string; // INV#{invoiceType}#TS#{createdAtEpoch}#INVOICE#{invoiceId}
  invoiceId: string;
  orderId: string;
  orgId: string;
  invoiceType: "PRIMARY" | "REFUND" | "ADJUST" | "CREDIT";
  status: string;
  mode: string;
  invoiceDate: string;
  billedTo: {
    address: string;
    businessTaxId: string;
    city: string;
    country: string;
    email: string;
    name: string;
    phone: string;
    state: string;
    website: string;
  };
  orgInfo: {
    address: string;
    businessTaxId: string;
    city: string;
    country: string;
    email: string;
    logoUrl: string;
    name: string;
    phone: string;
    state: string;
    website: string;
  };
  products: Array<{
    amount: number;
    discount: { type: string; value: number };
    metadata: Record<string, any>;
    quantity: number;
    title: string;
    type: string;
    unitPrice: number;
  }>;
  summary: {
    amount: number;
    currency: string;
    currencySymbol: string;
    discount: { type: string; value: number };
    shipping: number;
    subtotal: number;
    tax: number;
    taxInfo: string;
    totalBeforeTax: number;
  };
};

export enum PaymentStatus {
  INITIATED = 'INITIATED',
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  REFUND_INITIATED = 'REFUND_INITIATED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
}

export enum orderStatus {
  CREATED = "created",
  FAILED = "failed",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
  REFUNDED = "refunded",
  REFUND_INITIATED = "refund_initiated",
  PARTIALLY_REFUNDED = "partially_refunded",
}
