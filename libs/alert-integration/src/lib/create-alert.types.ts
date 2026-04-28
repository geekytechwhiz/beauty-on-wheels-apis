import type { CreateAlertInput } from '@api-hub/alert-repository';

/** Create use-case input: same as persistence shape, but `inputEventId` / `inputType` / `sourceType` may be omitted (defaults apply). */
export type CreateAlertPayload = Omit<CreateAlertInput, 'inputEventId' | 'inputType' | 'sourceType'> & {
  inputEventId?: string;
  inputType?: string;
  sourceType?: string;
};
