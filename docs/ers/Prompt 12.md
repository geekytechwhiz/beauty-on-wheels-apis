Integrate AWS Lambda Powertools Tracer.

Requirements:
- Add tracing middleware
- Capture:
  - handler execution
  - downstream calls
- Attach correlationId

Ensure:
- No manual tracing in handlers