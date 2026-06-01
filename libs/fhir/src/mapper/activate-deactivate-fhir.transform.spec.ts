import type { LambdaRequest } from '@api-hub/utils';

import { enrichActivateDeactivateFromFhir } from './activate-deactivate-fhir.transform';

describe('enrichActivateDeactivateFromFhir', () => {
  const baseReq = {
    event: { headers: {} },
    context: {
      userContext: { organizationId: 'org-from-jwt' },
    },
  } as unknown as LambdaRequest;

  it('passes through canonical activate payloads', () => {
    const result = enrichActivateDeactivateFromFhir(baseReq, {
      action: 'ACTIVATE',
      organizationID: 'mm3208au877eaa2d',
      patientUserId: '01KJC8S5RZDG19EGT3XM5Y7XG3',
    });

    expect(result).toEqual({
      action: 'ACTIVATE',
      organizationID: 'mm3208au877eaa2d',
      patientUserId: '01KJC8S5RZDG19EGT3XM5Y7XG3',
    });
  });

  it('maps FHIR Parameters.parameter parts', () => {
    const result = enrichActivateDeactivateFromFhir(baseReq, {
      resourceType: 'Parameters',
      parameter: [
        { name: 'action', valueCode: 'DEACTIVATE' },
        { name: 'patientUserId', valueString: '01KJC8S5RZDG19EGT3XM5Y7XG3' },
        { name: 'organizationID', valueString: 'mm3208au877eaa2d' },
      ],
    });

    expect(result.action).toBe('DEACTIVATE');
    expect(result.patientUserId).toBe('01KJC8S5RZDG19EGT3XM5Y7XG3');
    expect(result.organizationID).toBe('mm3208au877eaa2d');
  });

  it('maps action and user id from extensions', () => {
    const result = enrichActivateDeactivateFromFhir(baseReq, {
      resourceType: 'Parameters',
      extension: [
        {
          url: 'http://your-domain.com/fhir/StructureDefinition/action',
          valueCode: 'ACTIVATE',
        },
        {
          url: 'http://your-domain.com/fhir/StructureDefinition/patient-user-id',
          valueString: '01KJC8S5RZDG19EGT3XM5Y7XG3',
        },
        {
          url: 'http://your-domain.com/fhir/StructureDefinition/organization-id',
          valueString: 'mm3208au877eaa2d',
        },
      ],
    });

    expect(result.action).toBe('ACTIVATE');
    expect(result.patientUserId).toBe('01KJC8S5RZDG19EGT3XM5Y7XG3');
    expect(result.organizationID).toBe('mm3208au877eaa2d');
  });

  it('maps a Practitioner resource with action extension', () => {
    const result = enrichActivateDeactivateFromFhir(baseReq, {
      resourceType: 'Practitioner',
      id: '01KJC8S5RZDG19EGT3XM5Y7XG3',
      extension: [
        {
          url: 'http://your-domain.com/fhir/StructureDefinition/action',
          valueCode: 'DEACTIVATE',
        },
        {
          url: 'http://your-domain.com/fhir/StructureDefinition/organization-id',
          valueString: 'mm3208au877eaa2d',
        },
      ],
    });

    expect(result.action).toBe('DEACTIVATE');
    expect(result.patientUserId).toBe('01KJC8S5RZDG19EGT3XM5Y7XG3');
    expect(result.organizationID).toBe('mm3208au877eaa2d');
  });

  it('reads action and user id from headers', () => {
    const req = {
      ...baseReq,
      event: {
        headers: {
          'x-action': 'activate',
          'x-user-id': '01KJC8S5RZDG19EGT3XM5Y7XG3',
        },
      },
    } as unknown as LambdaRequest;

    const result = enrichActivateDeactivateFromFhir(req, {
      resourceType: 'Parameters',
    });

    expect(result.action).toBe('ACTIVATE');
    expect(result.patientUserId).toBe('01KJC8S5RZDG19EGT3XM5Y7XG3');
    expect(result.organizationID).toBe('org-from-jwt');
  });
});
