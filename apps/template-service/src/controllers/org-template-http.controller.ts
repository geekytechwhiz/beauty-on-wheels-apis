import { normalizeTemplateServiceError, OrgTemplateService } from '@api-hub/template-core';
import { BaseError, type LambdaRequest } from '@api-hub/utils';

import type {
  ValidatedCloneOrgTemplate,
  ValidatedGetOrgVersionStatus,
  ValidatedListOrg,
  ValidatedSetOrgTemplateEnable,
  ValidatedGetOrgTemplateRules,
  ValidatedUpdateOrgTemplateRules,
  ValidatedCreateOrgDerived,
  ValidatedUpdateOrgDerived,
  ValidatedAdoptOrgDerived,
} from '../validators/request.validators';
import { withNextPaginationKey } from '../utils/list-response.mapper';
import { resolveTemplateLevelFromQuery } from '../validators/template-level.util';

let orgTemplateService: OrgTemplateService | undefined;

function getOrgTemplateService(): OrgTemplateService {
  if (!orgTemplateService) orgTemplateService = new OrgTemplateService();
  return orgTemplateService;
}

let ctrl: OrgTemplateHttpController | undefined;

export function getOrgTemplateHttpController(): OrgTemplateHttpController {
  if (!ctrl) ctrl = new OrgTemplateHttpController();
  return ctrl;
}

export class OrgTemplateHttpController {
  private readonly svc = getOrgTemplateService();

