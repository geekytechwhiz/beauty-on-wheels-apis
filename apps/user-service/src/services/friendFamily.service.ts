import { createLogger, createChildLogger, serializeError } from '@api-hub/logger';
import { UserRepository } from '../repositories/user.repository';
import { FriendFamilyRepository, type FriendFamilyMapping } from '../repositories/friendFamily.repository';
import { UserNotFoundError } from '../utils/errors';
import { getOrganization } from './organization.service';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userRepository = new UserRepository();
const friendFamilyRepository = new FriendFamilyRepository();

const ORG_NON_AVAILABLE = ['hold', 'on_hold', 'disabled', 'not_exist'];

export class FriendFamilyService {
  /**
   * Search for existing user by email/phone in org to add as F&F.
   * Returns { success, invitedUser } when user found and can be added; errors when already linked or org invalid.
   */
  async searchFnf(
    organizationID: string,
    userID: string,
    body: {
      email?: string;
      phone?: string;
      fullName: string;
      invite: string;
      relation: string;
      relationship?: string;
      emergencyContact: boolean;
      roles?: string[];
    },
    authHeader?: string
  ): Promise<{ success: boolean; invitedUser?: string; data?: Record<string, unknown> }> {
    const logger = createChildLogger(baseLogger, { organizationID, userID });
    const org = await getOrganization(organizationID, authHeader);
    if (!org) {
      throw new Error('ORGANIZATION_NOT_EXIST');
    }
    const status = String((org as any).status ?? '').toLowerCase();
    if (ORG_NON_AVAILABLE.includes(status)) {
      throw new Error('ORGANIZATION_IS_ON_HOLD');
    }
   
    const email = body.email?.trim() || '';
    const phone = (body.phone ?? '').toString().replace(/\s/g, '');
    if (!email && !phone) {
      throw new Error('EMAIL_OR_PHONE_REQUIRED');
    }
    const user = await userRepository.findUserByEmailOrPhoneInOrg(organizationID, email || undefined, phone || undefined);
    console.log('User Repository Response', JSON.stringify(user));
    
    if (!user) {
      return { success: false };
    }
    console.log('User Details', JSON.stringify(user));
    const memberId = (user as any).userID ?? (user as any).userId;
     
    // FriendModelData: email (EmailObjectModelData), phone (PhoneObjectModelData), invitedUser (string)
    const emailAddress = (user as any).emailAddress ?? '';
    const phoneNumber = (user as any).phoneNumber ?? '';
    const phoneCode = (user as any).phoneCode ?? '';
    const phoneNumb = [String(phoneCode), String(phoneNumber)].filter(Boolean).join('').trim() || phoneNumber;
    const data: {
      email?: { isVerified: boolean; emailId: string; userId: string };
      phone?: { isVerified: boolean; phoneNumb: string; userId: string };
      invitedUser: string;
    } = {
      invitedUser: memberId,
    };
    if (emailAddress) {
      data.email = { isVerified: true, emailId: emailAddress, userId: memberId };
    }
    if (phoneNumb) {
      data.phone = { isVerified: true, phoneNumb, userId: memberId };
    }
    return { success: true, invitedUser: memberId, data };
  }

  async addMember(
    organizationID: string,
    body: {
      userId: string;
      memberId: string;
      userName: string;
      memberName: string;
      relation: string;
      relationship: string;
      emergencyContact: boolean;
      manageHealth?: boolean;
    },
    authHeader?: string
  ): Promise<{ userId: string; memberId: string; organizationID: string; relation: string; relationship: string; emergencyContact: boolean; manageHealth?: boolean }> {
    const userId = body.userId;
    const { memberId, userName, memberName, relation, relationship, emergencyContact, manageHealth } = body;
    const logger = createChildLogger(baseLogger, { organizationID, userId, memberId });

    const org = await getOrganization(organizationID, authHeader);
    if (!org) throw new Error('ORGANIZATION_NOT_EXIST');
    const status = String((org as any).status ?? '').toLowerCase();
    if (ORG_NON_AVAILABLE.includes(status)) throw new Error('ORGANIZATION_IS_ON_HOLD');

    const userDetails = await userRepository.getUser(userId, organizationID);
    if (!userDetails) throw new UserNotFoundError(userId);
    const memberDetails = await userRepository.getUser(memberId, organizationID);
    if (!memberDetails) throw new UserNotFoundError(memberId);

    const userOrgId = (userDetails as any).organizationID ?? (userDetails as any).organizationId;
    const memberOrgId = (memberDetails as any).organizationID ?? (memberDetails as any).organizationId;
    if (userOrgId !== memberOrgId) {
      throw new Error('ORGANIZATION_MISMATCH');
    }

    const relationNorm = (relation || 'FAMILY').toUpperCase();
    const relationshipVal = relationNorm === 'FRIEND' ? '' : (relationship || '');

    await friendFamilyRepository.saveMapping({
      organizationID,
      userId,
      memberId,
      userName,
      memberName,
      relation: relationNorm,
      relationship: relationshipVal,
      emergencyContact,
      manageHealth,
    });

    logger.info({ event: 'friend_family_add_member_success' });
    return {
      userId,
      memberId,
      organizationID,
      relation: relationNorm,
      relationship: relationshipVal,
      emergencyContact,
      manageHealth,
    };
  }

