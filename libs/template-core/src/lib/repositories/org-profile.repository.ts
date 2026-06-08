import { BaseRepository } from '@api-hub/utils';

import { TemplateKeyBuilder } from '../builder/template-key.builder';
import { ENTITY_TYPE_ORG_PROFILE, ORG_PROFILE_SK } from '../constants/template.constants';
import type { OrgProfileDdbRecord, OrgProfileMeta } from '../models/persistence/org-profile.model';
import { assertTemplateTable } from '../utils/template.utils';

export class OrgProfileRepository extends BaseRepository {
  async getOrgProfile(organizationId: string): Promise<OrgProfileDdbRecord | null> {
    const table = assertTemplateTable();
    return this.get<OrgProfileDdbRecord>(table, {
      pk: TemplateKeyBuilder.buildGsi1OrgPk(organizationId),
      sk: ORG_PROFILE_SK,
    });
  }

  async putOrgProfile(meta: OrgProfileMeta): Promise<void> {
    const table = assertTemplateTable();
    const organizationId = meta.id.trim();
    const record: OrgProfileDdbRecord = {
      pk: TemplateKeyBuilder.buildGsi1OrgPk(organizationId),
      sk: ORG_PROFILE_SK,
      entityType: ENTITY_TYPE_ORG_PROFILE,
      meta: {
        ...meta,
        id: organizationId,
        name: meta.name.trim(),
        country: meta.country?.trim() || undefined,
        updated:
          meta.updated === undefined || meta.updated === null
            ? new Date().toISOString()
            : String(meta.updated).trim() || new Date().toISOString(),
      },
    };
    await this.put(table, record);
  }
}
