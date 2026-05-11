import type { RuntimeTemplateBinding } from '../domain';

export interface RuntimeBindingRepository {
  getRuntimeBinding(patientId: string, templateId: string): Promise<RuntimeTemplateBinding | null>;
  bindRuntimeVersion(binding: RuntimeTemplateBinding): Promise<RuntimeTemplateBinding>;
}
