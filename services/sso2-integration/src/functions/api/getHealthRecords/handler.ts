// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION: Get Health Records  (Protected MyVitalRx API)
// ROUTE:    GET /api/patients/{patientId}/health-records
// AUTH:     JWT required — scope: read:health-records
//
// Returns a patient's health records including vitals, diagnoses, medications.
// ─────────────────────────────────────────────────────────────────────────────

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { AuthorizerContext } from "../../../types";
import { successResponse, Responses } from "../../../utils/response";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("GetHealthRecords");

// ── Mock health records (replace with real DB/service calls) ──────────────────
interface VitalSign {
  recordedAt: string;
  bloodPressure: string;
  heartRate: number;
  temperature: number;
  oxygenSaturation: number;
  weight: number;
}

interface Diagnosis {
  code: string;         // ICD-10 code
  description: string;
  diagnosedAt: string;
  status: "active" | "resolved" | "chronic";
}

interface Medication {
  name: string;
  dosage: string;
  frequency: string;
  prescribedAt: string;
  prescribedBy: string;
  status: "active" | "discontinued";
}

interface HealthRecord {
  patientId: string;
  lastUpdated: string;
  vitals: VitalSign[];
  diagnoses: Diagnosis[];
  medications: Medication[];
  labResultsCount: number;
}

const MOCK_HEALTH_RECORDS: Record<string, HealthRecord> = {
  "patient-001": {
    patientId: "patient-001",
    lastUpdated: "2024-03-15T10:30:00Z",
    vitals: [
      {
        recordedAt: "2024-03-15T10:00:00Z",
        bloodPressure: "130/85",
        heartRate: 78,
        temperature: 98.6,
        oxygenSaturation: 98,
        weight: 185,
      },
      {
        recordedAt: "2024-02-10T09:30:00Z",
        bloodPressure: "128/82",
        heartRate: 75,
        temperature: 98.4,
        oxygenSaturation: 99,
        weight: 183,
      },
    ],
    diagnoses: [
      {
        code: "E11.9",
        description: "Type 2 diabetes mellitus without complications",
        diagnosedAt: "2020-06-15",
        status: "chronic",
      },
      {
        code: "I10",
        description: "Essential (primary) hypertension",
        diagnosedAt: "2021-03-20",
        status: "chronic",
      },
    ],
    medications: [
      {
        name: "Metformin",
        dosage: "500mg",
        frequency: "Twice daily",
        prescribedAt: "2020-06-15",
        prescribedBy: "Dr. Sarah Mitchell",
        status: "active",
      },
      {
        name: "Lisinopril",
        dosage: "10mg",
        frequency: "Once daily",
        prescribedAt: "2021-03-20",
        prescribedBy: "Dr. Sarah Mitchell",
        status: "active",
      },
    ],
    labResultsCount: 12,
  },
  "patient-002": {
    patientId: "patient-002",
    lastUpdated: "2024-03-18T14:15:00Z",
    vitals: [
      {
        recordedAt: "2024-03-18T14:00:00Z",
        bloodPressure: "118/76",
        heartRate: 68,
        temperature: 98.2,
        oxygenSaturation: 99,
        weight: 145,
      },
    ],
    diagnoses: [
      {
        code: "I25.10",
        description: "Atherosclerotic heart disease of native coronary artery",
        diagnosedAt: "2022-11-05",
        status: "chronic",
      },
    ],
    medications: [
      {
        name: "Aspirin",
        dosage: "81mg",
        frequency: "Once daily",
        prescribedAt: "2022-11-05",
        prescribedBy: "Dr. Robert Chen",
        status: "active",
      },
      {
        name: "Atorvastatin",
        dosage: "40mg",
        frequency: "Once daily at bedtime",
        prescribedAt: "2022-11-05",
        prescribedBy: "Dr. Robert Chen",
        status: "active",
      },
    ],
    labResultsCount: 8,
  },
};

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  logger.setRequestId(context.awsRequestId);

  try {
    // ── Extract authorizer context ────────────────────────────────────────────
    const authCtx = event.requestContext.authorizer as AuthorizerContext;
    const scopes = authCtx?.scopes?.split(",") ?? [];

    // ── Check required scope ──────────────────────────────────────────────────
    if (!scopes.includes("read:health-records")) {
      logger.warn("Insufficient scope", { required: "read:health-records", provided: scopes });
      return Responses.forbidden(
        "Insufficient scope. Required: read:health-records",
        context.awsRequestId
      );
    }

    // ── Extract patientId from path ───────────────────────────────────────────
    const requestedPatientId = event.pathParameters?.["patientId"];
    if (!requestedPatientId) {
      return Responses.badRequest("patientId path parameter is required", context.awsRequestId);
    }

    // ── Authorization check ───────────────────────────────────────────────────
    const authorizedPatientId = authCtx?.patientId;
    if (authorizedPatientId && authorizedPatientId !== requestedPatientId) {
      logger.warn("Patient ID mismatch — access denied", {
        requestedPatientId,
        authorizedPatientId,
      });
      return Responses.forbidden(
        "You do not have access to this patient's health records",
        context.awsRequestId
      );
    }

    // ── Fetch health records ──────────────────────────────────────────────────
    const healthRecord = MOCK_HEALTH_RECORDS[requestedPatientId];
    if (!healthRecord) {
      return Responses.notFound(
        `Health records for patient ${requestedPatientId}`,
        context.awsRequestId
      );
    }

    logger.info("Health records retrieved", {
      patientId: requestedPatientId,
      requestedBy: authCtx.userId,
      role: authCtx.role,
      hmsClientId: authCtx.hmsClientId,
    });

    return successResponse({
      healthRecord,
      accessedBy: {
        userId: authCtx.userId,
        role: authCtx.role,
        hmsClientId: authCtx.hmsClientId,
      },
      accessedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Unexpected error in GetHealthRecords", error);
    return Responses.internalError(context.awsRequestId);
  }
};
