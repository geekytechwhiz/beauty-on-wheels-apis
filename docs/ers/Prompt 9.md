Refactor event handling to enforce a single Event Envelope format.

Standard:

{
  eventId,
  eventType,
  version,
  timestamp,
  source,
  correlationId,
  payload
}

Tasks:
- Replace local EventEnvelope definitions in services
- Use shared model from core/event-envelope
- Ensure all publishers and consumers use same structure