  async handleCloneToOrg(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedCloneOrgTemplate?: ValidatedCloneOrgTemplate })
      .validatedCloneOrgTemplate;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      const result = await this.svc.cloneTemplateVersion({
        organizationId: v.organizationId,
        masterTemplateId: v.templateId,
        masterVersionId: v.versionId,
        body: v.body,
        actorUser: v.actorUser,
      });
      const organizationMeta = v.body?.organizationMeta
        ? {
            id: v.body.organizationMeta.id,
            name: v.body.organizationMeta.name.trim(),
            active: v.body.organizationMeta.active,
            country: v.body.organizationMeta.country,
            updated: v.body.organizationMeta.updated,
            description: v.body.organizationMeta.description ?? null,
          }
        : {
            id: v.organizationId,
            name: v.organizationId,
            description: null,
          };
      return this.svc.toDeriveEnableResponse(result, {
        organizationMeta,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'clone_org_template_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleSetOrgTemplateEnable(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedSetOrgTemplateEnable?: ValidatedSetOrgTemplateEnable })
      .validatedSetOrgTemplateEnable;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.setOrgTemplateEnablement({
        organizationId: v.organizationId,
        masterTemplateId: v.masterTemplateId,
        templateEnabled: v.body.templateEnabled,
        organizationMeta: v.body.organizationMeta
          ? {
              id: v.body.organizationMeta.id,
              name: v.body.organizationMeta.name,
              active: v.body.organizationMeta.active,
              country: v.body.organizationMeta.country,
              updated: v.body.organizationMeta.updated,
              description: v.body.organizationMeta.description ?? null,
            }
          : undefined,
        organizationName: v.body.organizationMeta?.name,
        organizationDescription: v.body.organizationMeta?.description ?? undefined,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'set_org_template_enable_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleGetOrgVersionStatus(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedGetOrgVersionStatus?: ValidatedGetOrgVersionStatus })
      .validatedGetOrgVersionStatus;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.getOrgVersionStatus({
        organizationId: v.organizationId,
        masterTemplateId: v.masterTemplateId,
        organizationName: v.query.organizationName,
        organizationDescription: v.query.organizationDescription,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'get_org_version_status_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleGetOrgTemplateRules(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedGetOrgTemplateRules?: ValidatedGetOrgTemplateRules })
      .validatedGetOrgTemplateRules;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.getOrgTemplateRules({
        masterTemplateId: v.masterTemplateId,
        organizationId: v.organizationId,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'get_org_template_rules_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleUpdateOrgTemplateRules(req: LambdaRequest) {
    const v = (
      req as LambdaRequest & { validatedUpdateOrgTemplateRules?: ValidatedUpdateOrgTemplateRules }
    ).validatedUpdateOrgTemplateRules;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.updateOrgTemplateRules({
        masterTemplateId: v.masterTemplateId,
        organizationId: v.organizationId,
        rules: v.body.rules,
        fieldValues: v.body.fieldValues,
        actorUser: v.actorUser,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'update_org_template_rules_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleListOrg(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedListOrg?: ValidatedListOrg }).validatedListOrg;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      if (resolveTemplateLevelFromQuery(req) === 'ORG_DERIVED') {
        if (!v.organizationId) {
          throw new BaseError(
            'organizationId is required when templateLevel=ORG_DERIVED',
            400,
            'VALIDATION_ERROR',
            [{ message: 'organizationId is required when templateLevel=ORG_DERIVED' }],
          );
        }

        const result = await this.svc.getOrgDerived({
          organizationId: v.organizationId,
          orgTemplateId: v.query.orgTemplateId,
          categoryCode: v.query.categoryCode ?? v.query.category,
          conditionCode: v.query.conditionCode,
          condition: v.query.condition,
          specialty: v.query.specialty,
          templateType: v.query.templateType,
          templateName: v.query.templateName,
          templateEnabled: v.templateEnabledFilter,
          nextToken: v.query.nextToken ?? v.query.nextPaginationKey,
        });

        if (v.query.orgTemplateId?.trim()) {
          return result;
        }

        return withNextPaginationKey(
          result as Parameters<typeof withNextPaginationKey>[0],
        );
      }

      return withNextPaginationKey(
        await this.svc.listOrgEnabled({
          organizationId: v.organizationId,
          organizationName: v.query.organizationName,
          organizationDescription: v.query.organizationDescription,
          country: v.query.country,
          categoryCode: v.query.categoryCode ?? v.query.category,
          condition: v.query.condition,
          conditionCode: v.query.conditionCode,
          templateType: v.query.templateType,
          templateName: v.query.templateName,
          templateId: v.query.templateId,
          templateEnabled: v.templateEnabledFilter,
          nextToken: v.query.nextToken ?? v.query.nextPaginationKey,
        }),
      );
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'list_org_templates_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleCreateOrgDerived(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedCreateOrgDerived?: ValidatedCreateOrgDerived })
      .validatedCreateOrgDerived;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.createOrgDerived({
        organizationId: v.organizationId,
        sourceOrgTemplateId: v.body.sourceOrgTemplateId,
        newTemplateName: v.body.newTemplateName,
        sourceVersionId: v.body.sourceVersionId,
        templateEnabled: v.body.templateEnabled,
        organizationMeta: v.body.organizationMeta
          ? {
              id: v.body.organizationMeta.id,
              name: v.body.organizationMeta.name?.trim() || v.body.organizationMeta.id,
              description: v.body.organizationMeta.description ?? null,
            }
          : undefined,
        actorUser: v.actorUser,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'create_org_derived_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleUpdateOrgDerived(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedUpdateOrgDerived?: ValidatedUpdateOrgDerived })
      .validatedUpdateOrgDerived;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.updateOrgDerived({
        organizationId: v.organizationId,
        orgTemplateId: v.orgTemplateId,
        rules: v.body.rules,
        fieldValues: v.body.fieldValues,
        templateEnabled: v.body.templateEnabled,
        status: v.body.status,
        active: v.body.active,
        actorUser: v.actorUser,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'update_org_derived_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }

  async handleAdoptOrgDerived(req: LambdaRequest) {
    const v = (req as LambdaRequest & { validatedAdoptOrgDerived?: ValidatedAdoptOrgDerived })
      .validatedAdoptOrgDerived;

    if (!v) {
      throw new BaseError(
        'Request was not validated before controller',
        500,
        'INTERNAL_ERROR',
        [{ message: 'Request was not validated before controller' }],
      );
    }

    try {
      return await this.svc.adoptOrgDerived({
        organizationId: v.organizationId,
        orgTemplateId: v.orgTemplateId,
        confirm: v.body.confirm,
        preserveLocalOverrides: v.body.preserveLocalOverrides,
        actorUser: v.actorUser,
      });
    } catch (e: unknown) {
      normalizeTemplateServiceError(e, {
        logEvent: 'adopt_org_derived_error',
        correlationId: req.context.correlationId as string,
      });
    }
  }
}
