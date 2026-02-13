import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '@api-hub/utils';
import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import type { Partner, PartnerCapability } from '@api-hub/partners';
import type { CreatePartnerInput, UpdatePartnerInput } from '../models/partner.model';
import type { SetCapabilityInput } from '../models/capability.model';
import { PartnerAlreadyExistsError, OrgPartnerLinkExistsError, PartnerInvalidStatusTransitionError } from '../utils/errors';

const baseLogger = createLogger({ service: 'partner-registry', redactPII: true });
const TABLE_NAME = process.env.INTEGRATION_REGISTRY_TABLE || '';

function pkPartner(partnerId: string): string {
  return `PARTNER#${partnerId}`;
}
function skMeta(): string {
  return 'META';
}
function skCapability(): string {
  return 'CAPABILITY';
}
function pkOrg(orgId: string): string {
  return `ORG#${orgId}`;
}
function skPartner(partnerId: string): string {
  return `PARTNER#${partnerId}`;
}
function pkAudit(): string {
  return 'AUDIT';
}
function skAudit(timestamp: string): string {
  return `AUDIT#${timestamp}`;
}

type PartnerDBItem = Partner & {
  pk: string;
  sk: string;
  lsi2_sk?: string; // status
  lsi3_sk?: string; // interop mode (on capability item)
  lsi1_sk?: string; // relationship type (on org-partner item)
};

function sanitizePartner(item: Record<string, unknown>): Partner {
  const out = { ...item };
  delete out.pk;
  delete out.sk;
  ['lsi1_sk', 'lsi2_sk', 'lsi3_sk', 'lsi4_sk', 'lsi5_sk'].forEach((k) => delete out[k]);
  return out as unknown as Partner;
}

