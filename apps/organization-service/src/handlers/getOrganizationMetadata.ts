import { withApiHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { RootOrgMetadataRepository } from '../repositories/rootOrgMetadata.repository';
import { fhirOrganizationMetadataHandlerOptions } from '../utils/fhir-handler-options';
import { validateMetadataTypeParam } from '../validation/request.validators';

const ORG_SIZE_PREFIX = 'ORG_SIZE';
const ORG_SCHEDULE_KEY = 'SCHEDULE';
const DEFAULT_SETTINGS_KEY = 'DEFAULT_SETTINGS';
const ORG_STATUS = ['HOLD', 'ACTIVE', 'DISABLED', 'PENDING'];

interface Params {
  type?: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const typeParam = req.params.type?.toUpperCase();
  const type = typeParam || 'ORGANIZATION';

  const rootOrgMetadataRepository = new RootOrgMetadataRepository();
  const permissionsList = await rootOrgMetadataRepository.getRootOrgPermissionsList(type as 'ROOT' | 'ORGANIZATION');
  const orgMetaItems = await rootOrgMetadataRepository.getOrgTypeSize();

  const orgTypes: Array<{ orgTypeId: string; name: string }> = [];
  const orgSize: Array<Record<string, unknown>> = [];
  let scheduleConf: Record<string, unknown> | undefined;
  let defaultSetting: unknown;

  for (const rawItem of orgMetaItems) {
    const item = rawItem as Record<string, unknown>;
    const sk = typeof item?.sk === 'string' ? item.sk : '';
    if (!sk) continue;

    if (sk.startsWith(ORG_SIZE_PREFIX)) {
      const size = sk.split('#')[1];
      const attributes = item.attributes && typeof item.attributes === 'object' ? { ...item.attributes } : {};
      (attributes as Record<string, unknown>).value = size;
      orgSize.push(attributes as Record<string, unknown>);
      continue;
    }
    if (sk === ORG_SCHEDULE_KEY) {
      scheduleConf = item.attributes as Record<string, unknown>;
      continue;
    }
    if (sk === DEFAULT_SETTINGS_KEY) {
      defaultSetting = item.attributes;
      continue;
    }

    const orgTypeId = sk.split('#')[1];
    const itemName = typeof item.name === 'string' ? item.name : undefined;
    if (orgTypeId && itemName) {
      orgTypes.push({ orgTypeId, name: itemName });
    }
  }

  orgSize.sort((a, b) => {
    const minA = typeof a?.min === 'number' ? (a.min as number) : 0;
    const minB = typeof b?.min === 'number' ? (b.min as number) : 0;
    return minA - minB;
  });

  const supportedVitals = await rootOrgMetadataRepository.getOrgSupportedVitals();
  const supportedRelations = await rootOrgMetadataRepository.getOrgSupportedRelations();
  const supportedSpecialty = await rootOrgMetadataRepository.getOrgSupportedSpecialty();

  return {
    items: Array.isArray(permissionsList) ? permissionsList : [],
    orgTypes,
    orgSize,
    scheduleConf,
    defaultSetting,
    supportedVitals,
    supportedRelations,
    supportedSpecialty,
    orgStatus: ORG_STATUS,
  };
};

export const main = withApiHandler(
  {
    operation: 'getOrganizationMetadata',
    validator: validateMetadataTypeParam,
    fhir: fhirOrganizationMetadataHandlerOptions,
  },
  handler,
);
