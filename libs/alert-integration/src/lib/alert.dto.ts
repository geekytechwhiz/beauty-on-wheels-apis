import type { AlertRecord } from '@api-hub/alert-repository';

export function toPublicAlert(r: AlertRecord) {
  const { pk, sk, gsi1pk, gsi1sk, gsi2pk, gsi2sk, gsi3pk, gsi3sk, ...rest } = r;
  return rest;
}
