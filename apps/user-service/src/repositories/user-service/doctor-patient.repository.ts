import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type QueryCommandInput,
  type QueryCommandOutput,
  type GetCommandOutput,
  type PutCommandOutput,
  type UpdateCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '@api-hub/utils';
import { sendDoc } from '../../utils/dynamodb-send';
import {
  createLogger,
  createChildLogger,
  serializeError,
} from '@api-hub/logger';
import { KeyBuilder } from '@api-hub/utils';

const baseLogger = createLogger({
  service: 'user-service',
  redactPII: true,
});

const USER_TABLE = process.env.USER_TABLE || '';

export interface DoctorPatientLinkResult {
  patientId: string;
  patientOrgId?: string;
  previouslyConsulted?: boolean;
}

export interface AssignedDoctorResult {
  doctorId: string;
  organizationID?: string;
}

export interface PatientReporter {
  reporterId: string;
  reporterName: string;
  reporterProfilePic?: string;
  reporterEmail?: string;
}

export class DoctorPatientRepository {
  /**
   * List all patient IDs for a doctor.
   * Mirrors legacy doctor_patient_list logic.
   */
  async listPatientIdsForDoctor(
    doctorId: string,
  ): Promise<DoctorPatientLinkResult[]> {
    const logger = createChildLogger(baseLogger, { doctorId });
    const seen = new Set<string>();
    const result: DoctorPatientLinkResult[] = [];

    const activeLinkPrefixes = [
      KeyBuilder.doctorPatientSk(''),
      KeyBuilder.dieticianPatientSk(''),
      KeyBuilder.healthCoachPatientSk(''),
      KeyBuilder.careManagerPatientSk(''),
    ];

    for (const rawPrefix of activeLinkPrefixes) {
      const skPrefix = rawPrefix;
      let lastKey: Record<string, unknown> | undefined;

      do {
        const params: QueryCommandInput = {
          TableName: USER_TABLE,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
          FilterExpression: '#sk1 <> :inactive',
          ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk', '#sk1': 'sk1' },
          ExpressionAttributeValues: {
            ':pk': KeyBuilder.userPk(doctorId),
            ':sk': skPrefix,
            ':inactive': 'INACTIVE',
          },
        };
        if (lastKey) {
          params.ExclusiveStartKey = lastKey as Record<string, unknown>;
        }

        const response = await sendDoc<QueryCommandOutput>(ddbDocClient, new QueryCommand(params));
        const items = response.Items ?? [];
        lastKey = response.LastEvaluatedKey;

        for (const item of items) {
          const sk = (item.sk as string) || '';
          const patientId = sk.includes('#') ? sk.split('#')[1] : sk;
          if (patientId && !seen.has(patientId)) {
            seen.add(patientId);
            result.push({
              patientId,
              patientOrgId:
                (item as any).organizationID ?? (item as any).patientOrgId,
              previouslyConsulted: false,
            });
          }
        }
      } while (lastKey);
    }

    const scdPrefix = KeyBuilder.previouslyConsultedSk('');
    let lastKey: Record<string, unknown> | undefined;

    do {
      const params: QueryCommandInput = {
        TableName: USER_TABLE,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
        ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
        ExpressionAttributeValues: {
          ':pk': KeyBuilder.userPk(doctorId),
          ':sk': scdPrefix,
        },
      };
      if (lastKey) {
        params.ExclusiveStartKey = lastKey as Record<string, unknown>;
      }

      const response = await sendDoc<QueryCommandOutput>(ddbDocClient, new QueryCommand(params));
      const items = response.Items ?? [];
      lastKey = response.LastEvaluatedKey;

      for (const item of items) {
        const sk = (item.sk as string) || '';
        const patientId = sk.includes('#') ? sk.split('#')[1] : sk;
        if (patientId && !seen.has(patientId)) {
          seen.add(patientId);
          result.push({
            patientId,
            patientOrgId:
              (item as any).organizationID ?? (item as any).patientOrgId,
            previouslyConsulted: true,
          });
        }
      }
    } while (lastKey);

    logger.info({
      event: 'listPatientIdsForDoctor_success',
      doctorId,
      count: result.length,
    });

    return result;
  }

