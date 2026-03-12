import axios, { AxiosInstance } from "axios";
import axiosRetry from "axios-retry";
import { createLogger, serializeError } from '@api-hub/logger';


const logger = createLogger({ service: "http-client", redactPII: true });

export const createHttpClient = (baseURL: string): AxiosInstance => {
  const instance = axios.create({
    baseURL,
    timeout: 15000,
    headers: {
      "Content-Type": "application/json"
    }
  });

  axiosRetry(instance, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) =>
      axiosRetry.isNetworkOrIdempotentRequestError(error)
  });

  instance.interceptors.request.use((config) => {
    logger.info({
      event: "http_request_start",
      method: config.method,
      url: config.url
    });

    return config;
  });

  instance.interceptors.response.use(
    (response) => {
      logger.info({
        event: "http_request_success",
        url: response.config.url,
        status: response.status
      });

      return response;
    },
    (error) => {
      logger.error({
        event: "http_request_failed",
        err: serializeError(error)
      });

      return Promise.reject(error);
    }
  );

  return instance;
};