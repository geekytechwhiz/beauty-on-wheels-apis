import { DEFAULT_ASSIGN_SLA_MINUTES, DEFAULT_RESOLVE_SLA_MINUTES, ENV_ASSIGN_SLA_MINUTES, ENV_RESOLVE_SLA_MINUTES } from "../../constants/alert.constants";
import { CreateAlertRequest } from "../api/create-alert.request";
import { AlertState } from "../types/alert-state.type";

export function  tableName(): string {
    const t = process.env.ALERT_TABLE;
    if (!t) {
      throw new Error('ALERT_TABLE environment variable is not set');
    }
    return t;
  }
  
  export function  addMinutesIso(iso: string, minutes: number): string {
    const d = new Date(iso);
    d.setUTCMinutes(d.getUTCMinutes() + minutes);
    return d.toISOString();
  }
  
  export function  defaultAssignSlaMinutes(): number {
    const n = Number(process.env[ENV_ASSIGN_SLA_MINUTES]);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_ASSIGN_SLA_MINUTES;
  }
  
  export function  defaultResolveSlaMinutes(): number {
    const n = Number(process.env[ENV_RESOLVE_SLA_MINUTES]);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_RESOLVE_SLA_MINUTES;
  }
  
  export type AlertCreateContext = {
    alertId: string;
    now: string;
    idempotencyKey: string;
    input: CreateAlertRequest;
    state: AlertState;
    priority: string;
    orgPk: string;
    patPk: string;
    groupingKey: string;
    assignSlaMinutes: number;
    resolveSlaMinutes: number;
    assignSlaDueAt: string;
    resolveSlaDueAt?: string;
    gsi1pk: string;
    gsi1sk: string;
    gsi3pk: string;
    gsi3sk: string;
    gsi5pk: string;
    gsi5sk: string;
  };
  
  export type CreateContextInput = {
    alertId: string;
    now: string;
    idempotencyKey: string;
    input: CreateAlertRequest;
  };
  