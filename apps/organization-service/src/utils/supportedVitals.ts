/**
 * Metadata for each vital type. Used to build supportedVitals array in the format
 * expected by clients: [ { "code": { code, activityType?, device, displayName, vitalType } }, ... ]
 */
export interface VitalMeta {
  code: string;
  activityType?: string;
  device: boolean;
  displayName: string;
  vitalType: string;
}

const VITAL_METADATA: Record<string, VitalMeta> = {
  steps: { code: 'steps', activityType: 'stepCounts', device: false, displayName: 'Steps', vitalType: 'Steps' },
  duration: { code: 'duration', activityType: 'duration', device: false, displayName: 'Activity', vitalType: 'Activity' },
  bloodPressure: { code: 'bloodPressure', device: true, displayName: 'Blood Pressure', vitalType: 'BloodPressure' },
  oximeter: { code: 'oximeter', device: true, displayName: 'Oximeter', vitalType: 'Oximeter' },
  glucose: { code: 'glucose', device: true, displayName: 'Glucose', vitalType: 'Glucose' },
  weight: { code: 'weight', device: true, displayName: 'Weight', vitalType: 'Weight' },
  bodyComposition: { code: 'bodyComposition', device: true, displayName: 'Body Composition', vitalType: 'BodyComposition' },
  cholesterol: { code: 'cholesterol', device: true, displayName: 'Cholesterol', vitalType: 'Cholesterol' },
  bodyTemperature: { code: 'bodyTemperature', device: true, displayName: 'Body Temperature', vitalType: 'BodyTemperature' },
  hydration: { code: 'hydration', device: false, displayName: 'Hydration', vitalType: 'Hydration' },
  sleep: { code: 'sleep', device: false, displayName: 'Sleep', vitalType: 'Sleep' },
  ecg: { code: 'ecg', device: true, displayName: 'ECG', vitalType: 'ECG' },
  pulseRate: { code: 'pulseRate', device: true, displayName: 'Pulse Rate', vitalType: 'PulseRate' },
  heartRate: { code: 'heartRate', device: true, displayName: 'Heart Rate', vitalType: 'HeartRate' },
  pulse: { code: 'pulse', device: true, displayName: 'Pulse', vitalType: 'Pulse' },
  bloodGlucose: { code: 'bloodGlucose', device: true, displayName: 'Blood Glucose', vitalType: 'BloodGlucose' },
  irregularHeartbeatDetection: { code: 'irregularHeartbeatDetection', device: true, displayName: 'Irregular Heartbeat', vitalType: 'IrregularHeartbeatDetection' },
  atrialFibrillationDetection: { code: 'atrialFibrillationDetection', device: true, displayName: 'Atrial Fibrillation', vitalType: 'AtrialFibrillationDetection' },
};

function toPascalCase(s: string): string {
  return s.replace(/(?:^|\W)(\w)/g, (_, c) => c.toUpperCase()).replace(/\s+/g, '');
}
function toDisplayName(s: string): string {
  return s.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

/**
 * Build supportedVitals array from vital codes.
 * Output format: [ { "steps": { code, activityType?, device, displayName, vitalType } }, ... ]
 */
export function buildSupportedVitalsArray(codes: string[]): Array<Record<string, VitalMeta>> {
  const seen = new Set<string>();
  const result: Array<Record<string, VitalMeta>> = [];
  for (const code of codes) {
    const key = (code || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const meta = VITAL_METADATA[key];
    const entry: VitalMeta = meta ?? {
      code: key,
      device: true,
      displayName: toDisplayName(key),
      vitalType: toPascalCase(key),
    };
    result.push({ [key]: entry });
  }
  return result;
}

export interface DeviceListResponse {
  data?: { items?: Array<{ supportedVitals?: string[] }> };
  items?: Array<{ supportedVitals?: string[] }>;
}

/**
 * Fetch device list from device service (POST /devices/list).
 * @param organizationId - organization ID
 * @param action - 'organization' = all global devices; 'patient' = devices assigned to this org (legacy get_device_list PATIENT)
 */
export async function fetchOrganizationDevices(
  organizationId: string,
  authHeader?: string,
  action: 'organization' | 'patient' = 'patient'
): Promise<Array<{ supportedVitals?: string[] }> | null> {
  const baseUrl = process.env.DEVICE_API_BASE_URL;
  if (!baseUrl) return null;
  const url = `${baseUrl.replace(/\/$/, '')}/devices/list`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader) headers['Authorization'] = authHeader;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, organizationID: organizationId }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as DeviceListResponse;
    const items = body?.data?.items ?? body?.items ?? null;
    return Array.isArray(items) ? items : null;
  } catch {
    return null;
  }
}

/**
 * Extract vital codes from org's stored supportedVitals (legacy format: array of { [code]: {...} } or array of strings).
 */
export function vitalCodesFromOrgSupportedVitals(supportedVitals: unknown): string[] {
  if (!Array.isArray(supportedVitals) || supportedVitals.length === 0) return [];
  const codes: string[] = [];
  for (const item of supportedVitals) {
    if (typeof item === 'string' && item.trim()) {
      codes.push(item.trim());
      continue;
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const key = Object.keys(item)[0];
      if (key && typeof key === 'string' && key.trim()) codes.push(key.trim());
    }
  }
  return codes;
}
