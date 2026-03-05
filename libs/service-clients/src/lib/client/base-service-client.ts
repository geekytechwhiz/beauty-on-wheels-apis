import { AxiosInstance } from "axios";
import { createHttpClient } from "./axios-client";
import {
  createLogger,
  createChildLogger,
  serializeError,
} from "@api-hub/logger";

const baseLogger = createLogger({ service: "service-client", redactPII: true });

export abstract class BaseClient {
  protected client: AxiosInstance;
  protected serviceName: string;

  constructor(baseUrl: string, serviceName: string) {
    this.client = createHttpClient(baseUrl);
    this.serviceName = serviceName;
  }

  protected async get<T>(
    path: string,
    authHeader?: string
  ): Promise<T | null> {
    return this.request<T>("get", path, undefined, authHeader);
  }

  protected async post<T>(
    path: string,
    body: unknown,
    authHeader?: string
  ): Promise<T | null> {
    return this.request<T>("post", path, body, authHeader);
  }

  protected async put<T>(
    path: string,
    body: unknown,
    authHeader?: string
  ): Promise<T | null> {
    return this.request<T>("put", path, body, authHeader);
  }

  protected async delete<T>(
    path: string,
    authHeader?: string
  ): Promise<T | null> {
    return this.request<T>("delete", path, undefined, authHeader);
  }

  private async request<T>(
    method: "get" | "post" | "put" | "delete",
    path: string,
    body?: unknown,
    authHeader?: string
  ): Promise<T | null> {
    const logger = createChildLogger(baseLogger, {
      serviceName: this.serviceName,
      path,
    });

    try {
      const response = await this.client.request<T>({
        method,
        url: path,
        data: body,
        headers: {
          ...(authHeader ? { Authorization: authHeader } : {}),
          "X-Service-Name": this.serviceName,
        },
      });

      return response.data;
    } catch (err) {
      logger.error({
        event: "service_request_error",
        err: serializeError(err),
      });

      return null;
    }
  }
}