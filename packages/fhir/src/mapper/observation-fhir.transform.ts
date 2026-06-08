import type { LambdaRequest } from '@api-hub/utils';

type AnyObject = Record<string, unknown>;

export type ObservationCanonical = {
  observationId?: string;
  patientUserId?: string;
  performerUserId?: string;
  code?: { text?: string; coding?: Array<{ system?: string; code?: string; display?: string }> };
  value?: string | number | null;
  unit?: string | undefined;
  effectiveDateTime?: string | undefined;
  interpretation?: string | undefined;
};

function extractReferenceId(reference: unknown): string | undefined {
  if (typeof reference !== 'string' || reference.trim() === '') return undefined;
  const parts = reference.trim().split('/');
  return parts[parts.length - 1] || reference.trim();
}

export function enrichObservationFromFhir(req: LambdaRequest, rawBody: AnyObject): ObservationCanonical {
  const out: ObservationCanonical = {};
  if (!rawBody || typeof rawBody !== 'object') return out;

  if (typeof rawBody.id === 'string' && rawBody.id.trim() !== '') out.observationId = rawBody.id.trim();

  // subject -> patient
  if (rawBody.subject && typeof rawBody.subject === 'object') {
    const subj = rawBody.subject as AnyObject;
    out.patientUserId = typeof subj.reference === 'string' ? extractReferenceId(subj.reference) : undefined;
  }

  // performer[0]
  if (Array.isArray(rawBody.performer) && rawBody.performer.length > 0) {
    const p = rawBody.performer[0];
    if (p && typeof p === 'object') {
      out.performerUserId = typeof (p as AnyObject).reference === 'string' ? extractReferenceId((p as AnyObject).reference) : undefined;
    }
  }

  // code
  if (rawBody.code && typeof rawBody.code === 'object') {
    const code = rawBody.code as AnyObject;
    out.code = {
      text: typeof code.text === 'string' ? code.text : undefined,
      coding: Array.isArray(code.coding)
        ? code.coding.map((c) => ({
            system: typeof (c as AnyObject).system === 'string' ? (c as AnyObject).system : undefined,
            code: typeof (c as AnyObject).code === 'string' ? (c as AnyObject).code : undefined,
            display: typeof (c as AnyObject).display === 'string' ? (c as AnyObject).display : undefined,
          }))
        : undefined,
    };
  }

  // value[x]
  if (rawBody.valueQuantity && typeof rawBody.valueQuantity === 'object') {
    const v = rawBody.valueQuantity as AnyObject;
    out.value = typeof v.value === 'number' ? v.value : typeof v.value === 'string' ? Number(v.value) : undefined;
    out.unit = typeof v.unit === 'string' ? v.unit : typeof v.code === 'string' ? v.code : undefined;
  } else if (rawBody.valueString && typeof rawBody.valueString === 'string') {
    out.value = rawBody.valueString;
  } else if (rawBody.valueBoolean !== undefined) {
    out.value = rawBody.valueBoolean === true ? 1 : 0;
  } else if (rawBody.valueNumber !== undefined) {
    out.value = Number(rawBody.valueNumber);
  }

  if (typeof rawBody.effectiveDateTime === 'string') out.effectiveDateTime = rawBody.effectiveDateTime;
  if (typeof rawBody.interpretation === 'string') out.interpretation = rawBody.interpretation;

  return out;
}
