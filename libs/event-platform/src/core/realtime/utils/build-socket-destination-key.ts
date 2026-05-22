export type SocketDestinationInput =
  | { kind: 'user'; userId: string }
  | { kind: 'org'; organizationId: string; channel: string }
  | { kind: 'patient'; patientId: string };

function stripOrgPrefix(id: string): string {
  return id.trim().replace(/^ORG#/i, '');
}

function stripUserPrefix(id: string): string {
  return id.trim().replace(/^USER#/i, '');
}

function stripPatientPrefix(id: string): string {
  return id.trim().replace(/^PATIENT#/i, '');
}

export function buildSocketDestinationKey(input: SocketDestinationInput): string {
  switch (input.kind) {
    case 'user':
      return `USER#${stripUserPrefix(input.userId)}`;
    case 'org':
      return `ORG#${stripOrgPrefix(input.organizationId)}#${input.channel.trim()}`;
    case 'patient':
      return `PATIENT#${stripPatientPrefix(input.patientId)}`;
  }
}
