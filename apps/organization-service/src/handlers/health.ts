import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { RootOrgMetadataRepository } from '../repositories/rootOrgMetadata.repository';
import { setupScript } from '../utils/mitadata/setup-script/script';

const defaultOrgVitals = require('../utils/mitadata/data/organization/org-vitals.json') as { attributes?: unknown[] };
const ORGANIZATION_TABLE = process.env.ORGANIZATION_TABLE;
 

const handler = async (_req: LambdaRequest) => {
  const attributes =
    defaultOrgVitals?.attributes && Array.isArray(defaultOrgVitals.attributes) ? defaultOrgVitals.attributes : [];

  if (ORGANIZATION_TABLE && attributes.length > 0) {
    setupScript();
    const repo = new RootOrgMetadataRepository();
    await repo.putOrgVitalsMetadata(attributes);
  }

  return { status: 'ok', service: 'organization-service' };
};

export const main = withApiHandler({ operation: 'health' }, handler);
