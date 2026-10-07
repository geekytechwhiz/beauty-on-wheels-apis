import {
  customizeAccessToken,
  type PreTokenGenerationEvent,
} from '../auth/pre-token-generation';

/**
 * Cognito Pre Token Generation trigger.
 * The user pool must invoke this function with LambdaVersion V2_0 so the
 * `roles` array is written onto the access token. `sub` stays the Cognito id.
 */
export async function handler(
  event: PreTokenGenerationEvent,
): Promise<PreTokenGenerationEvent> {
  return customizeAccessToken(event);
}
