export type { PatientFetchResult, PatientSourceAdapter, PatientSourceAdapterKey } from './patient-source.types';
export { getPatientSourceAdapter } from './patient-source.registry';
export {
  UserServicePatientAdapter,
  createUserServicePatientAdapter,
  mapUserServiceResponseToCanonical,
} from './user-service.patient.adapter'; 
