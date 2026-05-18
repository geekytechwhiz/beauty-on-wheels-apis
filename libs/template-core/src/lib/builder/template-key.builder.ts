import type { TemplateStatus } from '../constants/template.constants';

export class TemplateKeyBuilder {
  static toMasterPk(templateId: string): string {
    return `MASTER_TMPL#${templateId.trim()}`;
  }

  static toVersionSk(versionId: string): string {
    const id = versionId.trim();
    return id.startsWith('VERSION#') ? id : `VERSION#${id}`;
  }

  static buildGsi2Pk(templateType: string): string {
    return `TYPE#${templateType.trim()}#SCOPE#MASTER`;
  }

  static buildGsi2Sk(publishedAt: string, templateId: string, templateVersionId: string): string {
    return `PUB#${publishedAt}#${templateId}#${templateVersionId}`;
  }

  static buildGsi4Pk(templateCode: string): string {
    return `CODE#${templateCode.trim()}`;
  }

  static buildGsi4Sk(version: number, templateId: string): string {
    return `VER#${String(version).padStart(3, '0')}#${templateId}`;
  }

  static buildGsi5Pk(status: TemplateStatus): string {
    return `SCOPE#MASTER#STATUS#${status}`;
  }

  static buildGsi5Sk(lastModifiedAt: string, templateId: string): string {
    return `TS#${lastModifiedAt}#${templateId}`;
  }
}
