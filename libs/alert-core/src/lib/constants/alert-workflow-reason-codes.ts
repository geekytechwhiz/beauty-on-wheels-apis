/** Stable wire codes for RESOLVE — uppercase snake, API + persistence. */
export enum AlertResolveReasonCode {
  PatientContacted = 'PATIENT_CONTACTED',
  EducationProvided = 'EDUCATION_PROVIDED',
  RetakeRequested = 'RETAKE_REQUESTED',
  DeviceFixedConnected = 'DEVICE_FIXED_CONNECTED',
  EscalatedToNurseOrDoctor = 'ESCALATED_TO_NURSE_OR_DOCTOR',
  IssueResolvedAutomatically = 'ISSUE_RESOLVED_AUTOMATICALLY',
  FalsePositive = 'FALSE_POSITIVE',
  Other = 'OTHER',
}

/** Stable wire codes for DISMISS — uppercase snake, API + persistence. */
export enum AlertDismissReasonCode {
  DuplicateAlert = 'DUPLICATE_ALERT',
  InvalidOrErroneousData = 'INVALID_OR_ERRONEOUS_DATA',
  DeviceError = 'DEVICE_ERROR',
  PatientNotEligible = 'PATIENT_NOT_ELIGIBLE',
  MonitoringPausedOrExcused = 'MONITORING_PAUSED_OR_EXCUSED',
  AlertNoLongerApplicable = 'ALERT_NO_LONGER_APPLICABLE',
  FalsePositive = 'FALSE_POSITIVE',
  Other = 'OTHER',
}
