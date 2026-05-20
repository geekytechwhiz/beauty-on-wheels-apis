# Logger Library

A production-ready Winston-based logging library for serverless applications with AWS Lambda support.

## Features

- ✅ Environment-based configuration (development vs production)
- ✅ JSON formatting for production (CloudWatch/log aggregation friendly)
- ✅ Pretty formatting for development
- ✅ Structured logging with context support
- ✅ Request ID and correlation ID tracking
- ✅ Error handling with stack traces
- ✅ AWS Lambda context extraction
- ✅ TypeScript support
- ✅ Child logger support for request-scoped logging

## Installation

The logger is already configured in the workspace. Winston is included as a dependency.

## Usage

### Basic Usage

```typescript
import { logger } from '@api-hub/logger';

// Simple logging
logger.info('User created successfully');
logger.error('Failed to process request', error);
logger.warn('Rate limit approaching');
logger.debug('Debug information');
```

### Logging with Context

```typescript
import { createLoggerWithContext } from '@api-hub/logger';

const contextLogger = createLoggerWithContext({
  requestId: 'req-123',
  userId: 'user-456',
  organizationId: 'org-789',
});

contextLogger.info('Processing user request');
// Output includes: requestId, userId, organizationId in all logs
```

### AWS Lambda Integration

```typescript
import { extractLambdaContext, createLoggerWithContext } from '@api-hub/logger';

export const handler = async (event: APIGatewayProxyEvent) => {
  // Extract context from Lambda event
  const context = extractLambdaContext(event);
  const logger = createLoggerWithContext({
    ...context,
    functionName: 'user-service-handler',
  });

  logger.info('Lambda function invoked', {
    httpMethod: event.httpMethod,
    path: event.path,
  });

  try {
    // Your handler logic
    logger.info('Processing request');
  } catch (error) {
    logger.error('Handler error', error, {
      statusCode: 500,
    });
    throw error;
  }
};
```

### Child Loggers (Request Scoped)

```typescript
import { logger } from '@api-hub/logger';

// Create a child logger for a specific request
const requestLogger = logger.child({
  requestId: 'req-123',
  userId: 'user-456',
});

requestLogger.info('Request started');
requestLogger.info('Processing step 1');
requestLogger.info('Request completed');
// All logs include requestId and userId
```

### Error Logging

```typescript
import { logger } from '@api-hub/logger';

try {
  // Some operation
} catch (error) {
  // Error with stack trace
  logger.error('Operation failed', error, {
    operation: 'createUser',
    userId: 'user-123',
  });
}

// Or with custom error object
logger.error('Custom error', new Error('Something went wrong'), {
  additionalContext: 'value',
});
```

### Log Levels

```typescript
import { logger, LogLevel } from '@api-hub/logger';

logger.error('Error message');
logger.warn('Warning message');
logger.info('Info message');
logger.http('HTTP request/response');
logger.verbose('Verbose message');
logger.debug('Debug message');
logger.silly('Silly message');

// Custom level
logger.log(LogLevel.INFO, 'Custom log');
```

## Configuration

### Environment Variables

- `NODE_ENV`: Set to `production` for JSON formatting, `development` for pretty formatting
- `LOG_LEVEL`: Override default log level (error, warn, info, http, verbose, debug, silly)

### Default Behavior

- **Development**: Pretty formatted, colored output, DEBUG level
- **Production**: JSON formatted, INFO level
- **Test**: Silent (logs are suppressed)

## Production Considerations

1. **CloudWatch Integration**: Logs are formatted as JSON in production, making them easy to parse in CloudWatch Logs Insights
2. **Request Tracing**: Use `extractLambdaContext` to automatically extract request IDs and correlation IDs
3. **Error Tracking**: Errors are logged with full stack traces and context
4. **Performance**: Logger is a singleton, minimizing overhead
5. **Structured Logging**: All logs include timestamps and context for better observability

## Example: Complete Lambda Handler

```typescript
import { APIGatewayProxyevent: any, APIGatewayProxyResult } from 'aws-lambda';
import { extractLambdaContext, createLoggerWithContext } from '@api-hub/logger';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const context = extractLambdaContext(event);
  const logger = createLoggerWithContext({
    ...context,
    functionName: 'createUser',
  });

  logger.http('Request received', {
    method: event.httpMethod,
    path: event.path,
    queryParams: event.queryStringParameters,
  });

  try {
    const body = JSON.parse(event.body || '{}');
    
    logger.info('Creating user', { email: body.email });

    // Your business logic here
    const user = await createUser(body);

    logger.info('User created successfully', { userId: user.id });

    return {
      statusCode: 201,
      body: JSON.stringify(user),
    };
  } catch (error) {
    logger.error('Failed to create user', error, {
      statusCode: 500,
    });

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
```

## Building

Run `nx build logger` to build the library.
