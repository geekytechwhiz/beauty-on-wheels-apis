import { NotificationBase } from "@api-hub/service-clients";

export class UserNotificationService extends NotificationBase {

  async sendWelcomeNotification(
    user: any,
    orgDetails: any,
    correlationId?: string,
  ) {

    const template =
      user.userType === "STAFF"
        ? "WELCOME_STAFF"
        : "WELCOME_USER";

    const templateData = {

      USER_FIRST_NAME: user.firstName,

      ORG_NAME: orgDetails?.name,

      ORG_ADDRESS:
        orgDetails?.organizationAddress ||
        orgDetails?.address,

    };

    const phone = this.buildPhone(user);

    const deviceToken =
      user.deviceToken ||
      user.device;

    const promises: Promise<any>[] = [];

    if (user.emailAddress) {
      promises.push(
        this.sendEmail(
          user.emailAddress,
          template,
          templateData,
          correlationId,
        ),
      );
    }

    if (phone) {
      promises.push(
        this.sendSMS(
          phone,
          template,
          templateData,
          correlationId,
        ),
      );
    }

    if (deviceToken) {
      promises.push(
        this.sendPush(
          deviceToken,
          template,
          templateData,
          correlationId,
        ),
      );
    }

    await Promise.all(promises);

  }

  private buildPhone(user: any) {

    if (!user.phoneNumber) return undefined;

    const code = user.phoneCode || "";

    return code
      ? `${code}${user.phoneNumber}`
      : user.phoneNumber;

  }

}