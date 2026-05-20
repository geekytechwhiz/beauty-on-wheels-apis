import { PutCommand, QueryCommand, DeleteCommand, UpdateCommand, type QueryCommandInput, type QueryCommandOutput, type PutCommandOutput, type DeleteCommandOutput, type UpdateCommandOutput } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../utils/db.config';
import { sendDoc } from '../utils/dynamodb-send';
import { createLogger, serializeError, createChildLogger } from '@api-hub/observability';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });

/** F&F mappings use the same user table as legacy: pk=INVITE_F&F#userId, sk=INVITEE#memberId */
const TABLE_NAME = process.env.USER_TABLE || '';
const INVITE_FF = 'INVITE_F&F';
const INVITEE = 'INVITEE';
const INVITER = 'INVITER';

export interface FriendFamilyMapping {
  pk: string;
  sk: string;
  inviterName: string;
  memberName: string;
  relation: string;
  relationship: string;
  emergencyContact: boolean;
  organizationID: string;
  manageHealth?: boolean;
  createdAt: number;
  modifiedAt: number;
}

export interface SaveMappingInput {
  organizationID: string;
  userId: string;
  memberId: string;
  userName: string;
  memberName: string;
  relation: string;
  relationship: string;
  emergencyContact: boolean;
  manageHealth?: boolean;
}

export class FriendFamilyRepository {
  private tableName = TABLE_NAME;

  async saveMapping(input: SaveMappingInput): Promise<void> {
    const logger = createChildLogger(baseLogger, { userId: input.userId, memberId: input.memberId });
    const date = Date.now();
    const obj1 = {
      pk: `${INVITE_FF}#${input.userId}`,
      sk: `${INVITEE}#${input.memberId}`,
      inviterName: input.userName,
      memberName: input.memberName,
      relation: (input.relation || 'FAMILY').toUpperCase(),
      relationship: input.relationship || '',
      emergencyContact: input.emergencyContact,
      organizationID: input.organizationID,
      manageHealth: input.manageHealth ?? false,
      createdAt: date,
      modifiedAt: date,
    };
    const obj2 = {
      pk: `${INVITE_FF}#${input.memberId}`,
      sk: `${INVITER}#${input.userId}`,
      inviterName: input.userName,
      memberName: input.memberName,
      relation: (input.relation || 'FAMILY').toUpperCase(),
      relationship: input.relationship || '',
      emergencyContact: input.emergencyContact,
      organizationID: input.organizationID,
      manageHealth: input.manageHealth ?? false,
      createdAt: date,
      modifiedAt: date,
    };
    try {
      await sendDoc<PutCommandOutput>(docClient, new PutCommand({ TableName: this.tableName, Item: obj1 }));
      await sendDoc<PutCommandOutput>(docClient, new PutCommand({ TableName: this.tableName, Item: obj2 }));
      logger.info({ event: 'friend_family_save_mapping_success' });
    } catch (err) {
      logger.error({ event: 'friend_family_save_mapping_error', err: serializeError(err) });
      throw err;
    }
  }

