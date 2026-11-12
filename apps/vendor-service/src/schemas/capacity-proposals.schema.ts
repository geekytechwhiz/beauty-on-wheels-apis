import { z } from 'zod';
import { LambdaRequest } from '@api-hub/utils';
import { EventSchemaError } from '@api-hub/middleware';

import { MAX_PROPOSAL_QUANTITY } from '../domain/capacity-commitment';
import { CAPACITY_PROPOSAL_STATUS_VALUES } from '../domain/capacity-proposal';

const id = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
const communityId = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const isoDateTime = z.string().datetime({ offset: true });
const quantity = z.number().int().min(1).max(MAX_PROPOSAL_QUANTITY);
const note = z.string().trim().min(1).max(500);

/** Wire scope for creates: offeringId is the sole authoritative package identifier. */
export const PackageScopeSchema = z
  .object({
    offeringId: id,
    label: z.string().trim().min(1).max(120),
  })
  .strict();

export const ServiceWindowSchema = z
  .object({
    startDate: date,
    endDate: date,
    dailyWindow: z.object({ startTime: time, endTime: time }).strict(),
    daysOfWeek: z
      .array(
        z.enum([
          'MONDAY',
          'TUESDAY',
          'WEDNESDAY',
          'THURSDAY',
          'FRIDAY',
          'SATURDAY',
          'SUNDAY',
        ]),
      )
      .max(7)
      .optional(),
  })
  .strict();

export const PayoutRateSchema = z
  .object({
    amountMinor: z.number().int().min(1).max(1_000_000_000),
    currency: z.literal('INR'),
  })
  .strict();

/** Accept `scope` / `window` as aliases of `packageScope` / `serviceWindow`. */
function withAliases(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }
  const body = { ...(input as Record<string, unknown>) };
  if (body.packageScope === undefined && body.scope !== undefined) {
    body.packageScope = body.scope;
  }
  if (body.serviceWindow === undefined && body.window !== undefined) {
    body.serviceWindow = body.window;
  }
  delete body.scope;
  delete body.window;
  return body;
}

/** Missing body on action routes is an empty object. */
function emptyToObject(input: unknown): unknown {
  return input === undefined || input === null || input === '' ? {} : input;
}

export const CreateCapacityProposalRequestSchema = z.preprocess(
  withAliases,
  z
    .object({
      vendorId: id,
      communityId,
      packageScope: PackageScopeSchema,
      serviceWindow: ServiceWindowSchema,
      quantity,
      responseDeadline: isoDateTime,
      proposedPayoutRate: PayoutRateSchema,
      /** false creates a DRAFT; send it later with /send. Default true. */
      sendImmediately: z.boolean().optional(),
      /** Optional audit note stored on the CREATE history entry. */
      note: note.optional(),
    })
    .strict(),
);

export const SendCapacityProposalRequestSchema = z.preprocess(
  emptyToObject,
  z.object({ responseDeadline: isoDateTime.optional() }).strict(),
);

export const ReviseCapacityProposalRequestSchema = z
  .object({
    quantity: quantity.optional(),
    proposedPayoutRate: PayoutRateSchema.optional(),
    responseDeadline: isoDateTime,
    note: note.optional(),
  })
  .strict();

export const DeclineCapacityProposalRequestSchema = z.preprocess(
  emptyToObject,
  z.object({ reason: note.optional(), note: note.optional() }).strict(),
);

export const AcceptCapacityProposalRequestSchema = z.preprocess(
  emptyToObject,
  z.object({ note: note.optional() }).strict(),
);

export const CounterCapacityProposalRequestSchema = z
  .object({
    quantity: quantity.optional(),
    payoutRate: PayoutRateSchema.optional(),
    note: note.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.quantity !== undefined
      || value.payoutRate !== undefined
      || value.note !== undefined,
    { message: 'A counter needs a quantity, payoutRate, or note' },
  );

export const ListCapacityProposalsQuerySchema = z
  .object({
    vendorId: id.optional(),
    communityId: communityId.optional(),
    status: z.enum(CAPACITY_PROPOSAL_STATUS_VALUES).optional(),
    limit: z.union([z.string(), z.number()]).optional(),
    cursor: z.string().optional(),
  })
  .passthrough();

export type CreateCapacityProposalRequest = z.infer<typeof CreateCapacityProposalRequestSchema>;
export type SendCapacityProposalRequest = z.infer<typeof SendCapacityProposalRequestSchema>;
export type ReviseCapacityProposalRequest = z.infer<typeof ReviseCapacityProposalRequestSchema>;
export type DeclineCapacityProposalRequest = z.infer<typeof DeclineCapacityProposalRequestSchema>;
export type AcceptCapacityProposalRequest = z.infer<typeof AcceptCapacityProposalRequestSchema>;
export type CounterCapacityProposalRequest = z.infer<typeof CounterCapacityProposalRequestSchema>;

function parse<S extends z.ZodType>(schema: S, req: LambdaRequest): z.output<S> {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw new EventSchemaError('Request validation failed', result.error);
  }
  req.body = result.data;
  return result.data;
}

export const validateCreateCapacityProposalRequest = (req: LambdaRequest) =>
  parse(CreateCapacityProposalRequestSchema, req);
export const validateSendCapacityProposalRequest = (req: LambdaRequest) =>
  parse(SendCapacityProposalRequestSchema, req);
export const validateReviseCapacityProposalRequest = (req: LambdaRequest) =>
  parse(ReviseCapacityProposalRequestSchema, req);
export const validateDeclineCapacityProposalRequest = (req: LambdaRequest) =>
  parse(DeclineCapacityProposalRequestSchema, req);
export const validateAcceptCapacityProposalRequest = (req: LambdaRequest) =>
  parse(AcceptCapacityProposalRequestSchema, req);
export const validateCounterCapacityProposalRequest = (req: LambdaRequest) =>
  parse(CounterCapacityProposalRequestSchema, req);
