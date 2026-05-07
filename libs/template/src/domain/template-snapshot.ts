import { createHash } from 'crypto';

/**
 * Immutable snapshot fingerprint for published template documents.
 */
export function computeSnapshotId(documentJson: unknown): string {
  const stable = JSON.stringify(documentJson);
  return createHash('sha256').update(stable).digest('hex');
}
