

import noCrossServiceImport from './rules/architecture/no-cross-service-import'; 

import recommended from './configs/recommended';
import enforceEventName from './rules/event/enforce-event-name';
import enforceEventPublish from './rules/event/enforce-event-publish';
import requireIdempotencyKey from './rules/event/require-idempotency-key';

export const rules = {
  'event-name': enforceEventName,
  'event-publish': enforceEventPublish,
  'require-idempotency-key': requireIdempotencyKey,
  'no-cross-service-import': noCrossServiceImport,
//   'no-deep-relative-import': noDeepRelativeImport,
};

export const configs = {
  recommended,
};

export default {
  rules,
  configs,
};