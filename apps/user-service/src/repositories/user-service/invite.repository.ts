import { GetCommand, UpdateCommand, type GetCommandOutput, type UpdateCommandOutput } from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '@api-hub/utils';
import { sendDoc } from '../../utils/dynamodb-send';
import {
  createLogger,
  createChildLogger,
  serializeError,
} from '@api-hub/logger';
import { KeyBuilder } from '@api-hub/utils';
import { InviteUpdateTooSoonError, UserNotFoundError } from '../../utils/errors';

const baseLogger = createLogger({
  service: 'user-service',
  redactPII: true,
});

const USER_TABLE = process.env.USER_TABLE || ''; 

export interface InviteUpdateOptions {
  email?: boolean;
  sms?: boolean;
}

export interface InviteDetails {
  email: boolean;
  emailUpdatedAt: string;
  sms: boolean;
  smsUpdatedAt: string;
}

export class InviteRepository {
  /**
   * Updates invite details for a user, enforcing 24h constraints.
   */
  async updateRecentInvite(
    userId: string,
    organizationId: string,
    options: InviteUpdateOptions,
  ): Promise<InviteDetails> {
    const logger = createChildLogger(baseLogger, { userId, organizationId });
    const currentTimestamp = new Date().toISOString();

    let existingInviteDetails: {
      email?: boolean;
      emailUpdatedAt?: string;
      sms?: boolean;
      smsUpdatedAt?: string;
    } = {};

    try {
      const getResponse = await sendDoc<GetCommandOutput>(ddbDocClient,
        new GetCommand({
          TableName: USER_TABLE,
          Key: {
            pk: KeyBuilder.orgUserPk(organizationId),
            sk: KeyBuilder.orgUserSk(userId),
          },
        }),
      );
      if (getResponse.Item?.inviteDetails) {
        existingInviteDetails =
          getResponse.Item.inviteDetails as typeof existingInviteDetails;
      }
    } catch (err) {
      logger.debug({
        event: 'get_invite_details_error',
        message: 'Could not fetch existing inviteDetails, will create new',
        err: serializeError(err),
      });
    }

    const inviteDetails = {
      ...existingInviteDetails,
    };

    const now = Date.now();

    if (options.email !== undefined && options.email === true) {
      if (existingInviteDetails.emailUpdatedAt) {
        const lastEmailUpdate = new Date(
          existingInviteDetails.emailUpdatedAt,
        ).getTime();
        const hoursSinceUpdate = (now - lastEmailUpdate) / (1000 * 60 * 60);

        if (hoursSinceUpdate < 24) {
          logger.warn({
            event: 'email_invite_update_too_soon',
            lastUpdatedAt: existingInviteDetails.emailUpdatedAt,
            hoursSinceUpdate: hoursSinceUpdate.toFixed(2),
          });
          throw new InviteUpdateTooSoonError(
            'email',
            existingInviteDetails.emailUpdatedAt,
            hoursSinceUpdate,
          );
        }
      }
      inviteDetails.email = options.email;
      inviteDetails.emailUpdatedAt = currentTimestamp;
    }

    if (options.sms !== undefined && options.sms === true) {
      if (existingInviteDetails.smsUpdatedAt) {
        const lastSmsUpdate = new Date(
          existingInviteDetails.smsUpdatedAt,
        ).getTime();
        const hoursSinceUpdate = (now - lastSmsUpdate) / (1000 * 60 * 60);

        if (hoursSinceUpdate < 24) {
          logger.warn({
            event: 'sms_invite_update_too_soon',
            lastUpdatedAt: existingInviteDetails.smsUpdatedAt,
            hoursSinceUpdate: hoursSinceUpdate.toFixed(2),
          });
          throw new InviteUpdateTooSoonError(
            'sms',
            existingInviteDetails.smsUpdatedAt,
            hoursSinceUpdate,
          );
        }
      }
      inviteDetails.sms = options.sms;
      inviteDetails.smsUpdatedAt = currentTimestamp;
    }

    if (options.email !== undefined && options.email === false) {
      inviteDetails.email = false;
      if (!existingInviteDetails.emailUpdatedAt) {
        inviteDetails.emailUpdatedAt = currentTimestamp;
      }
    }

    if (options.sms !== undefined && options.sms === false) {
      inviteDetails.sms = false;
      if (!existingInviteDetails.smsUpdatedAt) {
        inviteDetails.smsUpdatedAt = currentTimestamp;
      }
    }

    const finalInviteDetails: InviteDetails = {
      email: inviteDetails.email ?? false,
      emailUpdatedAt: inviteDetails.emailUpdatedAt ?? '0000-00-00 00:00:00',
      sms: inviteDetails.sms ?? false,
      smsUpdatedAt: inviteDetails.smsUpdatedAt ?? '0000-00-00 00:00:00',
    };

    const updateParts: string[] = ['modifiedDate = :modifiedDate'];
    const exprNames: Record<string, string> = {
      '#inviteDetails': 'inviteDetails',
    };
    const exprValues: Record<string, unknown> = {
      ':modifiedDate': Date.now(),
      ':inviteDetails': finalInviteDetails,
    };

    updateParts.push('#inviteDetails = :inviteDetails');

    try {
      await sendDoc<UpdateCommandOutput>(ddbDocClient,
        new UpdateCommand({
          TableName: USER_TABLE,
          Key: {
            pk: KeyBuilder.orgUserPk(organizationId),
            sk: KeyBuilder.orgUserSk(userId),
          },
          UpdateExpression: `SET ${updateParts.join(', ')}`,
          ExpressionAttributeNames: exprNames,
          ExpressionAttributeValues: exprValues,
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }),
      );

      logger.info({
        event: 'invite_details_updated',
        message: 'Invite details updated successfully',
        inviteDetails: finalInviteDetails,
      });

      return finalInviteDetails;
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        throw new UserNotFoundError(userId);
      }
      logger.error({
        event: 'update_invite_details_error',
        err: serializeError(err),
        message: 'Failed to update invite details',
      });
      throw err;
    }
  }
 
 
}

