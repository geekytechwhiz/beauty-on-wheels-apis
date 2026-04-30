Refactor publisher SDK to align with event architecture.

Requirements:
- Build event envelope centrally
- Inject:
  - correlationId
  - eventId
  - timestamp
- Validate schema before publish
- Log publish event

Remove:
- duplicate publisher implementations (e.g. sns.publisher.ts)

Ensure:
- All services use shared publisher SDK