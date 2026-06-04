import type { TemplateStatus } from '../constants/template.constants';

export class TemplateKeyBuilder {
  static toMasterPk(templateId: string): string {
    return `MASTER_TMPL#${templateId.trim()}`;
  }

  static toOrgPk(organizationId: string, templateId: string): string {
    return `ORG_TMPL#${organizationId.trim()}#${templateId.trim()}`;
  }

  static buildGsi1OrgPk(organizationId: string): string {
    return `ORG#${organizationId.trim()}`;
  }

  static buildGsi1OrgTemplateSk(
    templateType: string,
    status: TemplateStatus,
    lastModifiedAt: string,
    templateId: string,
  ): string {
    return `TMPL#${templateType.trim()}#${status}#${lastModifiedAt}#${templateId.trim()}`;
  }

  static toEnablePk(enablementId: string): string {
    const id = enablementId.trim();
    return id.startsWith('ENABLE#') ? id : `ENABLE#${id}`;
  }

  static buildGsi1EnableSk(effectiveFrom: string, enablementId: string): string {
    return `ENABLE#${effectiveFrom}#${enablementId.trim()}`;
  }

  static buildGsi3Pk(masterTemplateVersionId: string): string {
    return `MSTR_VER#${masterTemplateVersionId.trim()}`;
  }

  static buildGsi3Sk(organizationId: string, enablementId: string): string {
    return `ORG#${organizationId.trim()}#${enablementId.trim()}`;
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

  /** GSI5 access pattern: all org enablements for a master template id. */
  static buildGsi5EnableMasterPk(masterTemplateId: string): string {
    return `MSTR_TMPL#${masterTemplateId.trim()}`;
  }

  static buildGsi5EnableSk(organizationId: string, enablementId: string): string {
    return `ENABLE#ORG#${organizationId.trim()}#${enablementId.trim()}`;
  }
}
