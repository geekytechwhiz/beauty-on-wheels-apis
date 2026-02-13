import { z } from 'zod';

/** Common schema fragments reused across operations. */
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const partnerIdSchema = z.string().min(1).max(128);
export const orderIdSchema = z.string().min(1).max(256);
