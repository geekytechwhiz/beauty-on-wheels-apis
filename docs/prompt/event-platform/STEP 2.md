Objective: Implement idempotency module inside core/idempotency/

Before coding:
- Identify if DynamoDB utilities already exist
- Check how other modules interact with AWS services
- Follow existing repository patterns

Implement:

1. Interface:
IdempotencyStore with:
- exists(key: string): Promise<boolean>
- save(key: string): Promise<void>

2. Create abstraction ONLY (no hard AWS dependency yet)

3. Add optional TTL support in design

4. Add helper:
- generateIdempotencyKey(payload)

Rules:
- Must reuse existing hashing utility
- No direct AWS SDK usage yet (only interface + optional mock/in-memory)

Tests:
- duplicate detection
- key consistency

DO NOT:
- integrate with consumer yet
- implement DynamoDB logic yet