import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

// UI payloads used by the frontend to render the template authoring form.
// For now, Template Service injects them based on `meta.templateType`.
const UI_FILENAME_BY_TEMPLATE_TYPE: Record<string, string> = {
  ALERT: 'alert-api-response.json',
  ALERT_POLICY: 'alert-api-response.json',
  MONITORING: 'monitoring-api-response.json',
};

let s3Client: S3Client | null = null;
const uiResponseCache = new Map<string, unknown>();

async function streamToString(body: unknown): Promise<string> {
  if (body == null) return '';

  // Common types returned by @aws-sdk/client-s3.
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf-8');

  // AWS SDK v3 Body is typically a Node.js readable stream.
  const stream = body as AsyncIterable<unknown>;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as any));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function getS3Client(): S3Client {
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
  });
  return s3Client;
}

/**
 * Fetches UI JSON from S3 and caches it in-memory per Lambda instance.
 * Returns `null` when the templateType is not mapped (or when the object cannot be fetched/parsed).
 */
export async function getTemplateUiApiResponse(templateType?: string | null): Promise<unknown | null> {
  const normalized = templateType?.trim().toUpperCase();
  if (!normalized) return null;

  const fileName = UI_FILENAME_BY_TEMPLATE_TYPE[normalized];
  if (!fileName) return null;

  if (uiResponseCache.has(normalized)) return uiResponseCache.get(normalized) ?? null;

  const bucket = (process.env.TEMPLATE_UI_BUCKET ?? 'templates').trim();
  const key = fileName;

  try {
    const resp = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bodyText = await streamToString(resp.Body);
    const parsed = JSON.parse(bodyText);
    uiResponseCache.set(normalized, parsed);
    return parsed;
  } catch {
    // Do not block template reads if the UI payload is missing/unreachable.
    return null;
  }
}



export type TemplateField = {
  code: string;
  displayName: string;
  type: string;

  labelKey?: string;
  placeholderKey?: string;
   options: {
      labelKey: string;
      value: string;
    }[]
  validation: {
    required: {
      value: boolean;
      messageKey?: string;
    };
  };
};
