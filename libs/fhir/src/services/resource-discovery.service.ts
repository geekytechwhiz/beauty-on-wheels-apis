import { ResourceConfig } from '../types/resource.types';
import { resourceRegistry } from '../registry/resource-registry';
import { resolvePayloadResourceTypes } from '../utils/data-shape';

export class ResourceDiscoveryService {
  discover(data: unknown, handlerResourceTypes?: string[]): ResourceConfig[] {
    const resources = resourceRegistry.getAll();

    /**
     * Priority 1
     * Explicit handler resource types
     */

    if (handlerResourceTypes?.length) {
      return resources.filter((resource) =>
        handlerResourceTypes.includes(resource.resource),
      );
    }

    /**
     * Priority 2
     * Payload-declared resource type
     */

    const payloadTypes = resolvePayloadResourceTypes(data);

    if (payloadTypes.length) {
      return resources.filter((resource) =>
        payloadTypes.includes(resource.resource),
      );
    }

    /**
     * Priority 3
     * Detection rules
     */

    return resources.filter((resource) => {
      const detection = resource.detection;

      if (!detection?.enabled) {
        return false;
      }

      const fields = detection.fields;

      if (!fields.length) {
        return false;
      }

      const matches = fields.filter((field:string) => hasValue(data, field));

      return detection.strategy === 'ALL'
        ? matches.length === fields.length
        : matches.length > 0;
    });
  }
}

function hasValue(data: any, field: string) {
  return Boolean(data?.[field]);
}
