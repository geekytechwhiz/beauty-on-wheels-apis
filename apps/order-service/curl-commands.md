# Order Service API - cURL Commands Reference

Base URL: `https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev`

## Common Headers
```bash
CONTENT_TYPE="Content-Type: application/json"
CORRELATION_ID="X-Correlation-Id: test-$(date +%s)"
IDEMPOTENCY_KEY="Idempotency-Key: order-$(date +%s)-$(shuf -i 1000-9999 -n 1)"
```

## 1. Health Check
```bash
curl -X GET \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: test-$(date +%s)" \
  https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "service": "order-service",
  "version": "dev",
  "time": "2026-01-06T11:03:06.693Z"
}
```

## 2. Create Order
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: test-$(date +%s)" \
  -H "Idempotency-Key: order-$(date +%s)-$(shuf -i 1000-9999 -n 1)" \
  -d '{
    "orgId": "test-org-123",
    "userId": "test-user-456",
    "idempotencyKey": "order-$(date +%s)-$(shuf -i 1000-9999 -n 1)",
    "meta": {
      "productId": "product-789",
      "productType": "package",
      "amount": 1000
    },
    "platform": "web",
    "transactionType": "paymentgateway"
  }' \
  https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev/order/create
```

**Request Body Schema:**
- `orgId` (string, required): Organization ID
- `userId` (string, required): User ID
- `idempotencyKey` (string, required): Unique idempotency key
- `meta.productId` (string, optional): Product ID
- `meta.productType` (enum, required): "package" | "addon"
- `meta.amount` (number, required): Order amount (non-negative)
- `platform` (enum, required): "web" | "mobile"
- `transactionType` (enum, required): "paymentgateway" | "cash"

**Expected Response (201/202):**
```json
{
  "statusCode": 201,
  "success": true,
  "message": "Order Created successfully",
  "data": {
    "orderId": "uuid-here",
    "status": "created",
    "amount": 1000,
    "currency": "INR",
    "paymentProvider": {
      "orderId": "razorpay-order-id",
      "amount": 1000,
      "currency": "INR",
      "receipt": "order-uuid"
    }
  }
}
```

## 3. Get Order Review (POST)
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: test-$(date +%s)" \
  -d '{
    "orderId": "your-order-id-here",
    "orgId": "test-org-123"
  }' \
  https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev/order/review
```

**Request Body Schema:**
- `orderId` (string, required): Order ID
- `orgId` (string, required): Organization ID

## 4. Get Order By ID (GET)
```bash
curl -X GET \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: test-$(date +%s)" \
  "https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev/order/your-order-id-here?orgId=test-org-123"
```

**Query Parameters:**
- `orgId` (string, required): Organization ID

**Path Parameters:**
- `orderId` (string, required): Order ID

## 5. List Orders
```bash
curl -X GET \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: test-$(date +%s)" \
  -H "Authorization: Bearer your-jwt-token-here" \
  "https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev/orders?limit=10&nextToken=optional-token"
```

**Query Parameters:**
- `limit` (number, optional): Number of orders to return (default: 20)
- `nextToken` (string, optional): Pagination token

**Note:** Requires valid JWT token in Authorization header.

## 6. Request Payment
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: test-$(date +%s)" \
  "https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev/order/your-order-id-here/payments?orgId=test-org-123"
```

**Path Parameters:**
- `orderId` (string, required): Order ID

**Query Parameters:**
- `orgId` (string, required): Organization ID

## 7. Payment Events (Webhook)
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: test-$(date +%s)" \
  -d '{
    "type": "PaymentSucceeded",
    "orderId": "your-order-id-here",
    "orgId": "test-org-123",
    "paymentId": "pay_test_123",
    "reason": "Payment completed successfully"
  }' \
  https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev/internal/payments/events
```

**Request Body Schema:**
- `type` (enum, required): "PaymentSucceeded" | "PaymentFailed"
- `orderId` (string, required): Order ID
- `orgId` (string, required): Organization ID
- `paymentId` (string, optional): Payment ID
- `reason` (string, optional): Reason for payment status

