import { z } from 'zod';
import { UserListContext, UserListContextValues } from '../types/user-list-context.enum';

const filtersSchema = z.object({
  userTypes: z.array(z.string()).optional(),
  roleCodes: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  isRpmUser: z.boolean().optional(),
  doctorId: z.string().optional(),
  patientId: z.string().optional(),
  search: z.string().optional(),
  status: z.string().optional(),
}).optional();

const paginationSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().nullable().optional(),
}).optional();

const sortSchema = z.object({
  field: z.string().optional().default('createdDate'),
  order: z.enum(['ASC', 'DESC']).optional().default('DESC'),
}).optional();

export const v2UserListSchema = z.object({
  organizationId: z.string().min(1, 'organizationId is required'),
  context: z.nativeEnum(UserListContext, {
    errorMap: () => ({ message: `context must be one of: ${UserListContextValues.join(', ')}` }),
  }),
  filters: filtersSchema,
  pagination: paginationSchema,
  sort: sortSchema,
}).superRefine((data, ctx) => {
  if (data.context === UserListContext.DOCTOR_PATIENT_LIST && !data.filters?.doctorId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'doctorId is required for DOCTOR_PATIENT_LIST context',
      path: ['filters', 'doctorId'],
    });
  }
  
  if (data.context === UserListContext.PATIENT_CARE_TEAM && !data.filters?.patientId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'patientId is required for PATIENT_CARE_TEAM context',
      path: ['filters', 'patientId'],
    });
  }
});

export type V2UserListInput = z.infer<typeof v2UserListSchema>;
