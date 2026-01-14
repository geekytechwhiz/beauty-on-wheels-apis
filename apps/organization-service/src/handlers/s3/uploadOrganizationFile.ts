import { EventBridgeHandler } from 'aws-lambda';
import { OrganizationService } from '../../services/organization.service';
import { createLogger, serializeError, createChildLogger } from '@api-hub/logger';
import { randomUUID } from 'crypto';
import { eventBridgeEventSchema } from '../../validation/event.validation';

const baseLogger = createLogger({ service: 'organization-service', redactPII: true });
const organizationService = new OrganizationService();

export const main: EventBridgeHandler<'Object Created', unknown, void> = async (event) => {
  const logger = createChildLogger(baseLogger, { eventId: event.id });
  logger.info({ event: 'uploadOrganizationFile_received', eventData: event });

  try {
    const validationResult = eventBridgeEventSchema.safeParse(event);
    if (!validationResult.success) {
      logger.error({ event: 'uploadOrganizationFile_validation_error', errors: validationResult.error.errors });
      return;
    }

    const detail = event.detail as { bucket?: { name?: string }; object?: { key?: string } };
    const bucketName = detail?.bucket?.name;
    const objectKey = detail?.object?.key;

    if (!bucketName || !objectKey) {
      logger.error({ event: 'uploadOrganizationFile_missing_data', bucketName, objectKey });
      return;
    }

    // Extract organizationId from S3 key path: organizations/{orgId}/files/{filename}
    const keyParts = objectKey.split('/');
    if (keyParts.length < 3 || keyParts[0] !== 'organizations') {
      logger.error({ event: 'uploadOrganizationFile_invalid_key_format', objectKey });
      return;
    }

    const organizationId = keyParts[1];
    const fileName = keyParts.slice(2).join('/');
    const fileId = randomUUID();

    await organizationService.createOrganizationFile(organizationId, fileId, fileName, objectKey);

    logger.info({ event: 'uploadOrganizationFile_success', organizationId, fileId, fileName });
  } catch (err) {
    logger.error({ event: 'uploadOrganizationFile_error', err: serializeError(err) });
    // Don't throw - allow EventBridge to retry if needed
  }
};