  async getMapping(userId: string, memberId: string, asInviter = false): Promise<FriendFamilyMapping | null> {
    const pk = `${INVITE_FF}#${userId}`;
    const sk = asInviter ? `${INVITER}#${memberId}` : `${INVITEE}#${memberId}`;
    try {
      const result = await sendDoc<QueryCommandOutput>(docClient,
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: '#pk = :pk AND #sk = :sk',
          ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
          ExpressionAttributeValues: { ':pk': pk, ':sk': sk },
        }),
      );
      const item = result.Items?.[0];
      return (item as FriendFamilyMapping) ?? null;
    } catch (err) {
      const logger = createChildLogger(baseLogger, { userId, memberId });
      logger.error({ event: 'friend_family_get_mapping_error', err: serializeError(err) });
      throw err;
    }
  }

  /** Get mapping from inviter's side: user added member (pk=userId, sk=INVITEE#memberId). */
  async getUserMapping(userId: string, memberId: string): Promise<FriendFamilyMapping | null> {
    return this.getMapping(userId, memberId, false);
  }

  /** Check if user already has an F&F (limit one per user in legacy). */
  async checkFriendFamily(userId: string, inviterSide = false): Promise<FriendFamilyMapping | null> {
    const skPrefix = inviterSide ? INVITER : INVITEE;
    const params: QueryCommandInput = {
      TableName: this.tableName,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
      ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
      ExpressionAttributeValues: { ':pk': `${INVITE_FF}#${userId}`, ':sk': `${skPrefix}#` },
    };
    try {
      const result = await sendDoc<QueryCommandOutput>(docClient, new QueryCommand(params));
      const item = result.Items?.[0];
      return (item as FriendFamilyMapping) ?? null;
    } catch (err) {
      const logger = createChildLogger(baseLogger, { userId });
      logger.error({ event: 'friend_family_check_error', err: serializeError(err) });
      throw err;
    }
  }

  async deleteMapping(userId: string, memberId: string): Promise<void> {
    const logger = createChildLogger(baseLogger, { userId, memberId });
    try {
      await sendDoc<DeleteCommandOutput>(docClient,
        new DeleteCommand({
          TableName: this.tableName,
          Key: { pk: `${INVITE_FF}#${userId}`, sk: `${INVITEE}#${memberId}` },
        }),
      );
      await sendDoc<DeleteCommandOutput>(docClient,
        new DeleteCommand({
          TableName: this.tableName,
          Key: { pk: `${INVITE_FF}#${memberId}`, sk: `${INVITER}#${userId}` },
        }),
      );
      logger.info({ event: 'friend_family_delete_mapping_success' });
    } catch (err) {
      logger.error({ event: 'friend_family_delete_mapping_error', err: serializeError(err) });
      throw err;
    }
  }

  /** List invitees for a user (users this user added as F&F). */
  async listInvitees(userId: string): Promise<FriendFamilyMapping[]> {
    const params: QueryCommandInput = {
      TableName: this.tableName,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
      ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
      ExpressionAttributeValues: { ':pk': `${INVITE_FF}#${userId}`, ':sk': `${INVITEE}#` },
    };
    const result = await sendDoc<QueryCommandOutput>(docClient, new QueryCommand(params));
    return (result.Items ?? []) as FriendFamilyMapping[];
  }

  /** List inviters for a user (users who added this user as F&F). */
  async listInviters(userId: string): Promise<FriendFamilyMapping[]> {
    const params: QueryCommandInput = {
      TableName: this.tableName,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
      ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
      ExpressionAttributeValues: { ':pk': `${INVITE_FF}#${userId}`, ':sk': `${INVITER}#` },
    };
    const result = await sendDoc<QueryCommandOutput>(docClient, new QueryCommand(params));
    return (result.Items ?? []) as FriendFamilyMapping[];
  }

  async updateMapping(
    userId: string,
    memberId: string,
    updates: Partial<Pick<FriendFamilyMapping, 'memberName' | 'relation' | 'relationship' | 'emergencyContact' | 'manageHealth'>>
  ): Promise<void> {
    const date = Date.now();
    const sets: string[] = ['modifiedAt = :modifiedAt'];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = { ':modifiedAt': date };
    if (updates.memberName !== undefined) {
      sets.push('#memberName = :memberName');
      names['#memberName'] = 'memberName';
      values[':memberName'] = updates.memberName;
    }
    if (updates.relation !== undefined) {
      sets.push('#relation = :relation');
      names['#relation'] = 'relation';
      values[':relation'] = updates.relation.toUpperCase();
    }
    if (updates.relationship !== undefined) {
      sets.push('#relationship = :relationship');
      names['#relationship'] = 'relationship';
      values[':relationship'] = updates.relationship;
    }
    if (updates.emergencyContact !== undefined) {
      sets.push('#emergencyContact = :emergencyContact');
      names['#emergencyContact'] = 'emergencyContact';
      values[':emergencyContact'] = updates.emergencyContact;
    }
    if (updates.manageHealth !== undefined) {
      sets.push('#manageHealth = :manageHealth');
      names['#manageHealth'] = 'manageHealth';
      values[':manageHealth'] = updates.manageHealth;
    }
    if (sets.length <= 1) return;
    try {
      await sendDoc<UpdateCommandOutput>(docClient,
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: `${INVITE_FF}#${userId}`, sk: `${INVITEE}#${memberId}` },
          UpdateExpression: 'SET ' + sets.join(', '),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
      await sendDoc<UpdateCommandOutput>(docClient,
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: `${INVITE_FF}#${memberId}`, sk: `${INVITER}#${userId}` },
          UpdateExpression: 'SET ' + sets.join(', '),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
    } catch (err) {
      const logger = createChildLogger(baseLogger, { userId, memberId });
      logger.error({ event: 'friend_family_update_mapping_error', err: serializeError(err) });
      throw err;
    }
  }
}
