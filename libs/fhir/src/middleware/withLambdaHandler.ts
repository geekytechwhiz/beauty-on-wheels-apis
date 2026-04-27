import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { buildRequestContext } from './request-context.middleware';

import {
  createLogger,
  extractCorrelationId,
  extractAwsRequestId,
  createChildLogger,
  logHttpRequest,
  createPerformanceTimer
} from '@api-hub/logger';

import { successResponse } from './response.middleware';
import { handleError } from './error.middleware';   
import { FhirTransformationService } from '../services/fhir-transformation.service';
import { buildOperationOutcome } from '../fhir/operationOutcome';
import { validateFhirResponse } from '../fhir/validator';
import { convertFhirToCanonical } from '../fhir/request-to-canonical';
import { decodeJwtPayload } from '@api-hub/utils';
import { validateAccessToken, TokenValidationError } from '@api-hub/auth';
import { isScopeAllowed, type FhirAction } from '@api-hub/scope-mapping';
import { enforceConsent } from '@api-hub/consent';
import { logAccessAudit } from '@api-hub/access-audit';

const baseLogger = createLogger({
  service: 'api-service',
  redactPII: true,
});

const fhirTransformation = new FhirTransformationService();

const FHIR_CONTENT_TYPE = 'application/fhir+json';
const FHIR_RESPONSE_FLAG = 'x-fhir-response';
const FHIR_TRUE_FLAGS = new Set(['1', 'true', 'yes', 'y', 'on', 'fhir']);
const FHIR_FORMAT_HINTS = new Set([
  'fhir',
  'fhir+json',
  'application/fhir+json',
  'json+fhir',
]);

type ValidatedFhirAuthContext = {
  subjectId?: string;
  scopes: string[];
  tenantId?: string;
  clientId?: string;
  purposeOfUse?: string;
  userId?: string;
  patientContextId?: string;
  actorRole?: string;
  actorUserType?: string;
};

const getHeaderValue = (headers: Record<string, string | undefined> | undefined, name: string): string => {
  if (!headers) {
    return '';
  }
  const targetName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === targetName && value != null) {
      return value;
    }
  }
  return '';
};

export const isFhirRequest = (headers?: Record<string, string | undefined>): boolean => {
  const contentType = getHeaderValue(headers, 'content-type').toLowerCase();
  const accept = getHeaderValue(headers, 'accept').toLowerCase();
  const legacyFhirFlag = getHeaderValue(headers, FHIR_RESPONSE_FLAG).toLowerCase();

  return (
    contentType.includes(FHIR_CONTENT_TYPE) ||
    accept.includes(FHIR_CONTENT_TYPE) ||
    FHIR_TRUE_FLAGS.has(legacyFhirFlag)
  );
};

const pathLooksLikeFhir = (path?: string): boolean => {
  if (!path) {
    return false;
  }
  const normalized = path.toLowerCase();
  return normalized.includes('/fhir') || normalized.includes('fhir/');
};

const queryLooksLikeFhir = (query?: Record<string, string | undefined>): boolean => {
  if (!query) {
    return false;
  }
  const formatValue = (query._format ?? query.format ?? '').toLowerCase();
  return FHIR_FORMAT_HINTS.has(formatValue);
};

function getBearerToken(authHeader?: string): string | undefined {
  if (!authHeader || typeof authHeader !== 'string') {
    return undefined;
  }
  const trimmed = authHeader.trim();
  if (trimmed.toLowerCase().startsWith('bearer ')) {
    return trimmed.slice(7).trim();
  }
  return trimmed;
}

function extractScopesFromToken(token?: Record<string, unknown>): string[] {
  if (!token) {
    return [];
  }
  const raw = token.scope ?? token.scp;
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s)).filter(Boolean);
  }
  return String(raw)
    .split(' ')
    .map((s) => s.trim())
    .filter(Boolean);
}

