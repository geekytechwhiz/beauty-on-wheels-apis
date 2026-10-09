import {
  customizeAccessToken,
  type PreTokenGenerationEvent,
} from '../auth/pre-token-generation';

/**
 * Cognito Pre Token Generation trigger.
 * The user pool must invoke this function with LambdaVersion V2_0 so the
 * Persisted identityId, userType, compatible role, and roles claims are added
 * to the access token. Cognito's `sub` stays the Cognito identity id.
 */
export async function handler(
  event: PreTokenGenerationEvent,
): Promise<PreTokenGenerationEvent> {
  return customizeAccessToken(event);
}
