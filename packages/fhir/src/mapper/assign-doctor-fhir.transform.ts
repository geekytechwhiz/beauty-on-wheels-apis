import type { LambdaRequest } from '@api-hub/utils';

type AnyObject = Record<string, unknown>;

export type AssignDoctorParticipant = {
  userId: string;
  name?: string;
  email?: string;
  profileImage?: string;
  userType?: string;
  presenceStatus?: string;
};

export type AssignDoctorCanonical = {
  organizationId?: string;
  sender?: AssignDoctorParticipant;
  receiver?: AssignDoctorParticipant;
  isReferred?: boolean;
};

const PRACTITIONER_ROLE_CODES = new Set([
  'atnd',
  'doctor',
  'practitioner',
  'staff',
  '224609009',
  '158965001',
]);

const PATIENT_ROLE_CODES = new Set([
  'pat',
  'patient',
  '116154003',
]);

function getHeader(req: LambdaRequest, name: string): string | undefined {
  const headers = req.event?.headers;
  if (!headers) {
    return undefined;
  }

  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName && typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

function pickString(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim();
    }
  }

  return undefined;
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

  if (!lastSegment) {
    return false;
  }

  return segments.some(
    (segment) => lastSegment === segment.toLowerCase().replace(/_/g, '-'),
  );
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

function readExtensionBySegments(
  extensions: unknown,
  segments: string[],
): string | undefined {
  if (!Array.isArray(extensions)) {
    return undefined;
  }

  for (const extension of extensions) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }

    const entry = extension as Record<string, unknown>;
    if (extensionSegmentMatches(entry.url, segments)) {
      const scalar = readExtensionScalar(entry);
      if (scalar) {
        return scalar;
      }
    }

    const nested = readExtensionBySegments(entry.extension, segments);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function readParticipantFromExtension(
  extensions: unknown,
  segments: string[],
): AssignDoctorParticipant | undefined {
  if (!Array.isArray(extensions)) {
    return undefined;
  }

  for (const extension of extensions) {
    if (!extension || typeof extension !== 'object') {
      continue;
    }

    const entry = extension as Record<string, unknown>;
    if (!extensionSegmentMatches(entry.url, segments)) {
      continue;
    }

    const nestedUserId = readExtensionBySegments(entry.extension, [
      'userid',
      'user-id',
      'id',
    ]);
    const nestedName = readExtensionBySegments(entry.extension, ['name']);
    const nestedEmail = readExtensionBySegments(entry.extension, ['email']);
    const nestedUserType = readExtensionBySegments(entry.extension, [
      'user-type',
      'usertype',
    ]);
    const nestedPresence = readExtensionBySegments(entry.extension, [
      'presence-status',
      'presencestatus',
    ]);
    const nestedProfileImage = readExtensionBySegments(entry.extension, [
      'profile-image',
      'profileimage',
      'profile-pic',
      'profilepic',
    ]);

    const scalar = readExtensionScalar(entry);
    if (scalar?.startsWith('{')) {
      try {
        const parsed = readParticipant(JSON.parse(scalar));
        if (parsed) {
          return parsed;
        }
      } catch {
        // fall through
      }
    }

    const direct = readParticipant(entry);
    if (direct) {
      return direct;
    }

    const userId = pickString(
      nestedUserId,
      scalar,
      readExtensionBySegments(entry.extension, ['sender-id', 'receiver-id']),
    );
    if (userId) {
      return {
        userId,
        name: nestedName,
        email: nestedEmail,
        userType: nestedUserType,
        presenceStatus: nestedPresence,
        profileImage: nestedProfileImage,
      };
    }
  }

  return undefined;
}

function isFhirResource(value: unknown): value is AnyObject {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as { resourceType?: unknown }).resourceType === 'string'
  );
}

function extractBundleResources(body: AnyObject): AnyObject[] {
  if (body.resourceType !== 'Bundle') {
    return isFhirResource(body) ? [body] : [];
  }

  const entries = body.entry;
  if (!Array.isArray(entries)) {
    return [];
  }

  const resources: AnyObject[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const entryRecord = entry as AnyObject;
    const resource = entryRecord.resource;
    if (!isFhirResource(resource)) {
      continue;
    }

    const resourceRecord = resource as AnyObject;
    if (!extractResourceId(resourceRecord)) {
      const fullUrlId = extractReferenceId(entryRecord.fullUrl);
      if (fullUrlId) {
        resources.push({ ...resourceRecord, id: fullUrlId });
        continue;
      }
    }

    resources.push(resourceRecord);
  }

  return resources;
}

