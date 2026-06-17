import type { LambdaRequest } from '@api-hub/utils';

type AnyObject = Record<string, unknown>;

function pickString(...candidates: Array<unknown>): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') return c.trim();
  }
  return undefined;
}

function extractReferenceId(reference: unknown): string | undefined {
  if (typeof reference !== 'string' || reference.trim() === '') return undefined;
  const parts = reference.trim().split('/');
  return parts[parts.length - 1] || reference.trim();
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatDateToDDMMYYYY(dateish: string | undefined): string | undefined {
  if (!dateish) return undefined;
  const d = new Date(dateish);
  if (isNaN(d.getTime())) return undefined;
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function formatTimeHHMM(dateish: string | undefined): string | undefined {
  if (!dateish) return undefined;
  const d = new Date(dateish);
  if (isNaN(d.getTime())) return undefined;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getFirstAppointmentResource(body: AnyObject): AnyObject | undefined {
  if (!body) return undefined;
  if (body.resourceType === 'Bundle' && Array.isArray(body.entry)) {
    for (const entry of body.entry) {
      const r = (entry as { resource?: unknown }).resource;
      if (r && typeof r === 'object' && (r as AnyObject).resourceType === 'Appointment') {
        return r as AnyObject;
      }
    }
    return undefined;
  }

  if (body.resourceType === 'Appointment') return body;
  return undefined;
}

function mapParticipants(participants: unknown): AnyObject[] {
  if (!Array.isArray(participants)) return [];
  const out: AnyObject[] = [];
  for (const p of participants) {
    if (!p || typeof p !== 'object') continue;
    const entry = p as AnyObject;
    const actor = entry.actor as AnyObject | undefined;
    const reference = actor ? pickString(actor.reference as unknown) : undefined;
    const userId = reference ? extractReferenceId(reference) : undefined;
    const name = actor ? pickString(actor.display as unknown) : pickString(entry.display as unknown);
    out.push({ userId, name, status: pickString(entry.status as unknown), role: pickString(entry.role as unknown) });
  }
  return out;
}

/**
 * Creates a minimal canonical schedule/appointment payload from an inbound FHIR Appointment.
 * The schedule service expects fields like: owner, participantInfo, scheduleTimeStamp, scheduleDate, startTime, endTime, duration, organizationID, title, description, bookingId
 */
export function enrichCreateAppointmentFromFhir(
  req: LambdaRequest,
  rawBody: AnyObject,
): AnyObject {
  const appt = getFirstAppointmentResource(rawBody) ?? rawBody;

  const start = pickString(appt.start as unknown);
  const end = pickString(appt.end as unknown);
  const scheduleTimeStamp = start ? String(new Date(start).getTime()) : undefined;
  const scheduleDate = formatDateToDDMMYYYY(start);
  const startTime = formatTimeHHMM(start);
  const endTime = formatTimeHHMM(end);
  let duration: number | undefined;
  if (start && end) {
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    if (!isNaN(s) && !isNaN(e)) duration = Math.max(0, Math.round((e - s) / 60000));
  }

  const participants = mapParticipants(appt.participant);

  const ownerCandidate =
    participants.find((p) => (pickString(p.role) ?? '').toLowerCase().includes('patient')) ||
    participants[0];
  const owner = ownerCandidate
    ? { userId: ownerCandidate.userId, name: ownerCandidate.name, userType: 'MOBILE' }
    : undefined;

  // const staffCandidate =
  //   participants.find((p) => (pickString(p.role) ?? '').toLowerCase().includes('practitioner')) ||
  //   participants.find((p) => p.userId && p !== ownerCandidate);

  const participantInfo = participants.map((p) => ({ userId: p.userId, name: p.name, userType: p.userId ? 'WEB' : 'MOBILE' }));

  const bookingId = pickString((Array.isArray(appt.identifier) && appt.identifier[0] && (appt.identifier[0] as AnyObject).value) as unknown) || pickString(appt.id as unknown) || undefined;

  const organizationID = pickString((appt.serviceProvider && (appt.serviceProvider as AnyObject).reference) as unknown) ? extractReferenceId((appt.serviceProvider as AnyObject).reference as unknown) : pickString((req.context as any)?.userContext?.organizationId);

  const title = pickString(appt.reason || (appt.serviceType && (appt.serviceType as AnyObject).text) || appt.description);
  const description = pickString(appt.description as unknown) || undefined;

  const canonical: AnyObject = {
    appointmentId: pickString(appt.id as unknown) || undefined,
    bookingId: bookingId,
    owner: owner ? owner : undefined,
    participantInfo: participantInfo,
    scheduleTimeStamp: scheduleTimeStamp,
    scheduleDate: scheduleDate,
    startTime: startTime,
    endTime: endTime,
    duration: duration,
    organizationID: organizationID,
    title,
    description,
  };

  return canonical;
}
