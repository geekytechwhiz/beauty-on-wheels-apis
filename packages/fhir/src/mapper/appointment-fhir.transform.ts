import type { LambdaRequest } from '@api-hub/utils';

type AnyObject = Record<string, unknown>;

export type AppointmentCanonical = {
  appointmentId?: string;
  organizationId?: string;
  patientUserId?: string;
  practitionerUserId?: string;
  start?: string;
  end?: string;
  status?: string;
  description?: string;
  participants?: Array<{ actor?: string; actorDisplay?: string; status?: string; type?: string }>;
};

function extractReferenceId(reference: unknown): string | undefined {
  if (typeof reference !== 'string' || reference.trim() === '') return undefined;
  const parts = reference.trim().split('/');
  return parts[parts.length - 1] || reference.trim();
}

function extensionSegmentMatches(url: unknown, segments: string[]): boolean {
  if (typeof url !== 'string' || url.trim() === '') {
    return false;
  }
  const lastSegment = url
    .trim()
    .split('/')
    .pop()
    ?.toLowerCase()
    .replace(/_/g, '-');
  if (!lastSegment) return false;
  return segments.some((segment) => lastSegment === segment.toLowerCase().replace(/_/g, '-'));
}

function readExtensionScalar(entry: Record<string, unknown>): string | undefined {
  if (typeof entry.valueString === 'string' && entry.valueString.trim() !== '') {
    return entry.valueString.trim();
  }
  if (typeof entry.valueCode === 'string' && entry.valueCode.trim() !== '') {
    return entry.valueCode.trim();
  }
  if (typeof entry.valueUri === 'string' && entry.valueUri.trim() !== '') {
    return entry.valueUri.trim();
  }
  const reference = entry.valueReference;
  if (reference && typeof reference === 'object') {
    const ref = reference as Record<string, unknown>;
    if (typeof ref.reference === 'string' && ref.reference.trim() !== '') {
      const parts = ref.reference.trim().split('/');
      return parts[parts.length - 1] || ref.reference.trim();
    }
    const identifier = ref.identifier;
    if (identifier && typeof identifier === 'object') {
      const value = (identifier as Record<string, unknown>).value;
      if (typeof value === 'string' && value.trim() !== '') {
        return value.trim();
      }
    }
  }
  return undefined;
}

function readExtensionBySegments(extensions: unknown, segments: string[]): string | undefined {
  if (!Array.isArray(extensions)) return undefined;
  for (const extension of extensions) {
    if (!extension || typeof extension !== 'object') continue;
    const entry = extension as Record<string, unknown>;
    if (extensionSegmentMatches(entry.url, segments)) {
      const scalar = readExtensionScalar(entry);
      if (scalar) return scalar;
    }
    const nested = readExtensionBySegments(entry.extension, segments);
    if (nested) return nested;
  }
  return undefined;
}

function extractParticipantActor(part: AnyObject): { actor?: string; actorDisplay?: string; status?: string; type?: string } {
  const actor = part.actor;
  const actorRef = actor && typeof actor === 'object' ? (actor as AnyObject).reference : actor;
  const actorDisplay = actor && typeof actor === 'object' ? (actor as AnyObject).display : undefined;
  const type = Array.isArray(part.type) && part.type.length > 0 ? String((part.type[0] as AnyObject).text ?? '') : undefined;
  return {
    actor: typeof actorRef === 'string' ? extractReferenceId(actorRef) : undefined,
    actorDisplay: typeof actorDisplay === 'string' ? actorDisplay.trim() : undefined,
    status: typeof part.status === 'string' ? part.status.trim() : undefined,
    type: type && type.trim() !== '' ? type.trim() : undefined,
  };
}

/**
 * Build a CreateServiceScheduleRequest-style payload from an Appointment FHIR resource.
 * Handles both `createSchedule` and `createSession` by setting `action` (default: createSchedule).
 */
