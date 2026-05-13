import { ddbDocClient } from '@api-hub/utils';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DeviceRecommendation } from '../models';
import { createLogger, serializeError, createChildLogger } from '@api-hub/observability';
import { RecommendationNotFoundError } from '../utils/errors';

const baseLogger = createLogger({ service: 'recommendation-repository' });

export class RecommendationRepository {
  private docClient: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    this.docClient = ddbDocClient;
    this.tableName = process.env.DEVICE_TABLE || '';
  }

  /**
   * Normalize deviceId for use in keys (uppercase, replace spaces with underscores)
   */
  private normalizeDeviceId(deviceId: string): string {
    return deviceId.toUpperCase()?.split(' ')?.join('_');
  }

  /**
   * Create a device recommendation
   */
  async createRecommendation(data: {
    patientUserId: string;
    doctorId: string;
    doctorName: string;
    organizationId: string;
    deviceId: string;
    category: string;
    name: string;
    displayName?: string;
  }): Promise<DeviceRecommendation> {
    const logger = createChildLogger(baseLogger, { patientUserId: data.patientUserId, deviceId: data.deviceId });
    const normalizedDeviceId = this.normalizeDeviceId(data.deviceId);
    const now = Date.now();
// console.log("NORMALIZED DEVICE ID ", normalizedDeviceId);
    const item: DeviceRecommendation = {
      pk: 'RECOMMEND',
      sk: `${normalizedDeviceId}#${data.patientUserId}`,
      sk1: data.patientUserId,
      sk2: data.doctorId,
      sk3: data.organizationId,
      sk4: normalizedDeviceId,
      sk5: `${data.patientUserId}#${data.category}#${data.name}`,
      doctorData: {
        doctorName: data.doctorName,
        doctorId: data.doctorId,
        recommendTime: now,
      },
      organizationID: data.organizationId,
      status: 'UNPAIRED',
      deviceId: data.deviceId,
      category: data.category,
      name: data.name,
      displayName: data.displayName,
      patientUserId: data.patientUserId,
      createdDate: now,
      modifiedDate: now,
    };

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
        }) as any,
      );
      logger.info({ event: 'recommendation_created', deviceId: data.deviceId });
      return item;
    } catch (err) {
      logger.error({ event: 'recommendation_create_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Get recommendation by patient and device
   */
  async getRecommendation(patientUserId: string, deviceId: string): Promise<DeviceRecommendation | null> {
    const logger = createChildLogger(baseLogger, { patientUserId, deviceId });
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);
    try {
      const result:any = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            pk: 'RECOMMEND',
            sk: `${normalizedDeviceId}#${patientUserId}`,
          },
        }) as any,
      );
      return result.Item as DeviceRecommendation | null;
    } catch (err) {
      logger.error({ event: 'get_recommendation_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Get all recommendations for a patient
   */
  async getPatientRecommendations(patientUserId: string): Promise<DeviceRecommendation[]> {
    const logger = createChildLogger(baseLogger, { patientUserId });
    // console.log("GET PATIENT RECOMMENDATIONS ", patientUserId);
    try {
      // Query all recommendations
      const result:any = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: {
            ':pk': 'RECOMMEND',
          },
        }) as any ,
      );
      
      // Filter to get only recommendations for this patient
      // sk format is: {deviceId}#{patientUserId}, so we need to extract the second part
      const filteredItems = (result.Items || []).filter((item: any) => {
        // Check if sk ends with the patientUserId after #
        if (item.sk && typeof item.sk === 'string') {
          const parts = item.sk.split('#');
          // parts[0] = deviceId, parts[1] = patientUserId
          if (parts.length >= 2 && parts[1] === patientUserId) {
            return true;
          }
        }
        // Fallback: check sk1 if it's just the patientUserId
        if (item.sk1 === patientUserId) {
          return true;
        }
        return false;
      });
      
      logger.info({ 
        event: 'get_patient_recommendations_success', 
        totalCount: result.Items?.length || 0,
        filteredCount: filteredItems.length 
      });
      return filteredItems as DeviceRecommendation[];
    } catch (err) {
      logger.error({ event: 'get_patient_recommendations_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Get all recommendations for a user (when viewing own recommendations)
   */
  async getUserRecommendations(userId: string): Promise<DeviceRecommendation[]> {
    return this.getPatientRecommendations(userId);
  }

  /**
   * Update recommendation status (e.g., from UNPAIRED to PAIRED)
   */
  async updateRecommendationStatus(patientUserId: string, deviceId: string, status: 'UNPAIRED' | 'PAIRED'): Promise<void> {
    const logger = createChildLogger(baseLogger, { patientUserId, deviceId, status });
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: {
            pk: 'RECOMMEND',
            sk: `${normalizedDeviceId}#${patientUserId}`,
          },
          UpdateExpression: 'SET #status = :status, modifiedDate = :modifiedDate',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':status': status,
            ':modifiedDate': Date.now(),
          },
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }) as any,
      );
      logger.info({ event: 'recommendation_status_updated', status });
    } catch (err) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        throw new RecommendationNotFoundError(patientUserId, deviceId);
      }
      logger.error({ event: 'recommendation_status_update_error', err: serializeError(err) });
      throw err;
    }
  }

  /**
   * Delete a recommendation
   */
  async deleteRecommendation(patientUserId: string, deviceId: string): Promise<void> {
    const logger = createChildLogger(baseLogger, { patientUserId, deviceId });
    const normalizedDeviceId = this.normalizeDeviceId(deviceId);
    try {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: {
            pk: 'RECOMMEND',
            sk: `${normalizedDeviceId}#${patientUserId}`,
          },
        }) as any,
      );
      logger.info({ event: 'recommendation_deleted', deviceId });
    } catch (err) {
      logger.error({ event: 'recommendation_delete_error', err: serializeError(err) });
      throw err;
    }
  }
}
