import { createLogger, createChildLogger } from '@api-hub/observability';
import { UserRepository } from '../repositories/user.repository';
import { FriendFamilyRepository, type FriendFamilyMapping } from '../repositories/friendFamily.repository';
import { UserNotFoundError } from '../utils/errors';
import {
  OrganizationNotExistError,
  OrganizationOnHoldError,
  OrganizationMismatchError,
  FnfLimitReachedError,
  UserAlreadyInvitedBySomeoneError,
  UserAlreadyAddedAsFnfError,
  UserAlreadyExistsError,
  MemberNotFoundError,
  FnfDoesNotExistError,
} from '../errors';
import { getOrganization } from './organization.service';
import { sendSms } from './notification.delivery';
import { WEB_DNS_URL } from '../utils/constants';

const baseLogger = createLogger({ service: 'user-service', redactPII: true });
const userRepository = new UserRepository();
const friendFamilyRepository = new FriendFamilyRepository();

const ORG_NON_AVAILABLE = ['hold', 'on_hold', 'disabled', 'not_exist'];

export class FriendFamilyService {

// async function checkFriendFamilyLimit(userID: string): Promise<boolean> {
//   const inviterHasInvitee = await friendFamilyRepository.checkFriendFamily(userID);
//   if (inviterHasInvitee) {
//     throw new Error('USER_CANNOT_INVITE_MORE_FNF');
//   }
//   return true;
// }
// async function checkFriendFamilyLimit(userID: string): Promise<boolean> {
//   const inviterHasInvitee = await friendFamilyRepository.checkFriendFamily(userID);
//   if (inviterHasInvitee) {
//     throw new Error('USER_CANNOT_INVITE_MORE_FNF');
//   }
//   return true;
// }


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
    const org = await getOrganization(organizationID, authHeader, {
      minimal: true,
    });
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
    
    // console.log("USER: ", user);
    if (!user) {
      // User not found: check inviter F&F limit before handler runs invite flow
      const inviterHasInvitee = await friendFamilyRepository.checkFriendFamily(userID);
      if (inviterHasInvitee) {
        throw new FnfLimitReachedError();
      }
      logger.info({ event: 'friend_family_search_user_not_found_invite_path' });
      return { success: false };
    }

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

    const org = await getOrganization(organizationID, authHeader, {
      minimal: true,
    });
    if (!org) throw new OrganizationNotExistError();
    const status = String((org as any).status ?? '').toLowerCase();
    if (ORG_NON_AVAILABLE.includes(status)) throw new OrganizationOnHoldError();

    const userDetails = await userRepository.getUser(userId, organizationID);
    if (!userDetails) throw new UserNotFoundError(userId);
    const memberDetails = await userRepository.getUser(memberId, organizationID);
    if (!memberDetails) throw new UserNotFoundError(memberId);

    const userOrgId = (userDetails as any).organizationID ?? (userDetails as any).organizationId;
    const memberOrgId = (memberDetails as any).organizationID ?? (memberDetails as any).organizationId;
    if (userOrgId !== memberOrgId) throw new OrganizationMismatchError();

    // ── Step 1: member is a PATIENT ───────────────────────────────────────────
    // A patient already exists in the system → cannot be added as an F&F member.
    const memberUserType = String((memberDetails as any).userType ?? '').toUpperCase();
    const memberDefinedRole = String((memberDetails as any).definedRoleCode ?? '').toUpperCase();
    const memberRoleName = String((memberDetails as any).roleName ?? '').toUpperCase();
    // console.log("MEMBER ROLE NAME: ", memberRoleName);
    if (memberUserType === 'PATIENT' || memberDefinedRole === 'PATIENT' || memberRoleName === 'PATIENT') {
      logger.warn({ event: 'friend_family_add_member_is_patient', userId, memberId });
      throw new UserAlreadyExistsError((memberDetails as any).emailAddress ?? memberId);
    }

