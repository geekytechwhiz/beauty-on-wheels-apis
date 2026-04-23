import { BaseError } from '@api-hub/utils';
import { CanonicalPatient } from '@api-hub/canonical';
import { FhirTransformationService } from '../services/fhir-transformation.service';
import { ConsentGuard } from '../consent/consent.guard';
import { parsePatientSearch, PatientSearchQuery } from '../search/fhir-search.parser';
import { FhirRequest } from '../gateway/fhir-gateway.middleware';
import { FhirBundle, FhirBundleEntry, FhirPatient } from '../types/fhir.types';

export interface PatientDomainService {
  getPatientById(
    id: string,
    tenantId?: string
  ): Promise<CanonicalPatient | null>;

  searchPatients(
    query: PatientSearchQuery,
    tenantId?: string
  ): Promise<CanonicalPatient[]>;

  createPatient(
    patient: CanonicalPatient,
    tenantId?: string
  ): Promise<CanonicalPatient>;
}

export class PatientController {
  constructor(
    private readonly domainService: PatientDomainService,
    private readonly transformation: FhirTransformationService,
    private readonly consentGuard: ConsentGuard
  ) {}

  /**
   * GET /fhir/Patient/{id}
   */
  async getPatientById(req: FhirRequest): Promise<FhirPatient> {
    const id =
      req.pathParameters?.id ??
      req.pathParameters?.patientId ??
      (req.params as any)?.id;

    if (!id) {
      throw new BaseError('Missing patient id', 400, 'MISSING_ID');
    }

    const tenantId =
      req.fhir?.tenantId ?? req.context.userContext?.organizationId;

    const patient = await this.domainService.getPatientById(id, tenantId);
    if (!patient) {
      throw new BaseError('Patient not found', 404, 'PATIENT_NOT_FOUND');
    }

    this.consentGuard.verifyPatientAccess(req, patient, 'read');

    const clientId = req.fhir?.clientId ?? 'trutech';
    const fhirPatient = await this.transformation.transformCanonicalToFhir(
      'Patient',
      patient,
      clientId
    );

    return fhirPatient as FhirPatient;
  }

  /**
   * GET /fhir/Patient
   */
  async searchPatients(req: FhirRequest): Promise<FhirBundle> {
    const queryParams =
      req.event.queryStringParameters ??
      (req as any).query ??
      ({} as Record<string, string | undefined>);

    const searchQuery = parsePatientSearch(
      queryParams as Record<string, string | undefined>
    );

    const tenantId =
      req.fhir?.tenantId ?? req.context.userContext?.organizationId;

    this.consentGuard.verifyScope(req, 'Patient', 'search');

    const patients = await this.domainService.searchPatients(
      searchQuery,
      tenantId
    );

    const clientId = req.fhir?.clientId ?? 'trutech';

    const entries: FhirBundleEntry[] = [];
    for (const p of patients) {
      const resource = await this.transformation.transformCanonicalToFhir(
        'Patient',
        p,
        clientId
      );
      entries.push({ resource: resource as FhirPatient });
    }

    const bundle: FhirBundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: entries,
    };

    return bundle;
  }

  /**
   * POST /fhir/Patient
   *
   * For this minimal façade, we assume downstream layers have already
   * transformed the inbound FHIR resource into a CanonicalPatient and
   * attached it to the request as `canonicalPatient`.
   */
  async createPatient(req: FhirRequest): Promise<FhirPatient> {
    const canonical = (req as any).canonicalPatient as
      | CanonicalPatient
      | undefined;

    if (!canonical) {
      throw new BaseError(
        'canonicalPatient not provided on request',
        400,
        'INVALID_PAYLOAD'
      );
    }

    const tenantId =
      req.fhir?.tenantId ?? req.context.userContext?.organizationId;

    this.consentGuard.verifyScope(req, 'Patient', 'write');

    const created = await this.domainService.createPatient(
      canonical,
      tenantId
    );

    const clientId = req.fhir?.clientId ?? 'trutech';
    const fhirPatient = await this.transformation.transformCanonicalToFhir(
      'Patient',
      created,
      clientId
    );

    return fhirPatient as FhirPatient;
  }
}