  /**
   * Save or update doctor–patient link.
   * Matches legacy link_unlink_user behaviour.
   */
  async saveDoctorPatientLink(
    doctorId: string,
    patientId: string,
    organizationId: string,
  ): Promise<void> {
    const logger = createChildLogger(baseLogger, {
      doctorId,
      patientId,
      organizationId,
    });

    const doctorPk = KeyBuilder.userPk(doctorId);
    const doctorSk = KeyBuilder.doctorPatientSk(patientId);
    const patientPk = KeyBuilder.userPk(patientId);
    const patientSk = KeyBuilder.patientDoctorSk(doctorId);
    const now = Date.now();

    const existing = await sendDoc<GetCommandOutput>(ddbDocClient,
      new GetCommand({
        TableName: USER_TABLE,
        Key: { pk: doctorPk, sk: doctorSk },
      }),
    );

    if (existing.Item) {
      await sendDoc<UpdateCommandOutput>(ddbDocClient,
        new UpdateCommand({
          TableName: USER_TABLE,
          Key: { pk: doctorPk, sk: doctorSk },
          UpdateExpression: 'SET #modifiedDate = :modifiedDate, #sk1 = :sk1',
          ExpressionAttributeNames: {
            '#modifiedDate': 'modifiedDate',
            '#sk1': 'sk1',
          },
          ExpressionAttributeValues: { ':modifiedDate': now, ':sk1': 'ACTIVE' },
        }),
      );
      logger.info({ event: 'saveDoctorPatientLink_updated' });
    } else {
      await sendDoc<PutCommandOutput>(ddbDocClient,
        new PutCommand({
          TableName: USER_TABLE,
          Item: {
            pk: doctorPk,
            sk: doctorSk,
            sk1: 'ACTIVE',
            organizationID: organizationId,
            createdDate: now,
            modifiedDate: now,
          },
        }),
      );
      logger.info({ event: 'saveDoctorPatientLink_created' });
    }

    const reverseExisting = await sendDoc<GetCommandOutput>(ddbDocClient,
      new GetCommand({
        TableName: USER_TABLE,
        Key: { pk: patientPk, sk: patientSk },
      }),
    );

    if (reverseExisting.Item) {
      await sendDoc<UpdateCommandOutput>(ddbDocClient,
        new UpdateCommand({
          TableName: USER_TABLE,
          Key: { pk: patientPk, sk: patientSk },
          UpdateExpression: 'SET #modifiedDate = :modifiedDate, #sk1 = :sk1',
          ExpressionAttributeNames: {
            '#modifiedDate': 'modifiedDate',
            '#sk1': 'sk1',
          },
          ExpressionAttributeValues: { ':modifiedDate': now, ':sk1': 'ACTIVE' },
        }),
      );
      logger.info({ event: 'saveDoctorPatientLink_reverse_updated' });
    } else {
      await sendDoc<PutCommandOutput>(ddbDocClient,
        new PutCommand({
          TableName: USER_TABLE,
          Item: {
            pk: patientPk,
            sk: patientSk,
            sk1: 'ACTIVE',
            organizationID: organizationId,
            createdDate: now,
            modifiedDate: now,
          },
        }),
      );
      logger.info({ event: 'saveDoctorPatientLink_reverse_created' });
    }
  }

  /**
   * List all doctor IDs assigned to a patient.
   * Uses reverse mapping created in saveDoctorPatientLink.
   */
  async listAssignedDoctorIdsForPatient(
    patientId: string,
  ): Promise<AssignedDoctorResult[]> {
    const logger = createChildLogger(baseLogger, { patientId });
    const result: AssignedDoctorResult[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const params: QueryCommandInput = {
        TableName: USER_TABLE,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        FilterExpression: '#sk1 <> :inactive',
        ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk', '#sk1': 'sk1' },
        ExpressionAttributeValues: {
          ':pk': KeyBuilder.userPk(patientId),
          ':skPrefix': KeyBuilder.patientDoctorSk(''),
          ':inactive': 'INACTIVE',
        },
      };
      if (lastKey) {
        params.ExclusiveStartKey = lastKey as Record<string, unknown>;
      }

      const response = await sendDoc<QueryCommandOutput>(ddbDocClient, new QueryCommand(params));
      const items = response.Items ?? [];
      lastKey = response.LastEvaluatedKey;

      for (const item of items) {
        const sk = (item.sk as string) || '';
        const doctorId =
          sk.includes('#') && sk.split('#')[1] ? sk.split('#')[1] : sk;
        if (!doctorId) continue;

        result.push({
          doctorId,
          organizationID: (item as any).organizationID,
        });
      }
    } while (lastKey);

    logger.info({
      event: 'listAssignedDoctorIdsForPatient_success',
      patientId,
      count: result.length,
    });

    return result;
  }

  /**
   * Update patient record with reporter (doctor) info.
   */
  async updatePatientReporter(
    patientId: string,
    organizationId: string,
    reporter: PatientReporter,
  ): Promise<void> {
    const logger = createChildLogger(baseLogger, { patientId, organizationId });
    const now = Date.now();
    const exprNames: Record<string, string> = {
      '#modifiedDate': 'modifiedDate',
      '#reporterId': 'reporterId',
      '#reporterName': 'reporterName',
    };
    const exprValues: Record<string, unknown> = {
      ':modifiedDate': now,
      ':reporterId': reporter.reporterId,
      ':reporterName': reporter.reporterName,
    };
    let updateExpr =
      'SET #modifiedDate = :modifiedDate, #reporterId = :reporterId, #reporterName = :reporterName';

    if (reporter.reporterProfilePic !== undefined) {
      exprNames['#reporterProfilePic'] = 'reporterProfilePic';
      exprValues[':reporterProfilePic'] = reporter.reporterProfilePic;
      updateExpr += ', #reporterProfilePic = :reporterProfilePic';
    }
    if (reporter.reporterEmail !== undefined) {
      exprNames['#reporterEmail'] = 'reporterEmail';
      exprValues[':reporterEmail'] = reporter.reporterEmail;
      updateExpr += ', #reporterEmail = :reporterEmail';
    }

    const updates = {
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
      UpdateExpression: updateExpr,
    };

    try {
      await sendDoc<UpdateCommandOutput>(ddbDocClient,
        new UpdateCommand({
          TableName: USER_TABLE,
          Key: {
            pk: KeyBuilder.orgUserPk(organizationId),
            sk: KeyBuilder.orgUserSk(patientId),
          },
          ...updates,
        }),
      );
      logger.info({ event: 'updatePatientReporter_org_user' });
    } catch (err) {
      logger.warn({
        event: 'updatePatientReporter_org_user_failed',
        err: serializeError(err),
      });
    }

    try {
      await sendDoc<UpdateCommandOutput>(ddbDocClient,
        new UpdateCommand({
          TableName: USER_TABLE,
          Key: {
            pk: KeyBuilder.userPk(patientId),
            sk: KeyBuilder.userBasicDetailsSk(organizationId),
          },
          ...updates,
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }),
      );
      logger.info({ event: 'updatePatientReporter_legacy' });
    } catch (err: unknown) {
      if (
        (err as { name?: string })?.name !== 'ConditionalCheckFailedException'
      ) {
        logger.warn({
          event: 'updatePatientReporter_legacy_failed',
          err: serializeError(err),
        });
      }
    }
  }
}

