import { isProductionStage } from './args';
import type { DestinationKind } from './types';

export function isActiveIdentityStatus(status?: string): boolean {
  return (status ?? '').trim().toLowerCase() === 'active';
}

/**
 * Stage verification policy for the destination that completed OTP.
 * Production requires the channel used for OTP to be verified on META.
 * Non-production matches the repository authority: any verified email or phone.
 * `--allow-unverified` is refused for production by argument parsing.
 */
export function meetsDestinationVerificationPolicy(input: {
  stage: string;
  destinationKind: DestinationKind;
  emailVerified: boolean;
  phoneVerified: boolean;
  allowUnverified: boolean;
}): boolean {
  if (input.allowUnverified && !isProductionStage(input.stage)) {
    return true;
  }

  if (isProductionStage(input.stage)) {
    return input.destinationKind === 'email'
      ? input.emailVerified === true
      : input.phoneVerified === true;
  }

  return input.emailVerified === true || input.phoneVerified === true;
}

export function destinationKindOf(destination: string): DestinationKind {
  return destination.includes('@') ? 'email' : 'phone';
}
