import type { CreateAlertInput } from '@api-hub/alert-repository';

/** Use-case input for {@link AlertService.createAlert}; same shape as persistence (`inputType` / `sourceType` required). */
export type CreateAlertPayload = CreateAlertInput;
