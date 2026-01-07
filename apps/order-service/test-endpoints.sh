#!/bin/bash

# Order Service API Endpoint Testing Script
# Base URL: https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev

BASE_URL="https://xlf9kcdd64.execute-api.us-east-1.amazonaws.com/dev"
CORRELATION_ID="test-$(date +%s)"

echo "=========================================="
echo "Order Service API Endpoint Testing"
echo "Base URL: $BASE_URL"
echo "Correlation ID: $CORRELATION_ID"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

# Helper function to print test results
test_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓ PASSED${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAILED${NC}"
        ((FAILED++))
    fi
    echo ""
}

# 1. Health Check
echo "1. Testing Health Check (GET /health)"
echo "-----------------------------------"
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
    -H "Content-Type: application/json" \
    -H "X-Correlation-Id: $CORRELATION_ID" \
    "$BASE_URL/health")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "HTTP Code: $HTTP_CODE"
echo "Response: $BODY"
if [ "$HTTP_CODE" -eq 200 ]; then
    test_result 0
else
    test_result 1
fi

# 2. Create Order
echo "2. Testing Create Order (POST /order/create)"
echo "-----------------------------------"
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
echo "Request Body: $CREATE_ORDER_BODY"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -H "X-Correlation-Id: $CORRELATION_ID" \
    -H "Idempotency-Key: $ORDER_IDEMPOTENCY_KEY" \
    -d "$CREATE_ORDER_BODY" \
    "$BASE_URL/order/create")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "HTTP Code: $HTTP_CODE"
echo "Response: $BODY"
# Extract orderId from response for subsequent tests
CREATED_ORDER_ID=$(echo "$BODY" | grep -o '"orderId":"[^"]*' | cut -d'"' -f4)
if [ "$HTTP_CODE" -eq 201 ] || [ "$HTTP_CODE" -eq 202 ]; then
    test_result 0
    echo "Created Order ID: $CREATED_ORDER_ID"
else
    test_result 1
fi
echo ""

# 3. Get Order (Review) - POST
echo "3. Testing Get Order Review (POST /order/review)"
echo "-----------------------------------"
if [ -n "$CREATED_ORDER_ID" ]; then
    GET_ORDER_BODY=$(cat <<EOF
{
  "orderId": "$CREATED_ORDER_ID",
  "orgId": "test-org-123"
}
EOF
)
    echo "Request Body: $GET_ORDER_BODY"
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -H "X-Correlation-Id: $CORRELATION_ID" \
        -d "$GET_ORDER_BODY" \
        "$BASE_URL/order/review")
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    echo "HTTP Code: $HTTP_CODE"
    echo "Response: $BODY"
    if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 404 ]; then
        test_result 0
    else
        test_result 1
    fi
else
    echo -e "${YELLOW}⚠ SKIPPED (No order ID from previous test)${NC}"
    test_result 1
fi
echo ""

# 4. Get Order By ID - GET
echo "4. Testing Get Order By ID (GET /order/{orderId})"
echo "-----------------------------------"
if [ -n "$CREATED_ORDER_ID" ]; then
    RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
        -H "Content-Type: application/json" \
        -H "X-Correlation-Id: $CORRELATION_ID" \
        "$BASE_URL/order/$CREATED_ORDER_ID?orgId=test-org-123")
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    echo "HTTP Code: $HTTP_CODE"
    echo "Response: $BODY"
    if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 404 ]; then
        test_result 0
    else
        test_result 1
    fi
else
    echo -e "${YELLOW}⚠ SKIPPED (No order ID from previous test)${NC}"
    test_result 1
fi
echo ""

# 5. List Orders - GET
echo "5. Testing List Orders (GET /orders)"
echo "-----------------------------------"
echo -e "${YELLOW}⚠ Note: This endpoint requires Authorization header with JWT token${NC}"
echo "Testing without auth (expected to fail or return empty)..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
    -H "Content-Type: application/json" \
    -H "X-Correlation-Id: $CORRELATION_ID" \
    -H "Authorization: Bearer dummy-token" \
    "$BASE_URL/orders?limit=10")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "HTTP Code: $HTTP_CODE"
echo "Response: $BODY"
# Accept 200, 400, or 401 as valid responses
if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 400 ] || [ "$HTTP_CODE" -eq 401 ]; then
    test_result 0
else
    test_result 1
fi
echo ""

# 6. Request Payment
echo "6. Testing Request Payment (POST /order/{orderId}/payments)"
echo "-----------------------------------"
if [ -n "$CREATED_ORDER_ID" ]; then
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -H "X-Correlation-Id: $CORRELATION_ID" \
        "$BASE_URL/order/$CREATED_ORDER_ID/payments?orgId=test-org-123")
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    echo "HTTP Code: $HTTP_CODE"
    echo "Response: $BODY"
    # Extract paymentId if available
    PAYMENT_ID=$(echo "$BODY" | grep -o '"orderId":"[^"]*' | cut -d'"' -f4 | head -n1)
    if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 400 ] || [ "$HTTP_CODE" -eq 404 ]; then
        test_result 0
    else
        test_result 1
    fi
else
    echo -e "${YELLOW}⚠ SKIPPED (No order ID from previous test)${NC}"
    test_result 1
fi
echo ""

# 7. Payment Events (Webhook)
echo "7. Testing Payment Events (POST /internal/payments/events)"
echo "-----------------------------------"
PAYMENT_EVENT_BODY=$(cat <<EOF
{
  "type": "PaymentSucceeded",
  "orderId": "${CREATED_ORDER_ID:-test-order-123}",
  "orgId": "test-org-123",
  "paymentId": "pay_test_123",
  "reason": "Payment completed successfully"
}
EOF
)
echo "Request Body: $PAYMENT_EVENT_BODY"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -H "X-Correlation-Id: $CORRELATION_ID" \
    -d "$PAYMENT_EVENT_BODY" \
    "$BASE_URL/internal/payments/events")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "HTTP Code: $HTTP_CODE"
