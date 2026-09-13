import { withApiHandler } from '@api-hub/middleware';
import { getRecipientRepository, getStorageProvider } from '../../../common/providers/container.js';
import { RecipientService } from '../services/RecipientService.js';

const recipientService = new RecipientService(getRecipientRepository(), getStorageProvider());

const handler = async () => {
  const groups = await recipientService.listGroups();

  const files = groups.map(g => ({
    name: g.groupId,
    originalFilename: g.originalFilename,
    createdAt: g.createdAt,
    source: g.source,
  }));

  return { files };
};

export const main = withApiHandler({ operation: 'recipient.listGroups' }, handler);

export default main;
