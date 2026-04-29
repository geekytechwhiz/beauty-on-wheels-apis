import { randomUUID } from 'crypto';

import { createLogger } from '@api-hub/logger';

import {

  AlertRepository,

  type AlertRecord,

  type CreateAlertInput,

  type UpdateAlertInput,

  type AlertState,

} from '@api-hub/alert-repository';

import { validatePatientContext } from './clients/user-service.client';

import { validateOrganizationContext } from './clients/organization-service.client';

import type { CreateAlertPayload } from './create-alert.types';



const log = createLogger({ service: 'alert-service', redactPII: true });



/**

 * Resolves the human-readable summary stored on the alert: explicit `triggerSummary`, else template code + params,

 * else a minimal default from `inputType`.

 */

function buildTriggerSummary(input: CreateAlertInput): string {

  if (input.triggerSummary?.trim()) return input.triggerSummary.trim();

  if (input.triggerSummaryTemplateCode) {

    const p = input.triggerSummaryParams;

    const hint = p && typeof p === 'object' && Object.keys(p).length ? ` ${JSON.stringify(p)}` : '';

    return `${input.triggerSummaryTemplateCode}${hint}`;

  }

  return `Alert: ${input.inputType}`;

}



/**

 * Use-case / orchestration layer for alerts. Owns idempotency policy, upstream patient/org validation, and

 * transaction race handling; persists only through {@link AlertRepository}. No API Gateway envelope or JWT parsing.

 *

 * @see `apps/alert-service/docs/http-api-implementation-guide.md` §3

 */

export class AlertService {

  constructor(private readonly repo: AlertRepository = new AlertRepository()) {}



  /**

   * Creates an alert or returns an existing one when the same `inputEventId` was already used for this organization

   * (EVENT# idempotency). The same patient and org can have many alerts; they must use different idempotency keys.

   *

   * Omitted `inputEventId` yields a new UUID idempotency key.

   * **`inputType` and `sourceType` must be set by the caller** (e.g. from the HTTP body or async producer), not inferred here.

   *

   * @param authHeader - Forwarded to user-service / organization-service for “in org” checks.

   * @returns `duplicate: true` when replaying the same idempotency key for the same org (HTTP layer should respond 409).

   */

  async createAlert(payload: CreateAlertPayload, authHeader?: string): Promise<{ record: AlertRecord; duplicate: boolean }> {

    const input: CreateAlertInput = { ...payload };



    const idempotencyKey = input.inputEventId ?? randomUUID();

    const resolvedSummary = buildTriggerSummary(input);

    const keyed: CreateAlertInput = {

      ...input,

      inputEventId: idempotencyKey,

      triggerSummary: resolvedSummary,

    };



    const resolution = await this.repo.resolveInputEventId(idempotencyKey, input.organizationId);

    if (resolution === 'foreign_org') {

      const e = new Error('This idempotency key is already in use') as Error & { statusCode: number; code: string };

      e.statusCode = 409;

      e.code = 'IDEMPOTENCY_KEY_IN_USE';

      throw e;

    }

    if (resolution !== 'missing') {

      log.info({

        event: 'alert_idempotent_replay',

        message: 'Idempotent replay for inputEventId',

        inputEventId: idempotencyKey,

        alertId: resolution.alertId,

        organizationId: input.organizationId,

      });

      return { record: resolution, duplicate: true };

    }



    await Promise.all([

      validatePatientContext(input.patientId, input.organizationId, authHeader),

      validateOrganizationContext(input.organizationId, authHeader),

    ]);



    try {

      const record = await this.repo.createAlert(keyed);

      return { record, duplicate: false };

    } catch (e: unknown) {

      const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: string }).name) : '';

      if (name === 'TransactionCanceledException') {

        const again = await this.repo.resolveInputEventId(idempotencyKey, input.organizationId);

        if (again !== 'missing' && again !== 'foreign_org') {

          log.warn({

            event: 'alert_idempotent_after_transaction_race',

            message: 'Resolved duplicate after TransactionCanceledException',

            inputEventId: idempotencyKey,

            alertId: again.alertId,

            organizationId: input.organizationId,

          });

          return { record: again, duplicate: true };

        }

      }

      throw e;

    }

  }



  getAlert(alertId: string): Promise<AlertRecord | null> {

    return this.repo.getAlertById(alertId);

  }



  listPatientAlerts(

    patientId: string,

    q: { openOnly?: boolean; inputType?: string; limit?: number },

  ): Promise<AlertRecord[]> {

    return this.repo.queryPatientAlerts(patientId, q);

  }



  listOrgAlerts(

    organizationId: string,

    q: { state?: AlertState; limit?: number; unassignedOnly?: boolean },

  ): Promise<AlertRecord[]> {

    return this.repo.queryOrgAlerts(organizationId, q);

  }



  listUserAlerts(userId: string, q: { state?: AlertState; limit?: number }): Promise<AlertRecord[]> {

    return this.repo.queryUserAlerts(userId, q);

  }



  updateAlert(alertId: string, patch: UpdateAlertInput): Promise<AlertRecord | null> {

    return this.repo.updateAlert(alertId, patch);

  }

}