export function enrichAppointmentToServicePayload(req: LambdaRequest, rawBody: AnyObject): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!rawBody || typeof rawBody !== 'object') return out;

  // serviceType default
  out.serviceType = 'addon';

  // try to pull external addon ids from extensions or serviceProvider
  if (typeof rawBody.id === 'string' && rawBody.id.trim() !== '') {
    // use appointment id as externalAppointmentId in meta if needed
    out.externalAppointmentId = rawBody.id.trim();
  }

  // subject -> user
  if (rawBody.subject && typeof rawBody.subject === 'object') {
    const subj = rawBody.subject as AnyObject;
    out.userId = typeof subj.reference === 'string' ? extractReferenceId(subj.reference) : undefined;
    if (typeof subj.display === 'string') out.userName = subj.display;
  }

  // attempt to get patient details from participant entries
  const parts = Array.isArray(rawBody.participant) ? rawBody.participant : [];
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue;
    const mapped = extractParticipantActor(p as AnyObject);
    const t = (mapped.type || '').toLowerCase();
    const display = (mapped.actorDisplay || '').toLowerCase();
    if (!out.staffId && (t.includes('practitioner') || display.includes('dr') || display.includes('doctor') || t.includes('staff'))) {
      out.staffId = mapped.actor;
      if (mapped.actorDisplay) out.staffName = mapped.actorDisplay;
    }
    if (!out.userId && (t.includes('patient') || display.includes('patient'))) {
      out.userId = mapped.actor;
      if (mapped.actorDisplay) out.userName = mapped.actorDisplay;
    }
  }

  // fallback: requester
  if (!out.staffId && rawBody.requester && typeof rawBody.requester === 'object') {
    const ra = rawBody.requester as AnyObject;
    if (ra.actor && typeof ra.actor === 'object' && typeof (ra.actor as AnyObject).reference === 'string') {
      out.staffId = extractReferenceId((ra.actor as AnyObject).reference as unknown as string);
    }
  }

  // times
  if (typeof rawBody.start === 'string') out.startTime = rawBody.start;
  if (typeof rawBody.end === 'string') out.endTime = rawBody.end;
  if (!out.startTime && rawBody.period && typeof rawBody.period === 'object') {
    const per = rawBody.period as AnyObject;
    if (typeof per.start === 'string') out.startTime = per.start;
    if (typeof per.end === 'string') out.endTime = per.end;
  }

  // scheduleTimeStamp and scheduleDate derived from startTime
  if (typeof out.startTime === 'string') {
    const d = new Date(out.startTime as string);
    if (!Number.isNaN(d.getTime())) {
      out.scheduleTimeStamp = String(d.getTime());
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = String(d.getFullYear());
      out.scheduleDate = `${dd}-${mm}-${yyyy}`;
    }
  }

  // duration
  if (!out.duration && typeof out.startTime === 'string' && typeof out.endTime === 'string') {
    const s = new Date(out.startTime as string).getTime();
    const e = new Date(out.endTime as string).getTime();
    if (!Number.isNaN(s) && !Number.isNaN(e) && e > s) out.duration = String(Math.round((e - s) / 60000));
  }

  // location
  if (rawBody.location && typeof rawBody.location === 'object') {
    const loc = rawBody.location as AnyObject;
    if (typeof loc.display === 'string') out.location = loc.display;
    if (loc.address && typeof loc.address === 'object') {
      const addr = loc.address as AnyObject;
      if (typeof addr.postalCode === 'string') out.pincode = addr.postalCode;
    }
  }

  // coords from extension (if provided)
  if (Array.isArray(rawBody.extension)) {
    const lat = readExtensionBySegments(rawBody.extension, ['latitude', 'lat']);
    const lon = readExtensionBySegments(rawBody.extension, ['longitude', 'lon', 'lng']);
    if (lat) out.latitude = Number(lat);
    if (lon) out.longitude = Number(lon);
    const actionExt = readExtensionBySegments(rawBody.extension, ['action']);
    if (actionExt) out.action = actionExt;
  }

  // default action and paymentSchedule
  if (!out.action) out.action = 'createSchedule';
  if (!out.paymentSchedule) out.paymentSchedule = 'INSTANT';

  // copy basic contact fields if present
  if (!out.userName && rawBody.subject && typeof rawBody.subject === 'object' && typeof (rawBody.subject as AnyObject).display === 'string') {
    out.userName = (rawBody.subject as AnyObject).display;
  }

  // attempt to copy emails from participants
  if (!out.userEmail || !out.staffEmail) {
    for (const p of parts) {
      if (!p || typeof p !== 'object') continue;
      const entry = p as AnyObject;
      const actor = entry.member ?? entry.actor ?? entry;
      if (actor && typeof actor === 'object') {
        if (!out.userEmail && typeof (actor as AnyObject).email === 'string') out.userEmail = (actor as AnyObject).email;
        if (!out.staffEmail && typeof (actor as AnyObject).email === 'string') out.staffEmail = (actor as AnyObject).email;
      }
    }
  }

  return out;
}
