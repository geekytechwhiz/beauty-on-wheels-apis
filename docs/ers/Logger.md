You are a senior backend architect.

Generate a production-grade, enterprise-level logging library using TypeScript for a Node.js serverless environment (AWS Lambda), aligned with AWS Lambda Powertools.

The library must be designed as a reusable observability module under:

/libs/observability/logger

Follow a clean modular structure:

- logger.ts
- context.ts
- utils.ts
- index.ts

----------------------------------------
CORE REQUIREMENTS
----------------------------------------

1. Use @aws-lambda-powertools/logger as the core logging engine.

2. Maintain backward compatibility with the following public API:
   - createLogger(options?)
   - createChildLogger(baseLogger, context)
   - logger (default instance)
   - logger.info(), logger.error(), logger.warn(), logger.debug()

   DO NOT change method signatures.

3. Implement async-safe context propagation using AsyncLocalStorage.
   - Store correlationId, awsRequestId, userId, tenantId, and allow extensibility.
   - Provide a helper:
     withLoggerContext(context, fn)

4. Logger must automatically enrich logs with:
   - Async context (from AsyncLocalStorage)
   - Structured log fields
   - Serialized errors

5. Implement structured JSON logging optimized for CloudWatch Logs Insights:
   - Include fields like:
     event: any, message, correlationId, awsRequestId, http, duration, etc.

----------------------------------------
FILE STRUCTURE DETAILS
----------------------------------------

1. context.ts
   - Manage AsyncLocalStorage
   - Export:
     - withLoggerContext()
     - getLoggerContext()
   - Must be fully isolated (no Powertools dependency)

2. utils.ts
   - Implement:
     - serializeError(error)
     - redactPII(data)
       - redact keys: password, email, phone, token, authorization
     - extractCorrelationId(event)
     - extractAwsRequestId(context)
     - logHttpRequest(logger, data)
     - createPerformanceTimer(logger, operation)
   - Ensure utilities are reusable and pure

3. logger.ts
   - Wrap Powertools Logger
   - Implement Logger class with:
     - info()
     - warn()
     - error()
     - debug()
   - Automatically:
     - Merge async context
     - Serialize errors
     - Apply PII redaction (based on options)
   - Use singleton Powertools logger instance
   - Support LoggerOptions:
     - redactPII?: boolean
     - serviceName?: string
     - logLevel?: string

4. index.ts
   - Export all public APIs cleanly

----------------------------------------
ADVANCED ENTERPRISE FEATURES
----------------------------------------

Include the following:

1. Cold start detection (add coldStart flag automatically once per container)

2. Support persistent attributes:
   - correlationId should be injected automatically if present

3. Safe error handling:
   - Always log error stack
   - Avoid circular JSON issues

4. Extensibility:
   - Allow adding custom fields without modifying core logger
   - Design for future support:
     - tracing (Powertools Tracer)
     - metrics (Powertools Metrics)

5. Performance optimized:
   - Avoid unnecessary object cloning
   - Minimal overhead in hot paths

----------------------------------------
CODING STANDARDS
----------------------------------------

- Use strict TypeScript types
- Avoid any unless absolutely necessary
- Write clean, readable, modular code
- Add meaningful comments for maintainability
- No console.log anywhere
- No external dependencies except AWS Powertools

----------------------------------------
OUTPUT FORMAT
----------------------------------------

Generate FULL code for all 4 files:

1. context.ts
2. utils.ts
3. logger.ts
4. index.ts

Ensure the code is:
- Complete
- Ready to use
- Production-grade
- Consistent across files

----------------------------------------
IMPORTANT CONSTRAINT
----------------------------------------

Do NOT include middleware logic (no middleware engine, no idempotency, no execution pipeline).

This library must remain a pure observability/logging module.

----------------------------------------

Now generate the full implementation.