import axios from "axios";

export class NotificationClient {

  async sendSMS(
    phone: string,
    template: string,
    templateData: Record<string, unknown>,
    correlationId?: string,
  ) {

    return axios.post(
      `${process.env.NOTIFICATION_API}/sms`,
      {
        phone,
        template,
        templateData,
      },
      {
        headers: {
          "x-correlation-id": correlationId,
        },
      },
    );

  }

  async sendEmail(
    email: string,
    template: string,
    templateData: Record<string, unknown>,
    correlationId?: string,
  ) {

    return axios.post(
      `${process.env.NOTIFICATION_API}/email`,
      {
        email,
        template,
        templateData,
      },
      {
        headers: {
          "x-correlation-id": correlationId,
        },
      },
    );

  }

  async sendPush(
    deviceToken: string,
    template: string,
    templateData: Record<string, unknown>,
    correlationId?: string,
  ) {

    return axios.post(
      `${process.env.NOTIFICATION_API}/push`,
      {
        deviceToken,
        template,
        templateData,
      },
      {
        headers: {
          "x-correlation-id": correlationId,
        },
      },
    );

  }

}