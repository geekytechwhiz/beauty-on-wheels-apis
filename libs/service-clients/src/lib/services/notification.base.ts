import { NotificationClient } from "../client/notification.client";

export abstract class NotificationBase {

  protected client = new NotificationClient();

  protected async sendSMS(
    phone: string,
    template: string,
    templateData: Record<string, unknown>,
    correlationId?: string,
  ) {

    return this.client.sendSMS(
      phone,
      template,
      templateData,
      correlationId,
    );

  }

  protected async sendEmail(
    email: string,
    template: string,
    templateData: Record<string, unknown>,
    correlationId?: string,
  ) {

    return this.client.sendEmail(
      email,
      template,
      templateData,
      correlationId,
    );

  }

  protected async sendPush(
    deviceToken: string,
    template: string,
    templateData: Record<string, unknown>,
    correlationId?: string,
  ) {

    return this.client.sendPush(
      deviceToken,
      template,
      templateData,
      correlationId,
    );

  }

}