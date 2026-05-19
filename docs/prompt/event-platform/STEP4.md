Objective: Implement SQS adapter in adapters/sqs/

Before coding:
- Identify existing AWS SDK usage patterns
- Reuse any SQS utilities if available

Implement:

- publish(event)
- receive/subscribe(handler)

Requirements:
- Accept BaseEvent
- Serialize safely
- No business logic here

- Config driven:
  - queueUrl
  - region

- Must support DLQ config awareness (but not enforce yet)

Tests:
- message send format
- message parsing

DO NOT:
- implement retry/idempotency here