import type { Message } from '@api-hub/utils';

function msg(title: string, description: string, severity: Message['severity'] = 'SUCCESS'): Message {
  return { title, description, severity };
}

/** Success messages keyed by handler `operation` (see withTemplateApiHandler). */
export const TEMPLATE_API_MESSAGES: Record<string, Message> = {
  'template.master.upsert': msg(
    'MASTER_TEMPLATE_SAVED',
    'Master template saved successfully.',
  ),
  'template.master.create': msg(
    'MASTER_TEMPLATE_CREATED',
    'Master template created successfully.',
  ),
  'template.list': msg(
    'TEMPLATES_LISTED',
    'Templates retrieved successfully.',
  ),
  'template.versions.get': msg(
    'TEMPLATE_VERSIONS_RETRIEVED',
    'Template versions and history retrieved successfully.',
  ),
  'template.derive': msg(
    'ORG_TEMPLATE_ENABLED',
    'Master template enabled for the organization successfully.',
  ),
  'template.derive.update': msg(
    'ORG_TEMPLATE_ENABLEMENT_UPDATED',
    'Org template enablement updated successfully.',
  ),
  'template.org.clone': msg(
    'ORG_TEMPLATE_CLONED',
    'Org template copied from master successfully.',
  ),
  'template.org.list': msg(
    'ORG_TEMPLATE_CATALOG',
    'Org enable catalog retrieved successfully.',
  ),
  'template.org.version-status': msg(
    'ORG_TEMPLATE_VERSION_STATUS',
    'Org template version status retrieved successfully.',
  ),
  'template.org.version.update': msg(
    'ORG_TEMPLATE_UPDATED',
    'Org template updated successfully.',
  ),
  'template.org.versions.get': msg(
    'ORG_VERSIONS_RETRIEVED',
    'Org template versions retrieved successfully.',
  ),
  'template.status.transition': msg(
    'TEMPLATE_STATUS_UPDATED',
    'Template status updated successfully.',
  ),
  'template.compatible.list': msg(
    'COMPATIBLE_TEMPLATES_LISTED',
    'Compatible published templates retrieved successfully.',
  ),
  'template.master.version.update': msg(
    'MASTER_VERSION_UPDATED',
    'Master template version updated successfully.',
  ),
  'template.version.update': msg(
    'TEMPLATE_VERSION_UPDATED',
    'Template version updated successfully.',
  ),
  'org-enablement.create': msg(
    'ENABLEMENT_CREATED',
    'Org template enablement created successfully.',
  ),
  'org-enablement.search': msg(
    'ENABLEMENTS_LISTED',
    'Org enablements retrieved successfully.',
  ),
  'org-enablement.list-by-org': msg(
    'ENABLEMENTS_LISTED',
    'Org enablements retrieved successfully.',
  ),
  'org-enablement.get-by-id': msg(
    'ENABLEMENT_RETRIEVED',
    'Org enablement retrieved successfully.',
  ),
  'org-enablement.patch': msg(
    'ENABLEMENT_UPDATED',
    'Org enablement updated successfully.',
  ),
  'template-config.list': msg(
    'TEMPLATE_CONFIGS_LISTED',
    'Template UI configs retrieved successfully.',
  ),
  'template-config.get': msg(
    'TEMPLATE_CONFIG_RETRIEVED',
    'Template UI config retrieved successfully.',
  ),
  'template-config.create': msg(
    'TEMPLATE_CONFIG_CREATED',
    'Template UI config created successfully.',
  ),
  'template-config.update': msg(
    'TEMPLATE_CONFIG_UPDATED',
    'Template UI config updated successfully.',
  ),
  'template-config.meta': msg(
    'TEMPLATE_CONFIG_META_RETRIEVED',
    'Template config metadata retrieved successfully.',
  ),
};

export const MASTER_TEMPLATE_CREATED = msg(
  'MASTER_TEMPLATE_CREATED',
  'Master template created successfully.',
);

export const MASTER_TEMPLATE_UPDATED = msg(
  'MASTER_TEMPLATE_UPDATED',
  'Master template updated successfully.',
);

export const ORG_ENABLE_CATALOG = msg(
  'ORG_ENABLED_TEMPLATES_LISTED',
  'Enabled master templates for organizations retrieved successfully.',
);

export const MASTER_TEMPLATES_LISTED = msg(
  'TEMPLATES_LISTED',
  'Master templates retrieved successfully.',
);
