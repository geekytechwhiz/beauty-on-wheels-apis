#!/bin/bash

# Order Service API Endpoint Testing Script (Detailed Version)
# Base URL: https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev

BASE_URL="https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev"
CORRELATION_ID="test-$(date +%s)"

echo "=========================================="
echo "Order Service API Endpoint Testing (Detailed)"
echo "Base URL: $BASE_URL"
echo "Correlation ID: $CORRELATION_ID"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test function with verbose output
test_endpoint() {
    local name=$1
    local method=$2
    local path=$3
    local body=$4
    local headers=$5
    
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}Testing: $name${NC}"
    echo -e "${BLUE}Method: $method${NC}"
    echo -e "${BLUE}Path: $path${NC}"
    echo ""
    
    if [ -n "$body" ]; then
        echo "Request Body:"
        echo "$body" | jq '.' 2>/dev/null || echo "$body"
        echo ""
    fi
    
    # Build curl command
    CURL_CMD="curl -s -w \"\n\nHTTP Status: %{http_code}\nTime: %{time_total}s\n\" -X $method"
    
    if [ -n "$headers" ]; then
        CURL_CMD="$CURL_CMD $headers"
    fi
    
    CURL_CMD="$CURL_CMD -H \"Content-Type: application/json\""
    CURL_CMD="$CURL_CMD -H \"X-Correlation-Id: $CORRELATION_ID\""
    
    if [ -n "$body" ]; then
        CURL_CMD="$CURL_CMD -d '$body'"
    fi
    
    CURL_CMD="$CURL_CMD \"$BASE_URL$path\""
    
    echo "Curl Command:"
    echo "$CURL_CMD" | sed 's/-d/\\\n    -d/g'
    echo ""
    echo "Response:"
    echo "-----------------------------------"
    
    eval "$CURL_CMD"
    echo ""
    echo ""
}

# 1. Health Check
test_endpoint \
    "Health Check" \
    "GET" \
    "/health" \
    "" \
    ""

# 2. Create Order
ORDER_IDEMPOTENCY_KEY="order-$(date +%s)-$(shuf -i 1000-9999 -n 1)"
CREATE_ORDER_BODY=$(cat <<EOF
{
  "orgId": "test-org-123",
  "userId": "test-user-456",
  "idempotencyKey": "$ORDER_IDEMPOTENCY_KEY",
  "meta": {
    "productId": "product-789",
    "productType": "package",
    "amount": 1000
  },
  "platform": "web",
  "transactionType": "paymentgateway"
}
EOF
)

test_endpoint \
    "Create Order" \
    "POST" \
    "/order/create" \
    "$CREATE_ORDER_BODY" \
    "-H \"Idempotency-Key: $ORDER_IDEMPOTENCY_KEY\""

# 3. Get Order Review (POST)
GET_ORDER_BODY=$(cat <<EOF
{
  "orderId": "test-order-123",
  "orgId": "test-org-123"
}
EOF
)

test_endpoint \
    "Get Order Review (POST)" \
    "POST" \
    "/order/review" \
    "$GET_ORDER_BODY" \
    ""

# 4. Get Order By ID (GET)
test_endpoint \
    "Get Order By ID" \
    "GET" \
    "/order/test-order-123?orgId=test-org-123" \
    "" \
    ""

# 5. List Orders
test_endpoint \
    "List Orders" \
    "GET" \
    "/orders?limit=10" \
    "" \
    "-H \"Authorization: Bearer dummy-token\""

# 6. Request Payment
test_endpoint \
    "Request Payment" \
    "POST" \
    "/order/test-order-123/payments?orgId=test-org-123" \
    "" \
    ""

# 7. Payment Events
PAYMENT_EVENT_BODY=$(cat <<EOF
{
  "type": "PaymentSucceeded",
  "orderId": "test-order-123",
  "orgId": "test-org-123",
  "paymentId": "pay_test_123",
  "reason": "Payment completed successfully"
}
EOF
)

test_endpoint \
    "Payment Events (Webhook)" \
    "POST" \
    "/internal/payments/events" \
    "$PAYMENT_EVENT_BODY" \
    ""

# 8. Cancel Order
CANCEL_ORDER_BODY=$(cat <<EOF
{
  "orderId": "test-order-123",
  "orgId": "test-org-123"
}
EOF
)

test_endpoint \
    "Cancel Order" \
    "POST" \
    "/order/cancel" \
    "$CANCEL_ORDER_BODY" \
    ""

# 9. Refund Payment
REFUND_BODY=$(cat <<EOF
{
  "orderId": "test-order-123",
  "paymentId": "pay_test_456",
  "entityId": "entity_test_789",
  "orgId": "test-org-123",
  "amount": 500,
  "userId": "test-user-456",
  "gateway": "razorpay",
  "reason": "Customer requested refund"
}
EOF
)

test_endpoint \
    "Refund Payment" \
    "POST" \
    "/order/refund" \
    "$REFUND_BODY" \
    ""

# 10. Create Pharmacy Order
PHARMACY_IDEMPOTENCY_KEY="pharmacy-$(date +%s)-$(shuf -i 1000-9999 -n 1)"
PHARMACY_ORDER_BODY=$(cat <<EOF
{
  "orgId": "test-org-123",
  "userId": "test-user-456",
  "idempotencyKey": "$PHARMACY_IDEMPOTENCY_KEY",
  "meta": {
    "productId": "medication-123",
    "productType": "package",
    "amount": 2500
  },
  "platform": "mobile",
  "transactionType": "cash"
}
EOF
)

test_endpoint \
    "Create Pharmacy Order" \
    "POST" \
    "/pharmacy/order" \
    "$PHARMACY_ORDER_BODY" \
    "-H \"Idempotency-Key: $PHARMACY_IDEMPOTENCY_KEY\""

# 11. Mark Paid
MARK_PAID_BODY=$(cat <<EOF
{
  "orderId": "test-order-123",
  "orgId": "test-org-123"
}
EOF
)

test_endpoint \
    "Mark Paid (Complete Order)" \
    "POST" \
    "/order/complete" \
    "$MARK_PAID_BODY" \
    ""

# 12. Generate Invoice
INVOICE_BODY=$(cat <<EOF
{
  "orderId": "test-order-123",
  "orgId": "test-org-123"
}
EOF
)

test_endpoint \
    "Generate Invoice" \
    "POST" \
    "/order/invoice" \
    "$INVOICE_BODY" \
    ""

# 13. Get Payment Status
test_endpoint \
    "Get Payment Status" \
    "GET" \
    "/order/payments/pay_test_789/status?userId=test-user-456&entityId=entity_test_123" \
    "" \
    ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}All endpoint tests completed${NC}"
echo -e "${GREEN}========================================${NC}"

