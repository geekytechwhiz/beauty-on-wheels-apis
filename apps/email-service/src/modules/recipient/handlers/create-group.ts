import { withApiHandler } from '@api-hub/middleware';
import { LambdaRequest } from '@api-hub/utils';
import { createGroupSchema, CreateGroupInput } from '../dto/schemas.js';
import { getRecipientRepository, getStorageProvider } from '../../../common/providers/container.js';
import { RecipientService } from '../services/RecipientService.js';

const recipientService = new RecipientService(getRecipientRepository(), getStorageProvider());

const handler = async (req: LambdaRequest) => {
  const body = req.body as CreateGroupInput;
  const result = await recipientService.createGroup(body);

  return {
    message: 'Recipients table created successfully',
    tableName: result.groupId, // Maintains compatibility with existing code expectation
    processedCount: result.processedCount,
    totalProvided: body.recipients.length,
  };
};

export const main = withApiHandler({
  operation: 'recipient.createGroup',
  bodySchema: createGroupSchema,
}, handler);

export default main;
