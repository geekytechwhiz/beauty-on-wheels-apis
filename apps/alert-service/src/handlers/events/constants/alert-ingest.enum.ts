/** Alert `inputType` values set by EventBridge ingest mappers (not supplied on the event payload). */
export enum AlertIngestInputType {
  MissedReading = 'MISSED_READING',
  ThresholdBreach = 'THRESHOLD_BREACH',
}

/** Alert `sourceType` values paired with {@link AlertIngestInputType} in ingest mappers. */
export enum AlertIngestSourceType {
  MonitoringService = 'MONITORING_SERVICE',
  DeviceMonitoring = 'DEVICE_MONITORING',
}