## 8. Cancel Order
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: test-$(date +%s)" \
  -d '{
    "orderId": "your-order-id-here",
    "orgId": "test-org-123"
  }' \
  https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev/order/cancel
```

**Request Body Schema:**
- `orderId` (string, required): Order ID
- `orgId` (string, required): Organization ID

## 9. Refund Payment
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: test-$(date +%s)" \
  -d '{
    "orderId": "your-order-id-here",
    "paymentId": "pay_test_456",
    "entityId": "entity_test_789",
    "orgId": "test-org-123",
    "amount": 500,
    "userId": "test-user-456",
    "gateway": "razorpay",
    "reason": "Customer requested refund"
  }' \
  https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev/order/refund
```

**Request Body Schema:**
- `paymentId` (string, required): Payment ID
- `amount` (number, required): Refund amount
- `orderId` (string, optional): Order ID
- `entityId` (string, optional): Entity ID
- `orgId` (string, optional): Organization ID
- `userId` (string, optional): User ID
- `gateway` (string, optional): Payment gateway
- `reason` (string, optional): Refund reason

## 10. Create Pharmacy Order
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: test-$(date +%s)" \
  -H "Idempotency-Key: pharmacy-$(date +%s)-$(shuf -i 1000-9999 -n 1)" \
  -d '{
    "orgId": "test-org-123",
    "userId": "test-user-456",
    "idempotencyKey": "pharmacy-$(date +%s)-$(shuf -i 1000-9999 -n 1)",
    "meta": {
      "productId": "medication-123",
      "productType": "package",
      "amount": 2500
    },
    "platform": "mobile",
    "transactionType": "cash"
  }' \
  https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev/pharmacy/order
```

**Request Body Schema:** Same as Create Order

## 11. Mark Paid (Complete Order)
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: test-$(date +%s)" \
  -d '{
    "orderId": "your-order-id-here",
    "orgId": "test-org-123"
  }' \
  https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev/order/complete
```

**Request Body Schema:**
- `orderId` (string, required): Order ID
- `orgId` (string, required): Organization ID

## 12. Generate Invoice
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: test-$(date +%s)" \
  -d '{
    "orderId": "your-order-id-here",
    "orgId": "test-org-123"
  }' \
  https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev/order/invoice
```

**Request Body Schema:**
- `orderId` (string, required): Order ID
- `orgId` (string, required): Organization ID

**Expected Response:**
```json
{
  "statusCode": 200,
  "success": true,
  "message": "Invoice generated successfully",
  "data": {
    "pdfUrl": "data:application/pdf;base64,..."
  }
}
```

## 13. Get Payment Status
```bash
curl -X GET \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: test-$(date +%s)" \
  "https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev/order/payments/pay_test_789/status?userId=test-user-456&entityId=entity_test_123"
```

**Path Parameters:**
- `paymentId` (string, required): Payment ID

**Query Parameters:**
- `userId` (string, optional): User ID (required for cash payments)
- `entityId` (string, optional): Entity ID (required for cash payments)

**Expected Response:**
```json
{
  "ok": true,
  "status": {
    "id": "payment-id",
    "status": "success",
    "amount": 1000
  }
}
```

## Error Responses

All endpoints may return the following error responses:

**400 Bad Request:**
```json
{
  "statusCode": 400,
  "success": false,
  "message": "Validation failed",
  "issues": [...]
}
```

**404 Not Found:**
```json
{
  "statusCode": 404,
  "success": false,
  "message": "Order not found"
}
```

**500 Internal Server Error:**
```json
{
  "statusCode": 500,
  "success": false,
  "message": "Internal server error"
}
```

## Notes

1. **Idempotency**: Use unique `idempotencyKey` for create operations to prevent duplicate orders.
2. **Correlation ID**: Include `X-Correlation-Id` header for request tracking.
3. **Authentication**: Some endpoints (like List Orders) require valid JWT tokens.
4. **Environment**: The API is deployed in `dev` stage. Update base URL for other stages.
5. **CORS**: All endpoints support CORS with `*` origin.