  async updateMember(
    userId: string,
    organizationID: string,
    body: {
      memberId: string;
      fullName?: string;
      relation?: string;
      relationship?: string;
      emergencyContact?: boolean;
      manageHealth?: boolean;
    }
  ): Promise<void> {
    const { memberId, fullName, relation, relationship, emergencyContact, manageHealth } = body;
    const mapping = await friendFamilyRepository.getUserMapping(userId, memberId);
    if (!mapping) {
      throw new Error('MEMBER_NOT_FOUND');
    }
    const updates: Parameters<FriendFamilyRepository['updateMapping']>[2] = {};
    if (fullName !== undefined) updates.memberName = fullName;
    if (relation !== undefined) updates.relation = relation;
    if (relationship !== undefined) updates.relationship = relation?.toUpperCase() === 'FRIEND' ? '' : relationship;
    if (emergencyContact !== undefined) updates.emergencyContact = emergencyContact;
    if (manageHealth !== undefined) updates.manageHealth = manageHealth;
    if (Object.keys(updates).length === 0) return;
    await friendFamilyRepository.updateMapping(userId, memberId, updates);
  }

  async fetchMembers(userId: string): Promise<{ invitee: any[]; inviter: any[] }> {
    const [inviteeRows, inviterRows] = await Promise.all([
      friendFamilyRepository.listInvitees(userId),
      friendFamilyRepository.listInviters(userId),
    ]);

    const invitee: any[] = [];
    for (const row of inviteeRows) {
      const memberId = row.sk.split('#')[1];
      const orgId = row.organizationID;
      const userData = await userRepository.getUser(memberId, orgId);
      invitee.push({
        memberId,
        memberName: row.memberName,
        userID: row.pk.split('#')[1],
        firstName: (userData as any)?.firstName ?? '',
        lastName: (userData as any)?.lastName ?? '',
        emailAddress: (userData as any)?.emailAddress ?? '',
        phoneNumber: (userData as any)?.phoneNumber ?? '',
        relation: row.relation,
        relationship: row.relationship,
        emergencyContact: row.emergencyContact,
      });
    }

    const inviter: any[] = [];
    for (const row of inviterRows) {
      const inviterUserId = row.sk.split('#')[1];
      const orgId = row.organizationID;
      const userData = await userRepository.getUser(inviterUserId, orgId);
      inviter.push({
        memberId: row.pk.split('#')[1],
        memberName: row.memberName,
        userID: inviterUserId,
        firstName: (userData as any)?.firstName ?? '',
        lastName: (userData as any)?.lastName ?? '',
        emailAddress: (userData as any)?.emailAddress ?? '',
        phoneNumber: (userData as any)?.phoneNumber ?? '',
        relation: row.relation,
        relationship: row.relationship,
        emergencyContact: row.emergencyContact,
      });
    }

    return { invitee, inviter };
  }

  async deleteMember(userID: string, memberID: string, organizationID?: string): Promise<void> {
    const mapping1 = await friendFamilyRepository.getUserMapping(userID, memberID);
    const mapping2 = await friendFamilyRepository.getUserMapping(memberID, userID);
    if (!mapping1 && !mapping2) {
      throw new Error('FNF_DOES_NOT_EXIST');
    }
    const [uid, mid] = mapping1 ? [userID, memberID] : [memberID, userID];
    await friendFamilyRepository.deleteMapping(uid, mid);
  }

  /**
   * Check if a Friend & Family invite entry exists (inviterId invited inviteeId).
   * Used by common-backend addons.service checkFnFUser.
   */
  async checkInvite(inviterId: string, inviteeId: string): Promise<FriendFamilyMapping | null> {
    return friendFamilyRepository.getUserMapping(inviterId, inviteeId);
  }
}