function shouldEnforceScopeChecks(): boolean {
  const raw = (process.env.FHIR_ENFORCE_SCOPES ?? 'true').toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function shouldRequireScopesPresence(): boolean {
  const raw = (process.env.FHIR_REQUIRE_SCOPES ?? 'false').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function resolveFhirAction(method?: string, responseResourceType?: string): FhirAction {
  const normalizedMethod = (method ?? 'GET').toUpperCase();
  if (normalizedMethod === 'POST' || normalizedMethod === 'PUT' || normalizedMethod === 'PATCH' || normalizedMethod === 'DELETE') {
    return 'write';
  }
  if (responseResourceType === 'Bundle') {
    return 'search';
  }
  return 'read';
}

function extractResourceTypeFromRequestBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const resourceType = (body as { resourceType?: unknown }).resourceType;
  return typeof resourceType === 'string' && resourceType.trim() !== '' ? resourceType.trim() : undefined;
}

function extractTenantCandidate(request: any): string | undefined {
  return (
    request.params?.organizationId ??
    request.pathParameters?.organizationId ??
    request.body?.organizationId ??
    request.body?.organizationID ??
    request.query?.organizationId ??
    request.context?.userContext?.organizationId
  );
}

function extractPurposeOfUse(request: any): string {
  return (
    request.headers?.['x-purpose-of-use'] ??
    request.headers?.['X-Purpose-Of-Use'] ??
    request.query?.purposeOfUse ??
    'TREATMENT'
  );
}

function extractPatientIdCandidate(request: any): string | undefined {
  const pathPatientId =
    request.pathParameters?.patientId ??
    request.pathParameters?.id ??
    request.pathParameters?.userId;
  const queryPatientId =
    request.query?.patientId ??
    request.query?.userId ??
    request.params?.patientId ??
    request.params?.userId;
  const bodyPatientId =
    request.body?.patientId ??
    request.body?.id ??
    request.body?.userID ??
    request.body?.userId;
  return pathPatientId ?? queryPatientId ?? bodyPatientId;
}

function extractPatientIdFromReference(reference?: string): string | undefined {
  if (!reference || typeof reference !== 'string') {
    return undefined;
  }
  const trimmed = reference.trim();
  if (trimmed === '') {
    return undefined;
  }
  const parts = trimmed.split('/');
  return parts.length > 1 ? parts[parts.length - 1] : trimmed;
}

function isPatientActor(scopes: string[]): boolean {
  return scopes.some((scope) => scope.toLowerCase().startsWith('patient/'));
}

function isPatientRole(role?: string): boolean {
  if (!role) {
    return false;
  }
  const normalized = role.trim().toUpperCase();
  return normalized === 'PATIENT' || normalized === 'USER_PATIENT';
}

function isProviderOrAdminRole(role?: string): boolean {
  if (!role) {
    return false;
  }
  const normalized = role.trim().toUpperCase();
  return (
    normalized.includes('DOCTOR') ||
    normalized.includes('PRACTITIONER') ||
    normalized.includes('ADMIN')
  );
}

function normalizeRoleLike(value?: string): string | undefined {
  if (!value || typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

interface LambdaHandlerOptions {
  validator?: (request: any) => void | Promise<void>;
  fhir?: {
    /** Fixed FHIR resource type (e.g. when the handler always returns one shape). */
    resourceType?: string;
    /**
     * When true, the handler may set `request.context.fhirResourceType` before returning
     * (for example from `userType` / `roleName` after loading the user).
     */
    resourceTypeFromContext?: boolean;
    /**
     * Derive resource type from each payload (single object or each list row), e.g. Patient vs Practitioner.
     */
    inferResourceType?: (payload: unknown) => string | undefined;
    /**
     * When the handler returns an object with a nested array of users, dot path to that array
     * (e.g. `items`, `data.items`). Top-level arrays do not need this.
     */
    resourceListPath?: string;
  };
  
}

function getAtPath(obj: unknown, path: string): unknown {
  if (path.trim() === '' || obj == null || typeof obj !== 'object') {
    return undefined;
  }
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function resolveFhirResourceType(
  fhirOpts: NonNullable<LambdaHandlerOptions['fhir']>,
  request: { context?: { fhirResourceType?: string } },
  payload: unknown
): string | undefined {
  if (typeof fhirOpts.inferResourceType === 'function') {
    const inferred = fhirOpts.inferResourceType(payload);
    if (typeof inferred === 'string' && inferred.trim() !== '') {
      return inferred.trim();
    }
  }
  if (
    fhirOpts.resourceTypeFromContext &&
    typeof request.context?.fhirResourceType === 'string' &&
    request.context.fhirResourceType.trim() !== ''
  ) {
    return request.context.fhirResourceType.trim();
  }
  if (typeof fhirOpts.resourceType === 'string' && fhirOpts.resourceType.trim() !== '') {
    return fhirOpts.resourceType.trim();
  }
  return undefined;
}

function isDirectFhirResource(payload: unknown): payload is { resourceType: string } {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const candidate = payload as { resourceType?: unknown };
  return typeof candidate.resourceType === 'string' && candidate.resourceType.trim() !== '';
}

function shouldConvertInboundFhir(method?: string): boolean {
  if (!method) {
    return false;
  }
  return ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase());
}

export const withLambdaHandler =
  <TRequest = any, TResult = any>(
    handler: (request: TRequest) => Promise<TResult>,
    options: LambdaHandlerOptions = {}
  ) =>
  async (event: APIGatewayProxyEvent, context: Context) => {


    const correlationId =
      extractCorrelationId(event) || context.awsRequestId;

    const awsRequestId = extractAwsRequestId(context);

    const logger = createChildLogger(baseLogger, {
      correlationId,
      awsRequestId,
    });
    const timer = createPerformanceTimer(logger, 'withLambdaHandler');

    const method = event.httpMethod ?? 'GET';
    const path = event.path ?? 'unknown';

    let statusCode = 200;

    let fhirRequest = false;
    let fhirAuth: ValidatedFhirAuthContext | undefined;
    let fhirResourceTypeForAudit: string | undefined;
    let fhirActionForAudit: FhirAction = 'read';

    try {

      const request: any = buildRequestContext(event);
      fhirRequest =
        isFhirRequest(event.headers as Record<string, string | undefined>) ||
        isFhirRequest(request.headers as Record<string, string | undefined>) ||
        pathLooksLikeFhir(event.path) ||
        pathLooksLikeFhir((request as { path?: string }).path) ||
        queryLooksLikeFhir(event.queryStringParameters as Record<string, string | undefined>) ||
        queryLooksLikeFhir((request as { query?: Record<string, string | undefined> }).query);

      request.context = {
        ...(request.context ?? {}),
        logger,
        correlationId,
        awsRequestId,
      };

      if (fhirRequest) {
        const authHeader =
          request.context?.authHeader ??
          getHeaderValue(event.headers as Record<string, string | undefined>, 'authorization');
        const bearerToken = getBearerToken(authHeader);
        if (!bearerToken) {
          const authErr: any = new Error('Missing Authorization bearer token');
          authErr.statusCode = 401;
          authErr.code = 'UNAUTHENTICATED';
          throw authErr;
        }

        const expectedAudience = process.env.FHIR_EXPECTED_AUDIENCE ?? process.env.COGNITO_APP_CLIENT_ID ?? '';
        const userPoolId = process.env.COGNITO_USER_POOL_ID ?? process.env.USER_POOL_ID;
        const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1';

        const decodedClaims = decodeJwtPayload(`Bearer ${bearerToken}`) as Record<string, unknown>;

        let validated: {
          sub?: string;
          scopes: string[];
          tenantId?: string;
          clientId?: string;
          patient?: string;
          userId?: string;
          actorRole?: string;
          actorUserType?: string;
        };

        try {
          if (userPoolId && expectedAudience) {
            const verified = await validateAccessToken(bearerToken, {
              userPoolId,
              region,
              expectedAudience,
              allowLegacyToken: true,
            });
            validated = {
              sub: verified.sub,
              scopes: verified.scopes ?? [],
              tenantId: verified.tenantId || verified.organizationID,
              clientId: verified.clientId,
              patient: verified.patient,
              userId: verified.userID,
              actorRole: normalizeRoleLike(
                (decodedClaims['roleName'] as string | undefined) ??
                  (decodedClaims['definedRoleCode'] as string | undefined)
              ),
              actorUserType: normalizeRoleLike(
                (decodedClaims['custom:userType'] as string | undefined) ??
                  (decodedClaims['userType'] as string | undefined)
              ),
            };
          } else {
            // Development fallback when JWKS config is not provided.
            const decoded = decodeJwtPayload(`Bearer ${bearerToken}`) as Record<string, unknown>;
            validated = {
              sub: typeof decoded.sub === 'string' ? decoded.sub : undefined,
              scopes: extractScopesFromToken(decoded),
              tenantId:
                (decoded['custom:tenant_id'] as string | undefined) ??
                (decoded['tenant_id'] as string | undefined) ??
                (decoded['custom:organizationID'] as string | undefined) ??
                (decoded['organizationId'] as string | undefined),
              clientId:
                (decoded.client_id as string | undefined) ??
                (decoded.clientId as string | undefined),
              patient: typeof decoded.patient === 'string' ? decoded.patient : undefined,
              userId:
                (decoded['custom:userID'] as string | undefined) ??
                (decoded['userID'] as string | undefined),
              actorRole: normalizeRoleLike(
                (decoded['roleName'] as string | undefined) ??
                  (decoded['definedRoleCode'] as string | undefined)
              ),
              actorUserType: normalizeRoleLike(
                (decoded['custom:userType'] as string | undefined) ??
                  (decoded['userType'] as string | undefined)
              ),
            };
          }
        } catch (tokenError) {
          const authErr: any = new Error(
            tokenError instanceof TokenValidationError
              ? tokenError.message
              : 'Invalid OAuth2 token'
          );
          authErr.statusCode = 401;
          authErr.code = 'INVALID_TOKEN';
          throw authErr;
        }

        fhirAuth = {
          subjectId: validated.sub,
          scopes: validated.scopes ?? [],
          tenantId: validated.tenantId,
          clientId: validated.clientId,
          purposeOfUse: extractPurposeOfUse(request),
          userId: validated.userId,
          patientContextId: extractPatientIdFromReference(validated.patient),
          actorRole: validated.actorRole,
          actorUserType: validated.actorUserType,
        };

        request.fhir = {
          ...(request.fhir ?? {}),
          tenantId: fhirAuth.tenantId,
          scopes: fhirAuth.scopes,
          clientId: fhirAuth.clientId,
          token: { sub: fhirAuth.subjectId },
        };

        // Tenant/client isolation checks
        const tenantFromRequest = extractTenantCandidate(request);
        if (tenantFromRequest && fhirAuth.tenantId && tenantFromRequest !== fhirAuth.tenantId) {
          const tenantErr: any = new Error('Forbidden: tenant/organization mismatch');
          tenantErr.statusCode = 403;
          tenantErr.code = 'TENANT_ISOLATION_FAILED';
          throw tenantErr;
        }
        const clientHeader = getHeaderValue(
          event.headers as Record<string, string | undefined>,
          'x-client-id'
        );
        if (clientHeader && fhirAuth.clientId && clientHeader !== fhirAuth.clientId) {
          const clientErr: any = new Error('Forbidden: client isolation check failed');
          clientErr.statusCode = 403;
          clientErr.code = 'CLIENT_ISOLATION_FAILED';
          throw clientErr;
        }

        request.context.userContext = {
          ...(request.context.userContext ?? {}),
          organizationId:
            fhirAuth.tenantId ?? request.context.userContext?.organizationId,
          userId: fhirAuth.subjectId ?? request.context.userContext?.userId,
        };
      }

      if (fhirRequest && shouldConvertInboundFhir(event.httpMethod) && isDirectFhirResource(request.body)) {
        await validateFhirResponse(request.body);
        request.context.fhirResourceType = request.body.resourceType;
        const canonicalPayload = convertFhirToCanonical(request.body);
        request.body = canonicalPayload;
        request.canonicalPayload = canonicalPayload;
        request.canonicalPatient = canonicalPayload;
      }

      if (fhirRequest && fhirAuth) {
        const requestResourceType =
          request.context?.fhirResourceType ??
          extractResourceTypeFromRequestBody(request.body) ??
          (options.fhir?.resourceType ?? 'Patient');
        fhirResourceTypeForAudit = requestResourceType;
        fhirActionForAudit = resolveFhirAction(event.httpMethod);

        const hasScopes = Array.isArray(fhirAuth.scopes) && fhirAuth.scopes.length > 0;
        const enforceScopes =
          shouldEnforceScopeChecks() && (hasScopes || shouldRequireScopesPresence());
        if (
          enforceScopes &&
          !isScopeAllowed(fhirAuth.scopes, requestResourceType, fhirActionForAudit)
        ) {
          const scopeErr: any = new Error(
            `Insufficient scope for ${requestResourceType} ${fhirActionForAudit}`
          );
          scopeErr.statusCode = 403;
          scopeErr.code = 'INSUFFICIENT_SCOPE';
          throw scopeErr;
        }

        const patientIdForConsent =
          extractPatientIdCandidate(request) ??
          fhirAuth.patientContextId;

        // For patient-scoped actors, allow only self profile access.
        // For non-patient actors (doctor/admin/service), skip consent check here.
        const explicitProviderActor = isProviderOrAdminRole(fhirAuth.actorRole);
        const patientScopedActor =
          !explicitProviderActor &&
          (isPatientActor(fhirAuth.scopes) ||
            isPatientRole(fhirAuth.actorRole) ||
            (fhirAuth.actorUserType?.toUpperCase() === 'USER' && Boolean(fhirAuth.userId)));
        if (patientScopedActor) {
          const actorPatientId = fhirAuth.patientContextId ?? fhirAuth.userId;
          logger.info({
            event: 'fhir_patient_self_check',
            patientScopedActor,
            actorRole: fhirAuth.actorRole ?? null,
            actorUserType: fhirAuth.actorUserType ?? null,
            actorPatientId: actorPatientId ?? null,
            requestedPatientId: patientIdForConsent ?? null,
          });
          if (!patientIdForConsent || !actorPatientId || patientIdForConsent !== actorPatientId) {
            const selfOnlyErr: any = new Error('Patients can only access their own profile');
            selfOnlyErr.statusCode = 403;
            selfOnlyErr.code = 'PATIENT_SELF_ONLY';
            throw selfOnlyErr;
          }

          const consentDecision = enforceConsent(
            {
              subjectId: fhirAuth.subjectId,
              clientId: fhirAuth.clientId,
              purposeOfUse: fhirAuth.purposeOfUse,
              tenantId: fhirAuth.tenantId,
            },
            patientIdForConsent,
            requestResourceType
          );
          if (consentDecision === 'DENY') {
            const consentErr: any = new Error(
              `Consent denied for ${requestResourceType} access`
            );
            consentErr.statusCode = 403;
            consentErr.code = 'CONSENT_DENIED';
            throw consentErr;
          }
        } else {
          logger.info({
            event: 'fhir_patient_self_check_skipped',
            reason: 'non_patient_scoped_actor',
            actorRole: fhirAuth.actorRole ?? null,
            actorUserType: fhirAuth.actorUserType ?? null,
            explicitProviderActor,
            requestedPatientId: patientIdForConsent ?? null,
          });
        }
      }

      /**
       * Validation middleware
       */
      if (options.validator) {
        await options.validator(request);
      }

      /**
       * Call handler
       */
      const result = await handler(request as TRequest);

      let response: any = result;

      /**
       * ---------------------------
       * FHIR TRANSFORMATION LAYER
       * ---------------------------
       */

      const fhirOpts = options.fhir;
      const fhirConfigured =
        Boolean(fhirOpts) &&
        ((typeof fhirOpts?.resourceType === 'string' &&
          fhirOpts.resourceType.trim() !== '') ||
          Boolean(fhirOpts?.resourceTypeFromContext) ||
          typeof fhirOpts?.inferResourceType === 'function');

      const fhirTransformRequested = fhirConfigured && result != null && fhirRequest;

      if (fhirTransformRequested && fhirOpts) {

        const clientId =
          request.context?.clientId ||
          request.headers?.['x-client-id'] ||
          'default';

        const listPath = fhirOpts.resourceListPath?.trim() ?? '';

        const rows: { kind: 'array'; items: any[] } | { kind: 'single' } | null =
          Array.isArray(result)
            ? { kind: 'array', items: result }
            : listPath
              ? (() => {
                  const nested = getAtPath(result, listPath);
                  return Array.isArray(nested)
                    ? { kind: 'array', items: nested as any[] }
                    : null;
                })()
              : null;

        if (rows?.kind === 'array') {
          const transformed = await Promise.all(
            rows.items.map((r: any) => {
              const resourceType = resolveFhirResourceType(fhirOpts, request, r);
              if (!resourceType) {
                const err: any = new Error('FHIR resource type could not be resolved for list row');
                err.statusCode = 500;
                err.code = 'FHIR_RESOURCE_TYPE_UNRESOLVED';
                throw err;
              }
              return fhirTransformation.transformCanonicalToFhir(
                resourceType,
                r,
                clientId
              );
            })
          );

          const count = parseInt(request.query?._count ?? '20');
          const page = parseInt(request.query?.page ?? '1');
          const start = (page - 1) * count;
          const end = start + count;
          const paginatedResources = transformed.slice(start, end);

          response = {
            resourceType: 'Bundle',
            type: 'searchset',
            total: transformed.length,
            entry: paginatedResources.map((r: any) => ({
              resource: r,
            })),
          };
        } else {
          const resourceType = resolveFhirResourceType(fhirOpts, request, result);
          if (resourceType) {
            response = await fhirTransformation.transformCanonicalToFhir(
              resourceType,
              result,
              clientId
            );
          }
        }

        await validateFhirResponse(response);
        fhirResourceTypeForAudit = response.resourceType;
        fhirActionForAudit = resolveFhirAction(event.httpMethod, response.resourceType);
      }

      const directFhirResponseRequested = fhirRequest && !fhirTransformRequested && isDirectFhirResource(response);
      if (directFhirResponseRequested) {
        await validateFhirResponse(response);
        fhirResourceTypeForAudit = response.resourceType;
        fhirActionForAudit = resolveFhirAction(event.httpMethod, response.resourceType);
      }

      statusCode = (response as any)?.statusCode ?? 200;

      if (fhirTransformRequested || directFhirResponseRequested) {
        return {
          statusCode: 200,
          headers: {
            'Content-Type': FHIR_CONTENT_TYPE,
          },
          body: JSON.stringify(response),
        };
      }

      const successMessage: any = {
        title: 'SUCCESS',
        description: 'Request processed successfully',
        severity: 'SUCCESS',
      };

      return successResponse(
        response,
        successMessage,
        { correlationId }
      );

    } catch (error: any) {
      if (fhirRequest) {
        statusCode = 400;
        const outcome = buildOperationOutcome(error?.message ?? 'Invalid FHIR response');
        return {
          statusCode,
          headers: {
            'Content-Type': FHIR_CONTENT_TYPE,
          },
          body: JSON.stringify(outcome),
        };
      }

      statusCode = error?.statusCode ?? 500;

      return handleError(error, {
        correlationId,
        logger,
      });

    } finally {
      if (fhirRequest) {
        const auditAction =
          fhirActionForAudit === 'write'
            ? event.httpMethod?.toUpperCase() === 'DELETE'
              ? 'D'
              : event.httpMethod?.toUpperCase() === 'POST'
                ? 'C'
                : 'U'
            : 'R';
        const auditOutcome: '0' | '4' | '8' = statusCode < 400 ? '0' : statusCode < 500 ? '4' : '8';
        await logAccessAudit({
          action: auditAction,
          resourceType: fhirResourceTypeForAudit ?? 'Unknown',
          resourceId:
            event.pathParameters?.id ??
            event.pathParameters?.patientId ??
            event.pathParameters?.userId,
          agentId: fhirAuth?.subjectId,
          clientId: fhirAuth?.clientId,
          tenantId: fhirAuth?.tenantId,
          outcome: auditOutcome,
          requestId: correlationId,
        }).catch(() => undefined);
      }

      const duration = timer.end();

      logHttpRequest(
        logger,
        method,
        path,
        statusCode,
        duration as unknown as number,
        correlationId
      );

    }
  };