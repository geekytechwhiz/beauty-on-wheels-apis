import { withLambdaHandler } from '@api-hub/middleware';
import { type LambdaRequest } from '@api-hub/utils';
import { OrganizationService } from '../services/organization.service';
import { RootOrgMetadataRepository } from '../repositories/rootOrgMetadata.repository';
import { updateOrganizationSchema } from '../validation/organization.validation';
import { normalizeOrganizationPayload } from '../utils/organizationPayload';
import { validateOrganizationIdParam } from '../validation/request.validators';

const organizationService = new OrganizationService();
const rootOrgMetadataRepository = new RootOrgMetadataRepository();

const tryParseSupportedVitals = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const normalizeSupportedVitals = (
  supportedVitals: string[],
  supportedAttributes: unknown,
): Array<Record<string, unknown>> => {
  if (!Array.isArray(supportedAttributes)) return [];
  return supportedAttributes
    .filter((item) => {
      if (!item || typeof item !== 'object') return false;
      const key = Object.keys(item as Record<string, unknown>)[0];
      return key ? supportedVitals.includes(key) : false;
    })
    .map((item) => {
      const key = Object.keys(item as Record<string, unknown>)[0];
      if (!key) return item as Record<string, unknown>;
      const details = (item as Record<string, unknown>)[key];
      if (!details || typeof details !== 'object') return { [key]: details };
      const { label, ...filtered } = details as Record<string, unknown>;
      return { [key]: filtered };
    });
};

interface Params {
  organizationId: string;
}

const handler = async (req: LambdaRequest<Params>) => {
  const { organizationId } = req.params;
  const body = req.body ?? {};
  const { correlationId } = req.context;
  const requestAuthorizer = req.event?.requestContext?.authorizer as Record<string, unknown> | undefined;
  const userType = typeof requestAuthorizer?.userType === 'string' ? requestAuthorizer.userType : undefined;

  const normalized = normalizeOrganizationPayload(body);
  const hasAdminDetails = body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body as Record<string, unknown>, 'adminDetails');
  const adminDetails = normalized.data.adminDetails;
  if (!hasAdminDetails) {
    normalized.data.adminDetails = undefined;
  } else if (adminDetails === undefined || adminDetails === null) {
    normalized.data.adminDetails = [];
  } else if (!Array.isArray(adminDetails) && typeof adminDetails === 'object') {
    normalized.data.adminDetails = [adminDetails];
  }
  if (normalized.data.organizationInfo && typeof normalized.data.organizationInfo === 'object') {
    normalized.data.organizationInfo = {
      ...(normalized.data.organizationInfo as Record<string, unknown>),
      organizationID: organizationId,
    };
  }

  const supportedVitalsInput = tryParseSupportedVitals(normalized.data.supportedVitals);
  normalized.data.supportedVitals = supportedVitalsInput as typeof normalized.data.supportedVitals;
  if (
    Array.isArray(supportedVitalsInput) &&
    supportedVitalsInput.length > 0 &&
    supportedVitalsInput.every((item) => typeof item === 'string')
  ) {
    const supportedAttributes = await rootOrgMetadataRepository.getOrgSupportedVitals().catch(() => []);
    const matchedVitals = normalizeSupportedVitals(supportedVitalsInput as string[], supportedAttributes);
    normalized.data.supportedVitals = matchedVitals.length > 0 ? matchedVitals : undefined;
  }

  if (normalized.errors.length > 0) {
    const err: any = new Error('Validation failed');
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    err.details = normalized.errors.map((e) => ({ field: (e as any).field, message: (e as any).message ?? 'Invalid request body' }));
    throw err;
  }

  const validationResult = updateOrganizationSchema.safeParse(normalized.data);
  if (!validationResult.success) {
    const err: any = new Error(validationResult.error.issues[0]?.message ?? 'Validation failed');
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    err.details = validationResult.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message }));
    throw err;
  }

  return organizationService.updateOrganization(organizationId, validationResult.data, correlationId, userType);
};

export const main = withLambdaHandler(handler, {
  validator: validateOrganizationIdParam,
});