echo "Response: $BODY"
if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 400 ] || [ "$HTTP_CODE" -eq 404 ]; then
    test_result 0
else
    test_result 1
fi
echo ""

# 8. Cancel Order
echo "8. Testing Cancel Order (POST /order/cancel)"
echo "-----------------------------------"
if [ -n "$CREATED_ORDER_ID" ]; then
    CANCEL_ORDER_BODY=$(cat <<EOF
{
  "orderId": "$CREATED_ORDER_ID",
  "orgId": "test-org-123"
}
EOF
)
    echo "Request Body: $CANCEL_ORDER_BODY"
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -H "X-Correlation-Id: $CORRELATION_ID" \
        -d "$CANCEL_ORDER_BODY" \
        "$BASE_URL/order/cancel")
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    echo "HTTP Code: $HTTP_CODE"
    echo "Response: $BODY"
    if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 400 ] || [ "$HTTP_CODE" -eq 404 ]; then
        test_result 0
    else
        test_result 1
    fi
else
    echo -e "${YELLOW}⚠ SKIPPED (No order ID from previous test)${NC}"
    test_result 1
fi
echo ""

# 9. Refund Payment
echo "9. Testing Refund Payment (POST /order/refund)"
echo "-----------------------------------"
REFUND_BODY=$(cat <<EOF
{
  "orderId": "${CREATED_ORDER_ID:-test-order-123}",
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
echo "Request Body: $REFUND_BODY"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -H "X-Correlation-Id: $CORRELATION_ID" \
    -d "$REFUND_BODY" \
    "$BASE_URL/order/refund")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "HTTP Code: $HTTP_CODE"
echo "Response: $BODY"
if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 400 ] || [ "$HTTP_CODE" -eq 404 ]; then
    test_result 0
else
    test_result 1
fi
echo ""

# 10. Create Pharmacy Order
echo "10. Testing Create Pharmacy Order (POST /pharmacy/order)"
echo "-----------------------------------"
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
echo "Request Body: $PHARMACY_ORDER_BODY"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -H "X-Correlation-Id: $CORRELATION_ID" \
    -H "Idempotency-Key: $PHARMACY_IDEMPOTENCY_KEY" \
    -d "$PHARMACY_ORDER_BODY" \
    "$BASE_URL/pharmacy/order")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "HTTP Code: $HTTP_CODE"
echo "Response: $BODY"
PHARMACY_ORDER_ID=$(echo "$BODY" | grep -o '"orderId":"[^"]*' | cut -d'"' -f4)
if [ "$HTTP_CODE" -eq 201 ] || [ "$HTTP_CODE" -eq 202 ]; then
    test_result 0
    echo "Created Pharmacy Order ID: $PHARMACY_ORDER_ID"
else
    test_result 1
fi
echo ""

# 11. Mark Paid (Complete Order)
echo "11. Testing Mark Paid (POST /order/complete)"
echo "-----------------------------------"
if [ -n "$PHARMACY_ORDER_ID" ]; then
    MARK_PAID_BODY=$(cat <<EOF
{
  "orderId": "$PHARMACY_ORDER_ID",
  "orgId": "test-org-123"
}
EOF
)
    echo "Request Body: $MARK_PAID_BODY"
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -H "X-Correlation-Id: $CORRELATION_ID" \
        -d "$MARK_PAID_BODY" \
        "$BASE_URL/order/complete")
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    echo "HTTP Code: $HTTP_CODE"
    echo "Response: $BODY"
    if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 400 ] || [ "$HTTP_CODE" -eq 404 ]; then
        test_result 0
    else
        test_result 1
    fi
else
    echo -e "${YELLOW}⚠ SKIPPED (No pharmacy order ID from previous test)${NC}"
    test_result 1
fi
echo ""

# 12. Generate Invoice
echo "12. Testing Generate Invoice (POST /order/invoice)"
echo "-----------------------------------"
if [ -n "$CREATED_ORDER_ID" ]; then
    INVOICE_BODY=$(cat <<EOF
{
  "orderId": "$CREATED_ORDER_ID",
  "orgId": "test-org-123"
}
EOF
)
    echo "Request Body: $INVOICE_BODY"
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
        -H "Content-Type: application/json" \
        -H "X-Correlation-Id: $CORRELATION_ID" \
        -d "$INVOICE_BODY" \
        "$BASE_URL/order/invoice")
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    echo "HTTP Code: $HTTP_CODE"
    echo "Response: $BODY"
    if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 400 ] || [ "$HTTP_CODE" -eq 404 ]; then
        test_result 0
    else
        test_result 1
    fi
else
    echo -e "${YELLOW}⚠ SKIPPED (No order ID from previous test)${NC}"
    test_result 1
fi
echo ""

# 13. Get Payment Status
echo "13. Testing Get Payment Status (GET /order/payments/{paymentId}/status)"
echo "-----------------------------------"
TEST_PAYMENT_ID="pay_test_789"
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
    -H "Content-Type: application/json" \
    -H "X-Correlation-Id: $CORRELATION_ID" \
    "$BASE_URL/order/payments/$TEST_PAYMENT_ID/status?userId=test-user-456&entityId=entity_test_123")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "HTTP Code: $HTTP_CODE"
echo "Response: $BODY"
if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 400 ] || [ "$HTTP_CODE" -eq 404 ]; then
    test_result 0
else
    test_result 1
fi
echo ""

# Summary
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo "Total: $((PASSED + FAILED))"
echo "=========================================="

if [ $FAILED -eq 0 ]; then
    exit 0
else
    exit 1
fi