export class PartnerRepository {
  async createPartner(partnerId: string, input: CreatePartnerInput): Promise<Partner> {
    const now = new Date().toISOString();
    const status = input.status ?? 'PENDING_APPROVAL';
    const item = {
      ...input,
      partnerId,
      organizationName: input.organizationName,
      status: input.status,
      endpoints: input.endpoints,
      createdAt: now,
      updatedAt: now,
      pk: pkPartner(partnerId),
      sk: skMeta(),
      lsi2_sk: status,
    } as unknown as PartnerDBItem;
    try {
      await ddbDocClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item as unknown as Record<string, unknown>,
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        })
      );
      const logger = createChildLogger(baseLogger, { partnerId });
      logger.info({ event: 'partner_created' });
      await this.writeAudit({ event: 'PARTNER_CREATED', partnerId, at: now });
      return sanitizePartner(item as unknown as Record<string, unknown>);
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        throw new PartnerAlreadyExistsError(partnerId);
      }
      baseLogger.error({ event: 'partner_create_error', err: serializeError(err) });
      throw err;
    }
  }

  async getPartner(partnerId: string): Promise<Partner | null> {
    try {
      const result = await ddbDocClient.send(
        new GetCommand({
          TableName: TABLE_NAME,
          Key: { pk: pkPartner(partnerId), sk: skMeta() },
        })
      );
      if (!result.Item) return null;
      return sanitizePartner(result.Item as Record<string, unknown>);
    } catch (err) {
      baseLogger.error({ event: 'partner_get_error', err: serializeError(err), partnerId });
      throw err;
    }
  }

  async updatePartner(partnerId: string, input: UpdatePartnerInput): Promise<Partner | null> {
    const now = new Date().toISOString();
    const updates: string[] = ['#updatedAt = :updatedAt'];
    const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
    const values: Record<string, unknown> = { ':updatedAt': now };

    // Basic Information
    if (input.organizationName !== undefined) {
      updates.push('#organizationName = :organizationName');
      names['#organizationName'] = 'organizationName';
      values[':organizationName'] = input.organizationName;
    }
    if (input.legalName !== undefined) {
      updates.push('#legalName = :legalName');
      names['#legalName'] = 'legalName';
      values[':legalName'] = input.legalName;
    }
    if (input.organizationType !== undefined) {
      updates.push('#organizationType = :organizationType');
      names['#organizationType'] = 'organizationType';
      values[':organizationType'] = input.organizationType;
    }
    if (input.organizationSize !== undefined) {
      updates.push('#organizationSize = :organizationSize');
      names['#organizationSize'] = 'organizationSize';
      values[':organizationSize'] = input.organizationSize;
    }
    if (input.noOfBranches !== undefined) {
      updates.push('#noOfBranches = :noOfBranches');
      names['#noOfBranches'] = 'noOfBranches';
      values[':noOfBranches'] = input.noOfBranches;
    }

    // Contact Information
    if (input.email !== undefined) {
      updates.push('#email = :email');
      names['#email'] = 'email';
      values[':email'] = input.email;
    }
    if (input.phoneCode !== undefined) {
      updates.push('#phoneCode = :phoneCode');
      names['#phoneCode'] = 'phoneCode';
      values[':phoneCode'] = input.phoneCode;
    }
    if (input.phoneNumber !== undefined) {
      updates.push('#phoneNumber = :phoneNumber');
      names['#phoneNumber'] = 'phoneNumber';
      values[':phoneNumber'] = input.phoneNumber;
    }
    if (input.primaryContact !== undefined) {
      updates.push('#primaryContact = :primaryContact');
      names['#primaryContact'] = 'primaryContact';
      values[':primaryContact'] = input.primaryContact;
    }

    // Address Information
    if (input.address !== undefined) {
      updates.push('#address = :address');
      names['#address'] = 'address';
      values[':address'] = input.address;
    }
    if (input.city !== undefined) {
      updates.push('#city = :city');
      names['#city'] = 'city';
      values[':city'] = input.city;
    }
    if (input.state !== undefined) {
      updates.push('#state = :state');
      names['#state'] = 'state';
      values[':state'] = input.state;
    }
    if (input.country !== undefined) {
      updates.push('#country = :country');
      names['#country'] = 'country';
      values[':country'] = input.country;
    }
    if (input.countryCode !== undefined) {
      updates.push('#countryCode = :countryCode');
      names['#countryCode'] = 'countryCode';
      values[':countryCode'] = input.countryCode;
    }
    if (input.postalCode !== undefined) {
      updates.push('#postalCode = :postalCode');
      names['#postalCode'] = 'postalCode';
      values[':postalCode'] = input.postalCode;
    }
    if (input.googleMapsLink !== undefined) {
      updates.push('#googleMapsLink = :googleMapsLink');
      names['#googleMapsLink'] = 'googleMapsLink';
      values[':googleMapsLink'] = input.googleMapsLink;
    }

    // Additional Information
    if (input.website !== undefined) {
      updates.push('#website = :website');
      names['#website'] = 'website';
      values[':website'] = input.website;
    }
    if (input.organizationImage !== undefined) {
      updates.push('#organizationImage = :organizationImage');
      names['#organizationImage'] = 'organizationImage';
      values[':organizationImage'] = input.organizationImage;
    }
    if (input.organizationBio !== undefined) {
      updates.push('#organizationBio = :organizationBio');
      names['#organizationBio'] = 'organizationBio';
      values[':organizationBio'] = input.organizationBio;
    }
    if (input.registrationNumber !== undefined) {
      updates.push('#registrationNumber = :registrationNumber');
      names['#registrationNumber'] = 'registrationNumber';
      values[':registrationNumber'] = input.registrationNumber;
    }
    if (input.taxId !== undefined) {
      updates.push('#taxId = :taxId');
      names['#taxId'] = 'taxId';
      values[':taxId'] = input.taxId;
    }

    // Status
    if (input.status !== undefined) {
      updates.push('#status = :status', '#lsi2_sk = :lsi2_sk');
      names['#status'] = 'status';
      names['#lsi2_sk'] = 'lsi2_sk';
      values[':status'] = input.status;
      values[':lsi2_sk'] = input.status;
    }

    // Onboarding
    if (input.onboarding !== undefined) {
      updates.push('#onboarding = :onboarding');
      names['#onboarding'] = 'onboarding';
      values[':onboarding'] = input.onboarding;
    }

    // Legacy fields
    if (input.description !== undefined) {
      updates.push('#description = :description');
      names['#description'] = 'description';
      values[':description'] = input.description;
    }
    if (input.endpoints !== undefined) {
      updates.push('#endpoints = :endpoints');
      names['#endpoints'] = 'endpoints';
      values[':endpoints'] = input.endpoints;
    }
    if (input.authConfig !== undefined) {
      updates.push('#authConfig = :authConfig');
      names['#authConfig'] = 'authConfig';
      values[':authConfig'] = input.authConfig;
    }
    if (input.adapterKey !== undefined) {
      updates.push('#adapterKey = :adapterKey');
      names['#adapterKey'] = 'adapterKey';
      values[':adapterKey'] = input.adapterKey;
    }
    if (updates.length <= 1) return this.getPartner(partnerId);

    try {
      await ddbDocClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { pk: pkPartner(partnerId), sk: skMeta() },
          UpdateExpression: 'SET ' + updates.join(', '),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ConditionExpression: 'attribute_exists(pk)',
        })
      );
      await this.writeAudit({ event: 'PARTNER_UPDATED', partnerId, at: now });
      return this.getPartner(partnerId);
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') return null;
      baseLogger.error({ event: 'partner_update_error', err: serializeError(err), partnerId });
      throw err;
    }
  }

  async setCapability(partnerId: string, input: SetCapabilityInput): Promise<PartnerCapability> {
    const now = new Date().toISOString();
    const item = {
      partnerId,
      interopMode: input.interopMode,
      version: input.version,
      updatedAt: now,
      pk: pkPartner(partnerId),
      sk: skCapability(),
      lsi3_sk: input.interopMode,
    };
    await ddbDocClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    );
    await this.writeAudit({ event: 'CAPABILITY_SET', partnerId, interopMode: input.interopMode, at: now });
    return { partnerId, interopMode: input.interopMode, version: input.version, updatedAt: now };
  }

  async getCapability(partnerId: string): Promise<PartnerCapability | null> {
    const result = await ddbDocClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { pk: pkPartner(partnerId), sk: skCapability() },
      })
    );
    if (!result.Item) return null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pk, sk, lsi3_sk, ...rest } = result.Item as Record<string, unknown>;
    return rest as unknown as PartnerCapability;
  }

  async linkOrgPartner(
    organizationId: string,
    partnerId: string,
    relationshipType?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const item = {
      organizationId,
      partnerId,
      linkedAt: now,
      relationshipType: relationshipType ?? 'PARTNER',
      pk: pkOrg(organizationId),
      sk: skPartner(partnerId),
      lsi1_sk: relationshipType ?? 'PARTNER',
    };
    try {
      await ddbDocClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
        })
      );
      await this.writeAudit({
        event: 'ORG_PARTNER_LINKED',
        organizationId,
        partnerId,
        at: now,
      });
    } catch (err: unknown) {
      const code = (err as { name?: string })?.name;
      if (code === 'ConditionalCheckFailedException') {
        throw new OrgPartnerLinkExistsError(organizationId, partnerId);
      }
      throw err;
    }
  }

  async listPartnersForOrg(organizationId: string): Promise<{ partnerId: string; organizationId: string; linkedAt: string; relationshipType?: string }[]> {
    const result = await ddbDocClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': pkOrg(organizationId),
          ':sk': 'PARTNER#',
        },
      })
    );
    const items = (result.Items ?? []).map((item) => ({
      partnerId: (item as Record<string, string>).partnerId,
      organizationId: (item as Record<string, string>).organizationId,
      linkedAt: (item as Record<string, string>).linkedAt,
      relationshipType: (item as Record<string, string>).relationshipType,
    }));
    return items;
  }

  async approvePartner(partnerId: string, approvedBy?: string): Promise<Partner | null> {
    const partner = await this.getPartner(partnerId);
    if (!partner) return null;
    const status = (partner as { status: string }).status;
    if (status !== 'PENDING_APPROVAL') {
      throw new PartnerInvalidStatusTransitionError(partnerId, status, 'approve');
    }
    const now = new Date().toISOString();
    const nowTs = Date.now();
    const existingOnboarding = (partner as { onboarding?: { approvedAt?: number; approvedBy?: string } }).onboarding;
    const onboarding = {
      ...existingOnboarding,
      approvedAt: nowTs,
      approvedBy: approvedBy ?? existingOnboarding?.approvedBy,
    };
    await ddbDocClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: pkPartner(partnerId), sk: skMeta() },
        UpdateExpression: 'SET #st = :status, #lsi2_sk = :lsi2_sk, #updatedAt = :updatedAt, #onboarding = :onboarding',
        ConditionExpression: 'attribute_exists(pk) AND #st = :pendingStatus',
        ExpressionAttributeNames: {
          '#st': 'status',
          '#lsi2_sk': 'lsi2_sk',
          '#updatedAt': 'updatedAt',
          '#onboarding': 'onboarding',
        },
        ExpressionAttributeValues: {
          ':status': 'ACTIVE',
          ':lsi2_sk': 'ACTIVE',
          ':updatedAt': now,
          ':onboarding': onboarding,
          ':pendingStatus': 'PENDING_APPROVAL',
        },
      })
    );
    await this.writeAudit({ event: 'PARTNER_APPROVED', partnerId, approvedBy, at: now });
    return this.getPartner(partnerId);
  }

  async rejectPartner(partnerId: string, rejectionReason: string): Promise<Partner | null> {
    const partner = await this.getPartner(partnerId);
    if (!partner) return null;
    const status = (partner as { status: string }).status;
    if (status !== 'PENDING_APPROVAL') {
      throw new PartnerInvalidStatusTransitionError(partnerId, status, 'reject');
    }
    const now = new Date().toISOString();
    const existingOnboarding = (partner as { onboarding?: Record<string, unknown> }).onboarding;
    const onboarding = {
      ...existingOnboarding,
      rejectionReason,
    };
    await ddbDocClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk: pkPartner(partnerId), sk: skMeta() },
        UpdateExpression: 'SET #st = :status, #lsi2_sk = :lsi2_sk, #updatedAt = :updatedAt, #onboarding = :onboarding',
        ConditionExpression: 'attribute_exists(pk) AND #st = :pendingStatus',
        ExpressionAttributeNames: {
          '#st': 'status',
          '#lsi2_sk': 'lsi2_sk',
          '#updatedAt': 'updatedAt',
          '#onboarding': 'onboarding',
        },
        ExpressionAttributeValues: {
          ':status': 'REJECTED',
          ':lsi2_sk': 'REJECTED',
          ':updatedAt': now,
          ':onboarding': onboarding,
          ':pendingStatus': 'PENDING_APPROVAL',
        },
      })
    );
    await this.writeAudit({ event: 'PARTNER_REJECTED', partnerId, rejectionReason, at: now });
    return this.getPartner(partnerId);
  }

  async writeAudit(payload: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString();
    const item = {
      ...payload,
      pk: pkAudit(),
      sk: skAudit(now),
      lsi5_sk: now,
    };
    try {
      await ddbDocClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: item,
        })
      );
    } catch (err) {
      baseLogger.warn({ event: 'audit_write_failed', err: serializeError(err) });
    }
  }
}
