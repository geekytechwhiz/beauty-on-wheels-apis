Refactor the middleware engine to be fully generic, type-safe, and reusable.

Requirements:
- Use a standard middleware signature:
  async ({ event, context, next }) => Promise<TResult>
- Support chaining using next()
- Add lifecycle hooks:
  - onBefore
  - onAfter
  - onError
- Ensure no dependency on logger, AWS, or domain logic
- Make it reusable across all services

Output:
- middlewareEngine.ts
- types.ts

Ensure:
- Strong TypeScript typing
- No breaking changes to existing handler usage