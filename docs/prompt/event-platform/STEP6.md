Objective: Add DLQ awareness in core/dlq/

Implement:

- DLQ config model
- helper to decide:
  - retry vs DLQ

- integrate with consumer wrapper:
  - after max retries → mark as DLQ candidate

NOTE:
Actual DLQ routing handled by SQS/EventBridge

Focus:
- decision logic only

Tests:
- failure after retries → DLQ trigger