import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { PartnerConfig } from './adapter.interface';
import { requestWithRetry } from '../../utils/http/request-with-retry';
import { CircuitBreaker } from '../../utils/http/circuit-breaker';
import { translateError } from '../../utils/error/error-translator';
import { getSecretValue, parseSecretAsJson } from './secrets-helper';

/**
 * Base adapter providing shared functionality for all partner adapters.
 * Implements:
 * - Authentication header generation
 * - HTTP request with retry/backoff
 * - Optional circuit breaker
 * - Standardized error handling
 */
export abstract class BasePartnerAdapter {
  protected readonly circuitBreaker?: CircuitBreaker;

  constructor(protected readonly config: PartnerConfig) {
    if (config.circuitBreaker?.enabled) {
      this.circuitBreaker = new CircuitBreaker(
        config.circuitBreaker.failureThreshold ?? 5,
        config.circuitBreaker.resetTimeoutMs ?? 60000
      );
    }
  }

  /**
   * Get authentication headers for partner API.
   * Subclasses can override to customize header name/format.
   */
  protected async getAuthHeaders(): Promise<Record<string, string>> {
    const apiKey = await this.getApiKey();
    return {
      'Content-Type': 'application/json',
      ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
    };
  }

  /**
   * Get API key from AWS Secrets Manager.
   */
  protected async getApiKey(): Promise<string> {
    if (!this.config.authConfig?.credentialsSecretArn) {
      throw new Error(
        `Missing credentials configuration for ${this.config.partnerId}`
      );
    }

    const raw = await getSecretValue(
      this.config.authConfig.credentialsSecretArn
    );
    const parsed = parseSecretAsJson(raw);
    return (
      (typeof parsed.apiKey === 'string' ? parsed.apiKey : null) ?? raw
    );
  }

  /**
   * Get base URL with trailing slash removed.
   */
  protected baseUrl(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }

  /**
   * Execute HTTP request with retry, circuit breaker, and error handling.
   * All partner API calls should use this method.
   */
  protected async request<T = unknown>(
    config: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    const { partnerId } = this.config;

    const requestConfig: AxiosRequestConfig = {
      timeout: this.config.timeout ?? 10000,
      ...config,
    };

    try {
      if (this.circuitBreaker) {
        return await this.circuitBreaker.execute(() =>
          requestWithRetry<T>(requestConfig)
        );
      }
      return await requestWithRetry<T>(requestConfig);
    } catch (error) {
      translateError(partnerId, error);
    }
  }
}