function extractResourceId(resource: AnyObject): string | undefined {
  if (typeof resource.id === 'string' && resource.id.trim() !== '') {
    return resource.id.trim();
  }

  const identifiers = resource.identifier;
  if (!Array.isArray(identifiers)) {
    return undefined;
  }

  for (const identifier of identifiers) {
    if (!identifier || typeof identifier !== 'object') {
      continue;
    }

    const value = (identifier as Record<string, unknown>).value;
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }

  return undefined;
}

function extractReferenceId(reference: unknown): string | undefined {
  if (typeof reference !== 'string' || reference.trim() === '') {
    return undefined;
  }

  const parts = reference.trim().split('/');
  return parts[parts.length - 1] || reference.trim();
}

function extractResourceName(resource: AnyObject): string | undefined {
  const names = resource.name;
  if (!Array.isArray(names) || names.length === 0) {
    return undefined;
  }

  const name = names[0] as AnyObject;
  if (typeof name.text === 'string' && name.text.trim() !== '') {
    return name.text.trim();
  }

  const given = Array.isArray(name.given)
    ? name.given.map(String).filter(Boolean).join(' ')
    : '';
  const family = typeof name.family === 'string' ? name.family : '';
  const combined = [given, family].filter(Boolean).join(' ').trim();
  return combined || undefined;
}

function extractTelecomValue(resource: AnyObject, system: string): string | undefined {
  const telecom = resource.telecom;
  if (!Array.isArray(telecom)) {
    return undefined;
  }

  for (const entry of telecom) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const item = entry as Record<string, unknown>;
    if (item.system === system && typeof item.value === 'string' && item.value.trim() !== '') {
      return item.value.trim();
    }
  }

  return undefined;
}

function extractPhotoUrl(resource: AnyObject): string | undefined {
  const photo = resource.photo;
  if (!Array.isArray(photo) || photo.length === 0) {
    return undefined;
  }

  const first = photo[0] as Record<string, unknown>;
  const url = typeof first.url === 'string' ? first.url.trim() : '';
  return url || undefined;
}

function mapResourceToParticipant(
  resource: AnyObject,
  defaultUserType: string,
): AssignDoctorParticipant | undefined {
  const userId = extractResourceId(resource);
  if (!userId) {
    return undefined;
  }

  const userType =
    readExtensionBySegments(resource.extension, ['user-type', 'usertype']) ??
    (resource.resourceType === 'Practitioner'
      ? 'STAFF'
      : resource.resourceType === 'Patient'
        ? 'USER'
        : defaultUserType);

  return {
    userId,
    name: extractResourceName(resource),
    email: extractTelecomValue(resource, 'email'),
    profileImage: extractPhotoUrl(resource),
    userType,
    presenceStatus: readExtensionBySegments(resource.extension, [
      'presence-status',
      'presencestatus',
    ]),
  };
}

function mapPractitionerToSender(resource: AnyObject): AssignDoctorParticipant | undefined {
  return mapResourceToParticipant(resource, 'STAFF');
}

function mapPatientToReceiver(resource: AnyObject): AssignDoctorParticipant | undefined {
  return mapResourceToParticipant(resource, 'USER');
}

function readParticipant(value: unknown): AssignDoctorParticipant | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const participant:any = value as Record<string, unknown>;
  if (isFhirResource(participant)) {
    const resourceType = participant.resourceType;
    if (resourceType === 'Practitioner') {
      return mapPractitionerToSender(participant);
    }
    if (resourceType === 'Patient') {
      return mapPatientToReceiver(participant);
    }
    return mapResourceToParticipant(
      participant,
      resourceType === 'PractitionerRole' ? 'STAFF' : 'USER',
    );
  }

  const nestedUser =
    participant.user && typeof participant.user === 'object'
      ? (participant.user as Record<string, unknown>)
      : undefined;
  const userId = pickString(
    typeof participant.userId === 'string' ? participant.userId : undefined,
    typeof participant.userID === 'string' ? participant.userID : undefined,
    typeof participant.id === 'string' ? participant.id : undefined,
    nestedUser && typeof nestedUser.userId === 'string'
      ? nestedUser.userId
      : undefined,
    nestedUser && typeof nestedUser.id === 'string' ? nestedUser.id : undefined,
    extractReferenceId(participant.reference),
  );

  if (!userId) {
    return undefined;
  }

  const fhirName =
    Array.isArray(participant.name) && participant.name.length > 0
      ? extractResourceName(participant)
      : undefined;

  return {
    userId,
    name:
      typeof participant.name === 'string'
        ? participant.name
        : fhirName,
    email:
      typeof participant.email === 'string'
        ? participant.email
        : extractTelecomValue(participant, 'email'),
    profileImage:
      typeof participant.profileImage === 'string'
        ? participant.profileImage
        : typeof participant.profilePic === 'string'
          ? participant.profilePic
          : extractPhotoUrl(participant),
    userType:
      typeof participant.userType === 'string' ? participant.userType : undefined,
    presenceStatus:
      typeof participant.presenceStatus === 'string'
        ? participant.presenceStatus
        : undefined,
  };
}

