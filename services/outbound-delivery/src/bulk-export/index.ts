/**
 * Bulk $export job skeleton — kick off and poll NDJSON export jobs.
 */
export interface BulkExportJob {
  jobId: string;
  status: 'accepted' | 'in-progress' | 'completed' | 'failed';
  request?: string;
  output?: Array<{ type: string; url: string }>;
  error?: string;
}

export async function startBulkExport(
  _params: { patientId?: string; resourceTypes?: string[]; since?: string }
): Promise<BulkExportJob> {
  return {
    jobId: `export-${Date.now()}`,
    status: 'accepted',
  };
}

export async function getBulkExportStatus(_jobId: string): Promise<BulkExportJob | null> {
  return null;
}
