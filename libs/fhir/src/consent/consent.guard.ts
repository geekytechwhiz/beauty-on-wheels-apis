// import { LambdaRequest, BaseError } from '@api-hub/utils';
import { CanonicalPatient } from '@api-hub/canonical';
import { isScopeAllowed, type FhirAction } from '@api-hub/scope-mapping';
import { BaseError } from '../errors/base.error';
import { LambdaRequest } from '../types/core-types';
export class ConsentGuard {
  verifyPatientAccess(
    req: LambdaRequest,
    patient: CanonicalPatient,
    action: FhirAction = 'read'
  ): void {
    const userOrg = req.context.userContext?.organizationId;
    const patientOrg = patient.organizationId;

    if (patientOrg && userOrg && patientOrg !== userOrg) {
      throw new BaseError(
        'Forbidden: patient belongs to a different organization',
        403,
        'PATIENT_ORG_FORBIDDEN'
      );
    }

    this.verifyScope(req, 'Patient', action);
  }

  verifyOrganizationAccess(
    req: LambdaRequest,
    organizationId: string,
    action: FhirAction = 'read'
  ): void {
    const userOrg = req.context.userContext?.organizationId;

    if (userOrg && organizationId && userOrg !== organizationId) {
      throw new BaseError(
        'Forbidden: organization mismatch',
        403,
        'ORG_FORBIDDEN'
      );
    }

    this.verifyScope(req, 'Patient', action);
  }

  verifyScope(
    req: LambdaRequest,
    resourceType: string,
    action: FhirAction
  ): void {
    const scopes =
      ((req as any).fhir?.scopes as string[] | undefined) ??
      this.extractScopesFromAuthHeader(req.context.authHeader);

      // console.log('scopes', scopes);
      // console.log('resourceType', resourceType);
      // console.log('action', action);
      // console.log('isScopeAllowed', isScopeAllowed(scopes, resourceType, action));

    if (!scopes || !isScopeAllowed(scopes, resourceType, action)) {
      throw new BaseError(
        `Insufficient scope for ${resourceType} ${action}`,
        403,
        'INSUFFICIENT_SCOPE'
      );
    }
  }

  private extractScopesFromAuthHeader(
    authHeader?: string
  ): string[] | undefined {
    if (!authHeader) return undefined;
    return undefined;
  }
}