    // ── Step 2: memberId already has an inviter (FNF limit) ───────────────────
    // INVITE_F&F#memberId → INVITER#[any] → memberId is already someone else's F&F invitee
    const memberAlreadyLinked = await friendFamilyRepository.checkFriendFamily(memberId, true);
    if (memberAlreadyLinked) {
      logger.warn({ event: 'friend_family_add_member_already_invited', userId, memberId });
      throw new FnfLimitReachedError(); // USER_CANNOT_INVITE_MORE_FNF
    }

    // ── Step 3: requester (userId) already invited someone ────────────────────
    // INVITE_F&F#userId → INVITEE#[any] OR INVITE_F&F#userId → INVITER#[any]
    await this.checkFriendFamilyLimit(userId); // throws USER_ALREADY_INVITED_BY_SOMEONE if linked

    // ── Duplicate pair guard (both directions A→B and B→A) ────────────────────
    const existingLink =
      (await friendFamilyRepository.getUserMapping(userId, memberId)) ??
      (await friendFamilyRepository.getUserMapping(memberId, userId));
    if (existingLink) {
      logger.warn({ event: 'friend_family_add_member_already_exists', userId, memberId });
      throw new UserAlreadyAddedAsFnfError();
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

    const phoneCodeRaw = String((memberDetails as any).phoneCode ?? '').trim();
    const phoneNumberRaw = String((memberDetails as any).phoneNumber ?? '')
      .replace(/\s/g, '')
      .trim();
    const inviteePhone =
      phoneCodeRaw && phoneNumberRaw
        ? `${phoneCodeRaw}${phoneNumberRaw}`
        : phoneNumberRaw;

    if (inviteePhone) {
      try {
        const orgAny = org as Record<string, unknown>;
        const orgInfo = (orgAny?.organizationInfo as Record<string, unknown>) || {};
        const orgName =
          String(
            orgInfo.organizationName ??
              orgInfo.name ??
              orgAny?.name ??
              '',
          ).trim() || organizationID;
          
          const baseInviteUrl = (process.env.WEB_URL || WEB_DNS_URL || '').trim();
          const invitationLink = baseInviteUrl;

        await sendSms({
          phone: inviteePhone,
          template: 'FNF_INVITE_SENT',
          templateData: {
            inviterName: userName,
            orgName,
            invitationLink,
          },
        });
      } catch (smsErr) {
        logger.warn({
          event: 'friend_family_add_member_sms_failed',
          memberId,
          err: smsErr instanceof Error ? smsErr.message : String(smsErr),
        });
      }
    } else {
      logger.info({ event: 'friend_family_add_member_sms_skipped_no_phone', memberId });
    }
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
    if (!mapping) throw new MemberNotFoundError(memberId);
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
    if (!mapping1 && !mapping2) throw new FnfDoesNotExistError();
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
  /**
   * Validates that userID (the requester / inviter) is free to create a new F&F link.
   *
   * DynamoDB key meanings for userID:
   *   pk = INVITE_F&F#userID, sk = INVITEE#[memberId]  → userID already INVITED someone
   *   pk = INVITE_F&F#userID, sk = INVITER#[inviterId] → userID was already INVITED BY someone
   *
   * Both cases mean userID is already in a F&F relationship → USER_ALREADY_INVITED_BY_SOMEONE.
   */
  async checkFriendFamilyLimit(userID: string): Promise<boolean> {
    // Scenario 2a — INVITE_F&F#userID → INVITEE#[any]:
    // userID already invited / added someone as their F&F member
    const inviterHasInvitee = await friendFamilyRepository.checkFriendFamily(userID);
    if (inviterHasInvitee) throw new UserAlreadyInvitedBySomeoneError(); // USER_ALREADY_INVITED_BY_SOMEONE

    // Scenario 2b — INVITE_F&F#userID → INVITER#[any]:
    // userID is already someone else's F&F member (was invited by another user)
    const inviteeInviterMapping = await friendFamilyRepository.checkFriendFamily(userID, true);
    if (inviteeInviterMapping) throw new UserAlreadyInvitedBySomeoneError(); // USER_ALREADY_INVITED_BY_SOMEONE

    return true;
  }
}