function participantRoleCodes(participant: AnyObject): string[] {
  const roles = participant.role;
  if (!Array.isArray(roles)) {
    return [];
  }

  const codes: string[] = [];
  for (const role of roles) {
    if (!role || typeof role !== 'object') {
      continue;
    }

    const coding = (role as Record<string, unknown>).coding;
    if (!Array.isArray(coding)) {
      continue;
    }

    for (const codeEntry of coding) {
      if (!codeEntry || typeof codeEntry !== 'object') {
        continue;
      }

      const code = (codeEntry as Record<string, unknown>).code;
      if (typeof code === 'string' && code.trim() !== '') {
        codes.push(code.trim().toLowerCase());
      }
    }
  }

  return codes;
}

function mapCareTeamParticipants(body: AnyObject): {
  sender?: AssignDoctorParticipant;
  receiver?: AssignDoctorParticipant;
} {
  const participants = body.participant;
  if (!Array.isArray(participants)) {
    return {};
  }

  let sender: AssignDoctorParticipant | undefined;
  let receiver: AssignDoctorParticipant | undefined;

  for (const participant of participants) {
    if (!participant || typeof participant !== 'object') {
      continue;
    }

    const entry = participant as AnyObject;
    const member = entry.member as Record<string, unknown> | undefined;
    const userId = pickString(
      member ? extractReferenceId(member.reference) : undefined,
      member && typeof member.id === 'string' ? member.id : undefined,
    );
    if (!userId) {
      continue;
    }

    const mapped: AssignDoctorParticipant = {
      userId,
      name:
        typeof member?.display === 'string'
          ? member.display
          : extractResourceName(entry),
      userType: readExtensionBySegments(entry.extension, ['user-type', 'usertype']),
      presenceStatus: readExtensionBySegments(entry.extension, [
        'presence-status',
        'presencestatus',
      ]),
    };

    const roleCodes = participantRoleCodes(entry);
    const isPractitionerRole = roleCodes.some((code) =>
      PRACTITIONER_ROLE_CODES.has(code),
    );
    const isPatientRole = roleCodes.some((code) => PATIENT_ROLE_CODES.has(code));

    if (!sender && (isPractitionerRole || !isPatientRole)) {
      sender = {
        ...mapped,
        userType: mapped.userType ?? 'STAFF',
      };
      continue;
    }

    if (!receiver && (isPatientRole || !isPractitionerRole)) {
      receiver = {
        ...mapped,
        userType: mapped.userType ?? 'USER',
      };
    }
  }

  return { sender, receiver };
}

function mapIndexedBundleEntries(
  resources: AnyObject[],
  senderUserId?: string,
): {
  sender?: AssignDoctorParticipant;
  receiver?: AssignDoctorParticipant;
} {
  if (resources.length === 0) {
    return {};
  }

  if (resources.length === 1) {
    const only = resources[0];
    if (only.resourceType === 'Practitioner') {
      return { sender: mapPractitionerToSender(only) };
    }
    if (only.resourceType === 'Patient') {
      return { receiver: mapPatientToReceiver(only) };
    }
    return {};
  }

  const practitioner = resources.find(
    (resource) => resource.resourceType === 'Practitioner',
  );
  const patient = resources.find((resource) => resource.resourceType === 'Patient');
  const sender =
    (practitioner ? mapPractitionerToSender(practitioner) : undefined) ??
    mapResourceToParticipant(resources[0], 'STAFF');
  const receiverCandidate =
    patient ??
    resources.find(
      (resource, index) =>
        index > 0 &&
        extractResourceId(resource) !== senderUserId &&
        extractResourceId(resource) !== sender?.userId,
    ) ??
    resources[1];
  const receiver =
    (patient ? mapPatientToReceiver(patient) : undefined) ??
    mapResourceToParticipant(receiverCandidate, 'USER');

  return { sender, receiver };
}

