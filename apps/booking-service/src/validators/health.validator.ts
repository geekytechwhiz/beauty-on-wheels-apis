import {HealthSchema} from '../schemas/health.schema';
export const validateHealthRequest=(r:any)=>HealthSchema.parse(r);