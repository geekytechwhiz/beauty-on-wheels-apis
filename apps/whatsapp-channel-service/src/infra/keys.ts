export const conversationPk = (channelUserId: string): string => `CONV#${channelUserId}`;
export const identityPk = (channelUserId: string): string => `IDENT#WHATSAPP#${channelUserId}`;
export const consentPk = (channelUserId: string): string => `CONSENT#WHATSAPP#${channelUserId}`;
export const eventPk = (eventId: string): string => `MSG#${eventId}`;

export const SK = {
  STATE: 'STATE',
  IDENTITY: 'IDENTITY',
  MARKETING: 'MARKETING',
  PROCESSED: 'PROCESSED',
} as const;
