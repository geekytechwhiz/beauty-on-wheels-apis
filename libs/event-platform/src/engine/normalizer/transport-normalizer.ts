export function extractRecords(rawEvent: any): unknown[] | null {
    if (
      rawEvent &&
      typeof rawEvent === 'object' &&
      'Records' in rawEvent &&
      Array.isArray(rawEvent.Records)
    ) {
      return rawEvent.Records;
    }
  
    return null;
  }