function readSubjectReferenceReceiver(body: AnyObject): AssignDoctorParticipant | undefined {
  const subject = body.subject;
  if (!subject || typeof subject !== 'object') {
    return undefined;
  }

  const userId = pickString(
    extractReferenceId((subject as Record<string, unknown>).reference),
    typeof (subject as Record<string, unknown>).id === 'string'
      ? ((subject as Record<string, unknown>).id as string)
      : undefined,
  );
  if (!userId) {
    return undefined;
  }

  return {
    userId,
    name:
      typeof (subject as Record<string, unknown>).display === 'string'
        ? ((subject as Record<string, unknown>).display as string)
        : undefined,
    userType: 'USER',
  };
}

function pickParticipant(
  ...candidates: Array<AssignDoctorParticipant | undefined>
): AssignDoctorParticipant | undefined {
  for (const candidate of candidates) {
    if (candidate?.userId) {
      return candidate;
    }
  }

  return undefined;
}

function resolveOrganizationId(req: LambdaRequest, ...sources: AnyObject[]): string | undefined {
  const ctxOrg = (req.context as { userContext?: { organizationId?: string } })
    ?.userContext?.organizationId;

  for (const source of sources) {
    const direct = pickString(
      typeof source.organizationId === 'string' ? source.organizationId : undefined,
      typeof source.organizationID === 'string' ? source.organizationID : undefined,
    );
    if (direct) {
      return direct;
    }

    const fromExtension = readExtensionBySegments(source.extension, [
      'organization-id',
      'organizationid',
    ]);
    if (fromExtension) {
      return fromExtension;
    }
  }

  return pickString(
    getHeader(req, 'x-organization-id'),
    getHeader(req, 'x-organizationid'),
    ctxOrg,
  );
}

function readParametersCanonical(body: AnyObject): Partial<AssignDoctorCanonical> {
  if (body.resourceType !== 'Parameters') {
    return {};
  }

  const parameters = body.parameter;
  if (!Array.isArray(parameters)) {
    return {};
  }

  const values = new Map<string, string>();
  for (const parameter of parameters) {
    if (!parameter || typeof parameter !== 'object') {
      continue;
    }

    const entry = parameter as Record<string, unknown>;
    const name =
      typeof entry.name === 'string' ? entry.name.trim().toLowerCase() : undefined;
    if (!name) {
      continue;
    }

    const scalar = readExtensionScalar(entry);
    if (scalar) {
      values.set(name, scalar);
    }
  }

  const organizationId = pickString(
    values.get('organizationid'),
    values.get('organization-id'),
    values.get('organization'),
  );
  const senderUserId = pickString(
    values.get('senderid'),
    values.get('sender-id'),
    values.get('doctoruserid'),
    values.get('doctor-user-id'),
    values.get('doctorid'),
    values.get('doctor-id'),
    values.get('practitionerid'),
    values.get('practitioner-id'),
  );
  const receiverUserId = pickString(
    values.get('receiverid'),
    values.get('receiver-id'),
    values.get('patientuserid'),
    values.get('patient-user-id'),
    values.get('patientid'),
    values.get('patient-id'),
  );

  const isReferredValue = values.get('isreferred') ?? values.get('is-referred');

  return {
    organizationId,
    sender: senderUserId ? { userId: senderUserId, userType: 'STAFF' } : undefined,
    receiver: receiverUserId
      ? { userId: receiverUserId, userType: 'USER' }
      : undefined,
    isReferred:
      isReferredValue != null ? isReferredValue.toLowerCase() === 'true' : undefined,
  };
}

function readLegacyTopLevelIds(body: AnyObject): {
  sender?: AssignDoctorParticipant;
  receiver?: AssignDoctorParticipant;
} {
  const senderUserId = pickString(
    typeof body.doctorUserId === 'string' ? body.doctorUserId : undefined,
    typeof body.doctorId === 'string' ? body.doctorId : undefined,
    typeof body.senderId === 'string' ? body.senderId : undefined,
    typeof body.practitionerId === 'string' ? body.practitionerId : undefined,
  );
  const receiverUserId = pickString(
    typeof body.patientUserId === 'string' ? body.patientUserId : undefined,
    typeof body.patientId === 'string' ? body.patientId : undefined,
    typeof body.receiverId === 'string' ? body.receiverId : undefined,
  );

  return {
    sender:
      readParticipant(body.sender) ??
      readParticipant(body.doctor) ??
      (senderUserId ? { userId: senderUserId, userType: 'STAFF' } : undefined),
    receiver:
      readParticipant(body.receiver) ??
      readParticipant(body.patient) ??
      (receiverUserId ? { userId: receiverUserId, userType: 'USER' } : undefined),
  };
}

