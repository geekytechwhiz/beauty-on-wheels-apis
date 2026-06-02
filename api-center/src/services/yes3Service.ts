export interface Yes3FileObject {
  key: string;
  fileName: string;
  contentType: string;
  size: number;
  lastModified?: string;
}

export interface GetUploadUrlInput {
  folder: string;
  fileName: string;
  contentType: string;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  key: string;
}

export interface GetDownloadUrlInput {
  folder: string;
  fileName: string;
}

export interface DownloadUrlResponse {
  downloadUrl: string;
  key: string;
}

export interface ListFolderFilesInput {
  folder: string;
}

const DEFAULT_YES3_API_BASE = 'https://rcw88q9f06.execute-api.us-east-1.amazonaws.com/dev';

export function getYes3ApiBase(): string {
  const raw = import.meta.env.VITE_YES3_API_BASE_URL?.trim();
  const base = raw || DEFAULT_YES3_API_BASE;
  return base.replace(/\/$/, '');
}

function normalizeFolder(folder: string): string {
  const normalized = folder.trim().replace(/^\/+|\/+$/g, '');
  if (!normalized) {
    throw new Error('Folder is required.');
  }
  return normalized;
}

function normalizeFileName(fileName: string): string {
  const normalized = fileName.trim().replace(/^\/+/, '');
  if (!normalized) {
    throw new Error('File name is required.');
  }
  if (normalized.includes('/')) {
    throw new Error('File name cannot contain "/".');
  }
  return normalized;
}

async function yes3ApiJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${getYes3ApiBase()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text || `${response.status} ${response.statusText}`;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      message = parsed.error ?? parsed.message ?? message;
    } catch {
      // keep text
    }
    throw new Error(message);
  }
  if (!text) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Yes3 API returned invalid JSON from ${path}.`);
  }
}

/** Presigned PUT URL for uploading a single file into a folder. */
export async function getUploadUrl({
  folder,
  fileName,
  contentType,
}: GetUploadUrlInput): Promise<UploadUrlResponse> {
  return yes3ApiJson<UploadUrlResponse>('/upload-url', {
    method: 'POST',
    body: JSON.stringify({
      folder: normalizeFolder(folder),
      fileName: normalizeFileName(fileName),
      contentType: contentType.trim(),
    }),
  });
}

/** Presigned GET URL for downloading a single file. */
export async function getDownloadUrl({
  folder,
  fileName,
}: GetDownloadUrlInput): Promise<DownloadUrlResponse> {
  return yes3ApiJson<DownloadUrlResponse>('/download-url', {
    method: 'POST',
    body: JSON.stringify({
      folder: normalizeFolder(folder),
      fileName: normalizeFileName(fileName),
    }),
  });
}

/** List files under an S3 folder prefix. */
export async function listFolderFiles({
  folder,
}: ListFolderFilesInput): Promise<Yes3FileObject[]> {
  const normalizedFolder = normalizeFolder(folder);
  const result = await yes3ApiJson<{ files: Yes3FileObject[] }>(
    `/list-files?folder=${encodeURIComponent(normalizedFolder)}`,
    { method: 'GET' },
  );
  return result.files ?? [];
}
