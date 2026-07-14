import { BaseRepository } from '@api-hub/utils';
import { QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { env } from '../configs/env.config';
import { VehicleDdbItem } from '../types/repository.types';

export class VehiclesRepository extends BaseRepository {
  constructor() {
    super();
  }

  public getTableName(): string {
    return env.DYNAMODB_TABLE_NAME;
  }

  async createVehicle(item: VehicleDdbItem): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: item,
            ConditionExpression:
              'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
      ],
    });
  }

  /**
   * Retrieve a single vehicle by userId and vehicleId.
   */
  async getVehicle(
    userId: string,
    vehicleId: string,
  ): Promise<VehicleDdbItem | null> {
    return this.get<VehicleDdbItem>(this.getTableName(), {
      PK: `USER#${userId}`,
      SK: `VEHICLE#${vehicleId}`,
    });
  }

  /**
   * List all vehicles belonging to the user.
   */
  async listVehicles(userId: string): Promise<VehicleDdbItem[]> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':skPrefix': 'VEHICLE#',
      },
    };
    return this.query<VehicleDdbItem>(params);
  }

  /**
   * List vehicles belonging to the user filtered by status (LSI1).
   */
  async listVehiclesByStatus(
    userId: string,
    status: string,
  ): Promise<VehicleDdbItem[]> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: 'StatusIndex',
      KeyConditionExpression: 'PK = :pk AND LSI1SK = :lsi1sk',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':lsi1sk': `STATUS#${status}`,
      },
    };
    return this.query<VehicleDdbItem>(params);
  }

  /**
   * List vehicles belonging to the user filtered by vehicleType (LSI2).
   */
  async listVehiclesByType(
    userId: string,
    vehicleType: string,
  ): Promise<VehicleDdbItem[]> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: 'VehicleTypeIndex',
      KeyConditionExpression: 'PK = :pk AND LSI2SK = :lsi2sk',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':lsi2sk': `TYPE#${vehicleType}`,
      },
    };
    return this.query<VehicleDdbItem>(params);
  }

  /**
   * Retrieve the default vehicle for the user (LSI3).
   */
  async getDefaultVehicle(userId: string): Promise<VehicleDdbItem | null> {
    const params: QueryCommandInput = {
      TableName: this.getTableName(),
      IndexName: 'DefaultVehicleIndex',
      KeyConditionExpression: 'PK = :pk AND LSI3SK = :lsi3sk',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`,
        ':lsi3sk': 'DEFAULT#1',
      },
    };
    return this.queryOne<VehicleDdbItem>(params);
  }

  /**
   * Update the vehicle item atomically.
   */
  async updateVehicle(item: VehicleDdbItem): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: item,
            ConditionExpression:
              'attribute_exists(PK) AND attribute_exists(SK)',
          },
        },
      ],
    });
  }

  /**
   * Update the vehicle and revert the old default vehicle status atomically.
   */
  async updateVehicleWithDefaultRoll(
    item: VehicleDdbItem,
    oldDefaultVehicleId: string,
  ): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Put: {
            TableName: this.getTableName(),
            Item: item,
            ConditionExpression:
              'attribute_exists(PK) AND attribute_exists(SK)',
          },
        },
        {
          Update: {
            TableName: this.getTableName(),
            Key: {
              PK: `USER#${item.userId}`,
              SK: `VEHICLE#${oldDefaultVehicleId}`,
            },
            UpdateExpression:
              'SET defaultVehicle = :defaultFalse, LSI3SK = :lsi3skFalse, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
              ':defaultFalse': false,
              ':lsi3skFalse': 'DEFAULT#0',
              ':updatedAt': item.updatedAt,
            },
            ConditionExpression: 'attribute_exists(PK)',
          },
        },
      ],
    });
  }

  /**
   * Set a vehicle as default and demote the current default vehicle atomically.
   */
  async setDefaultVehicle(
    userId: string,
    currentDefaultId: string | null,
    newDefaultId: string,
    timestamp: string,
  ): Promise<void> {
    const transactItems: any[] = [];

    if (currentDefaultId) {
      transactItems.push({
        Update: {
          TableName: this.getTableName(),
          Key: {
            PK: `USER#${userId}`,
            SK: `VEHICLE#${currentDefaultId}`,
          },
          UpdateExpression:
            'SET defaultVehicle = :defaultFalse, LSI3SK = :lsi3skFalse, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':defaultFalse': false,
            ':lsi3skFalse': 'DEFAULT#0',
            ':updatedAt': timestamp,
          },
          ConditionExpression: 'attribute_exists(PK)',
        },
      });
    }

    transactItems.push({
      Update: {
        TableName: this.getTableName(),
        Key: {
          PK: `USER#${userId}`,
          SK: `VEHICLE#${newDefaultId}`,
        },
        UpdateExpression:
          'SET defaultVehicle = :defaultTrue, LSI3SK = :lsi3skTrue, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':defaultTrue': true,
          ':lsi3skTrue': 'DEFAULT#1',
          ':updatedAt': timestamp,
        },
        ConditionExpression: 'attribute_exists(PK)',
      },
    });

    await this.transactWrite({ TransactItems: transactItems });
  }

  /**
   * Delete a vehicle atomically.
   */
  async deleteVehicle(userId: string, vehicleId: string): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Delete: {
            TableName: this.getTableName(),
            Key: {
              PK: `USER#${userId}`,
              SK: `VEHICLE#${vehicleId}`,
            },
            ConditionExpression: 'attribute_exists(PK)',
          },
        },
      ],
    });
  }

  /**
   * Delete a vehicle and set another vehicle as default atomically.
   */
  async deleteVehicleAndSetDefault(
    userId: string,
    vehicleIdToDelete: string,
    newDefaultVehicleId: string,
    timestamp: string,
  ): Promise<void> {
    await this.transactWrite({
      TransactItems: [
        {
          Delete: {
            TableName: this.getTableName(),
            Key: {
              PK: `USER#${userId}`,
              SK: `VEHICLE#${vehicleIdToDelete}`,
            },
            ConditionExpression: 'attribute_exists(PK)',
          },
        },
        {
          Update: {
            TableName: this.getTableName(),
            Key: {
              PK: `USER#${userId}`,
              SK: `VEHICLE#${newDefaultVehicleId}`,
            },
            UpdateExpression:
              'SET defaultVehicle = :defaultTrue, LSI3SK = :lsi3skTrue, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
              ':defaultTrue': true,
              ':lsi3skTrue': 'DEFAULT#1',
              ':updatedAt': timestamp,
            },
            ConditionExpression: 'attribute_exists(PK)',
          },
        },
      ],
    });
  }

  /**
   * Check if a vehicle exists under the user.
   */
  async vehicleExists(userId: string, vehicleId: string): Promise<boolean> {
    const item = await this.getVehicle(userId, vehicleId);
    return item !== null;
  }
}

let repository: VehiclesRepository;

export function getVehiclesRepository() {
  if (!repository) {
    repository = new VehiclesRepository();
  }
  return repository;
}
