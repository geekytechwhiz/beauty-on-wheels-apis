import { serializeError } from '@api-hub/observability';
import { FriendFamilyService } from "../services/friendFamily.service";

export interface FriendFamilyInput {
  name?: string
  email?: string
  phone?: string
  phoneCode?: string
  relation?: string
}

export async function handleFriendFamilyLink(
  user: any,
  fnfInput: FriendFamilyInput | undefined,
  organizationID: string,
  authHeader: string | undefined,
  logger: any,
) {
  const friendFamilyService = new FriendFamilyService();
  if (!fnfInput || Object.keys(fnfInput).length === 0) {
    return;
  }

  const fullNameRaw = String(fnfInput.name || '').trim();

  const fnfEmail = String(fnfInput.email || '').trim();

  const fnfPhoneCode = String(fnfInput.phoneCode || '').trim();

  const fnfPhone = String(fnfInput.phone || '').trim();

  const fullPhoneNumber = fnfPhoneCode
    ? `${fnfPhoneCode}${fnfPhone}`
    : fnfPhone;

  const friendNFamilyFullName =
    fullNameRaw || 'F&F Member';

  const relationRaw = String(
    fnfInput.relation || 'family'
  ).toLowerCase();

  const relation =
    relationRaw === 'friend'
      ? 'FRIEND'
      : 'FAMILY';

  const relationship =
    relation === 'FAMILY'
      ? relationRaw !== 'friend'
        ? relationRaw
        : ''
      : '';

  const userName =
    user.fullName ||
    `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
    user.userID;

  try {

    const searchResult =
      await friendFamilyService.searchFnf(
        organizationID,
        user.userID,
        {
          email: fnfEmail || undefined,
          phone: fullPhoneNumber || undefined,
          fullName: friendNFamilyFullName,
          invite: fnfEmail ? 'email' : 'phone',
          relation,
          relationship,
          emergencyContact: true,
        },
        authHeader,
      );

    const memberId = searchResult?.invitedUser;

    if (searchResult?.success && memberId) {

      await friendFamilyService.addMember(
        organizationID,
        {
          userId: user.userID,
          memberId,
          userName,
          memberName: friendNFamilyFullName,
          relation,
          relationship,
          emergencyContact: true,
          manageHealth: false,
        },
        authHeader,
      );

      logger.info({
        event: 'friend_family_linked',
        userId: user.userID,
        memberId,
      });

    } else {

      logger.warn({
        event: 'friend_family_not_found',
        message:
          'F&F user not found; invite separately or link later',
      });

    }

  } catch (err) {

    logger.warn({
      event: 'friend_family_link_failed',
      err: serializeError(err),
    });

  }

}