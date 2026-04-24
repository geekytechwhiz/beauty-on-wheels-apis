import { withLambdaHandler } from '@api-hub/middleware';
import type { LambdaRequest } from '@api-hub/utils';
import type { CreateMetadataDefinitionUseCase } from '../../application/use-cases/create-metadata-definition.use-case';
import type { DeleteMetadataDefinitionUseCase } from '../../application/use-cases/delete-metadata-definition.use-case';
import type { GetMetadataDefinitionUseCase } from '../../application/use-cases/get-metadata-definition.use-case';
import type { ListApplicableMetadataUseCase } from '../../application/use-cases/list-applicable-metadata.use-case';
import type { ListMetadataByTypeUseCase } from '../../application/use-cases/list-metadata-by-type.use-case';
import type { ListMetadataVersionsUseCase } from '../../application/use-cases/list-metadata-versions.use-case';
import type { UpsertMetadataDefinitionUseCase } from '../../application/use-cases/upsert-metadata-definition.use-case';
import { ensureHttpError } from '../http-error.mapper';
import {
  validateCreateMetadataDefinition,
  validateDeleteMetadataDefinition,
  validateGetMetadataDefinition,
  validateListApplicableMetadata,
  validateListMetadataByType,
  validateListMetadataVersions,
  validateUpsertMetadataDefinition,
} from '../request.validators';

export function buildListApplicableMetadataHandler(useCase: ListApplicableMetadataUseCase) {
  return withLambdaHandler(
    async (req: LambdaRequest) => {
      try {
        return await useCase.execute(
          (req as LambdaRequest & { validatedListApplicableMetadata: Parameters<ListApplicableMetadataUseCase['execute']>[0] })
            .validatedListApplicableMetadata,
        );
      } catch (error) {
        throw ensureHttpError(error);
      }
    },
    {
      validator: validateListApplicableMetadata,
      successMessageKey: 'METADATA.METADATA_APPLICABLE_LIST_SUCCESS',
    },
  );
}

export function buildListMetadataByTypeHandler(useCase: ListMetadataByTypeUseCase) {
  return withLambdaHandler(
    async (req: LambdaRequest) => {
      try {
        return await useCase.execute(
          (req as LambdaRequest & { validatedListMetadataByType: Parameters<ListMetadataByTypeUseCase['execute']>[0] })
            .validatedListMetadataByType,
        );
      } catch (error) {
        throw ensureHttpError(error);
      }
    },
    {
      validator: validateListMetadataByType,
      successMessageKey: 'METADATA.METADATA_LIST_SUCCESS',
    },
  );
}

export function buildListMetadataVersionsHandler(useCase: ListMetadataVersionsUseCase) {
  return withLambdaHandler(
    async (req: LambdaRequest) => {
      try {
        return await useCase.execute(
          (req as LambdaRequest & { validatedListMetadataVersions: Parameters<ListMetadataVersionsUseCase['execute']>[0] })
            .validatedListMetadataVersions,
        );
      } catch (error) {
        throw ensureHttpError(error);
      }
    },
    {
      validator: validateListMetadataVersions,
      successMessageKey: 'METADATA.METADATA_VERSIONS_LIST_SUCCESS',
    },
  );
}

export function buildGetMetadataDefinitionHandler(useCase: GetMetadataDefinitionUseCase) {
  return withLambdaHandler(
    async (req: LambdaRequest) => {
      try {
        return await useCase.execute(
          (req as LambdaRequest & { validatedGetMetadataDefinition: Parameters<GetMetadataDefinitionUseCase['execute']>[0] })
            .validatedGetMetadataDefinition,
        );
      } catch (error) {
        throw ensureHttpError(error);
      }
    },
    {
      validator: validateGetMetadataDefinition,
      successMessageKey: 'METADATA.METADATA_GET_SUCCESS',
    },
  );
}

export function buildCreateMetadataDefinitionHandler(useCase: CreateMetadataDefinitionUseCase) {
  return withLambdaHandler(
    async (req: LambdaRequest) => {
      try {
        return await useCase.execute(
          (req as LambdaRequest & { validatedCreateMetadataDefinition: Parameters<CreateMetadataDefinitionUseCase['execute']>[0] })
            .validatedCreateMetadataDefinition,
        );
      } catch (error) {
        throw ensureHttpError(error);
      }
    },
    {
      validator: validateCreateMetadataDefinition,
      successMessageKey: 'METADATA.METADATA_CREATE_SUCCESS',
      useCreated: true,
    },
  );
}

export function buildUpsertMetadataDefinitionHandler(useCase: UpsertMetadataDefinitionUseCase) {
  return withLambdaHandler(
    async (req: LambdaRequest) => {
      try {
        return await useCase.execute(
          (req as LambdaRequest & { validatedUpsertMetadataDefinition: Parameters<UpsertMetadataDefinitionUseCase['execute']>[0] })
            .validatedUpsertMetadataDefinition,
        );
      } catch (error) {
        throw ensureHttpError(error);
      }
    },
    {
      validator: validateUpsertMetadataDefinition,
      successMessageKey: 'METADATA.METADATA_UPSERT_SUCCESS',
    },
  );
}

export function buildDeleteMetadataDefinitionHandler(useCase: DeleteMetadataDefinitionUseCase) {
  return withLambdaHandler(
    async (req: LambdaRequest) => {
      try {
        await useCase.execute(
          (req as LambdaRequest & { validatedDeleteMetadataDefinition: Parameters<DeleteMetadataDefinitionUseCase['execute']>[0] })
            .validatedDeleteMetadataDefinition,
        );
        return { deleted: true };
      } catch (error) {
        throw ensureHttpError(error);
      }
    },
    {
      validator: validateDeleteMetadataDefinition,
      successMessageKey: 'METADATA.METADATA_DELETE_SUCCESS',
    },
  );
}
