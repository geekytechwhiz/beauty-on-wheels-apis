Objective: Implement publisher in sdk/publisher/

Implement:

publish({
  eventType,
  version,
  source,
  payload
})

Flow:
1. Build event (envelope)
2. Send via adapter

Requirements:
- adapter injected (SQS/EventBridge)
- no business logic

Tests:
- correct event generation
- adapter called properly