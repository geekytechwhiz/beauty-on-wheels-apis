/**
 * User snapshot stored on template meta and version history (from JWT / authorizer).
 * Never accept client-supplied opaque keys — always resolve from the access token server-side.
 */
export interface TemplateActorUser {
  userId: string;
  email?: string;
  displayName?: string;
  role?: string;
}
