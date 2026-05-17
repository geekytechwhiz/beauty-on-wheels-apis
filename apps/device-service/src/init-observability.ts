import { configureObservability } from '@api-hub/observability';

configureObservability({
  serviceName: 'device-service',
  redactPII: true,
});
