import { z } from 'zod';

/** Coerce legacy "Family" / "Friend" to uppercase for enum. */
const relationSchema = z
  .string()
  .transform((s) => (s ?? '').trim().toUpperCase())
  .refine((s) => s === 'FRIEND' || s === 'FAMILY', {
    message: "Relation can only be one of 'Friend' and 'Family'.",
  });

const relationOptionalSchema = z.optional(
  z.string().transform((s) => (s ?? '').trim().toUpperCase()).refine((s) => s === 'FRIEND' || s === 'FAMILY', {
    message: "Relation can only be one of 'Friend' and 'Family'.",
  })
);

/** Legacy request body: add member friend family. organizationID can come from authorizer. */
export const addMemberFriendFamilySchema = z
  .object({
    organizationID: z.string().min(1, 'Organization ID is required').optional(),
    userId: z.string().min(1, 'User Id is required').optional(),
    memberId: z.string().min(1, 'Member ID is required'),
    userName: z.string().min(1, 'User name is required'),
    memberName: z.string().min(1, 'Member name is required'),
    relation: relationSchema,
    relationship: z.string(),
    emergencyContact: z.boolean().refine((val) => typeof val === 'boolean', {
      message: 'Emergency contact is required',
    }),
    manageHealth: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if ((data.relation ?? '').toUpperCase() === 'FAMILY') return (data.relationship ?? '').trim().length > 0;
      return true;
    },
    { message: 'Relationship is required when relation is FAMILY', path: ['relationship'] }
  );

/** Legacy request body: friend family search. organizationID / userID can come from authorizer. */
export const friendFamilySearchSchema = z
  .object({
    organizationID: z.string().min(1, 'Organization is required').optional(),
    userID: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    fullName: z.string().min(1, 'Full name is required'),
    invite: z.string().min(1, 'Invite is required'),
    relation: relationSchema,
    relationship: z.string().optional(),
    emergencyContact: z.boolean().refine((val) => typeof val === 'boolean', {
      message: 'Emergency contact is required',
    }),
    roles: z.array(z.string()).optional(),
  })
  .refine(
    (data) => {
      const e = (data.email ?? '').toString().trim();
      const p = (data.phone ?? '').toString().trim();
      return e.length > 0 || p.length > 0;
    },
    { message: 'Either email or phone is required', path: ['email'] }
  );

/** Legacy request body: update friend family. */
export const updateFriendFamilySchema = z.object({
  organizationID: z.string().min(1, 'Organization ID is required').optional(),
  memberId: z.string().min(1, 'Member ID is required'),
  fullName: z.string().optional(),
  relation: relationOptionalSchema,
  relationship: z.string().optional(),
  emergencyContact: z.boolean().optional(),
  manageHealth: z.boolean().optional(),
});

/** Legacy request body: fetch friend family (invitees and inviters for a user). */
export const fetchFriendFamilySchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

/** Legacy request body: delete friend family. */
export const deleteFriendFamilySchema = z.object({
  userID: z.string().min(1, 'User ID is required'),
  memberID: z.string().min(1, 'Member ID is required'),
  organizationID: z.string().optional(),
});
