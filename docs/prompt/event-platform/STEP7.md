Objective: Implement adapter in adapters/eventbridge/

Requirements:

- publish(event)
- map to EventBridge PutEvents format

- Support:
  - event bus name
  - detail-type
  - source

Reuse:
- AWS config patterns from repo

Tests:
- event transformation correctness

DO NOT:
- add business logic