function resolveIsReferred(...sources: AnyObject[]): boolean | undefined {
  for (const source of sources) {
    if (typeof source.isReferred === 'boolean') {
      return source.isReferred;
    }

    const extensionValue = readExtensionBySegments(source.extension, [
      'is-referred',
      'isreferred',
    ]);
    if (extensionValue) {
      return extensionValue.toLowerCase() === 'true';
    }
  }

  return undefined;
}

function readIdFromExtensions(
  segments: string[],
  ...sources: Array<AnyObject | undefined>
): string | undefined {
  for (const source of sources) {
    if (!source) {
      continue;
    }

    const value = readExtensionBySegments(source.extension, segments);
    if (value) {
      return value;
    }
  }

  return undefined;
}

/**
 * Converts inbound FHIR Bundle / resource bodies into the assign-doctor API contract.
 */
export function enrichAssignDoctorFromFhir(
  req: LambdaRequest,
  rawBody: AnyObject,
): AssignDoctorCanonical {
  const parametersCanonical = readParametersCanonical(rawBody);
  const legacyTopLevel = readLegacyTopLevelIds(rawBody);
  const passthroughSender =
    readParticipant(rawBody.sender) ?? legacyTopLevel.sender ?? parametersCanonical.sender;
  const passthroughReceiver =
    readParticipant(rawBody.receiver) ??
    legacyTopLevel.receiver ??
    parametersCanonical.receiver;

  const resources = extractBundleResources(rawBody);
  const practitioner = resources.find((resource) => resource.resourceType === 'Practitioner');
  const patient = resources.find((resource) => resource.resourceType === 'Patient');
  const careTeam =
    rawBody.resourceType === 'CareTeam'
      ? mapCareTeamParticipants(rawBody)
      : resources.find((resource) => resource.resourceType === 'CareTeam')
        ? mapCareTeamParticipants(resources.find((resource) => resource.resourceType === 'CareTeam')!)
        : {};
  const preliminarySenderId = pickString(
    passthroughSender?.userId,
    practitioner ? extractResourceId(practitioner) : undefined,
    readIdFromExtensions(
      ['sender-id', 'doctor-id', 'doctor', 'practitioner-id', 'practitioner'],
      rawBody,
      ...resources,
    ),
  );
  const indexedEntries = mapIndexedBundleEntries(resources, preliminarySenderId);

  const sender = pickParticipant(
    passthroughSender,
    readParticipantFromExtension(rawBody.extension, ['sender']),
    practitioner ? mapPractitionerToSender(practitioner) : undefined,
    careTeam.sender,
    indexedEntries.sender,
    (() => {
      const userId = readIdFromExtensions(
        ['sender-id', 'doctor-id', 'doctor', 'practitioner-id', 'practitioner'],
        rawBody,
        ...resources,
      );
      return userId ? { userId, userType: 'STAFF' } : undefined;
    })(),
    pickString(
      getHeader(req, 'x-sender-id'),
      getHeader(req, 'x-doctor-id'),
      getHeader(req, 'x-practitioner-id'),
    )
      ? {
          userId: pickString(
            getHeader(req, 'x-sender-id'),
            getHeader(req, 'x-doctor-id'),
            getHeader(req, 'x-practitioner-id'),
          )!,
          userType: 'STAFF',
        }
      : undefined,
  );

  const receiver = pickParticipant(
    passthroughReceiver,
    readParticipantFromExtension(rawBody.extension, ['receiver']),
    readParticipantFromExtension(practitioner?.extension, ['receiver', 'patient']),
    patient ? mapPatientToReceiver(patient) : undefined,
    careTeam.receiver,
    indexedEntries.receiver,
    readSubjectReferenceReceiver(rawBody),
    practitioner ? readSubjectReferenceReceiver(practitioner) : undefined,
    (() => {
      const userId = readIdFromExtensions(
        ['receiver-id', 'patient-id', 'patient'],
        rawBody,
        ...resources,
      );
      return userId ? { userId, userType: 'USER' } : undefined;
    })(),
    pickString(getHeader(req, 'x-receiver-id'), getHeader(req, 'x-patient-id'))
      ? {
          userId: pickString(
            getHeader(req, 'x-receiver-id'),
            getHeader(req, 'x-patient-id'),
          )!,
          userType: 'USER',
        }
      : undefined,
  );

  return {
    organizationId:
      parametersCanonical.organizationId ??
      resolveOrganizationId(req, rawBody, ...resources),
    sender,
    receiver,
    isReferred:
      parametersCanonical.isReferred ?? resolveIsReferred(rawBody, ...resources),
  };
}
