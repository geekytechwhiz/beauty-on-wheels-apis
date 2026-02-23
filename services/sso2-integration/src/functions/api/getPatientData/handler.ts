// ─────────────────────────────────────────────────────────────────────────────
// FUNCTION: Get Patient Data  (Protected MyVitalRx API)
// ROUTE:    GET /api/patients/{patientId}
// AUTH:     JWT required — scope: read:patient
//
// This is a MyVitalRx protected resource that HMS accesses after SSO.
// The JwtAuthorizer Lambda runs first and injects patient/user context.
// ─────────────────────────────────────────────────────────────────────────────

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { AuthorizerContext } from "../../../types";
import { successResponse, Responses } from "../../../utils/response";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("GetPatientData");

// ── Mock patient data (replace with real DB/service calls) ───────────────────
interface PatientData {
  patientId: string;
  mrn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  bloodType: string;
  allergies: string[];
  primaryPhysician: string;
  insuranceId: string;
  enrolledPrograms: string[];
  lastVisit: string;
}

const MOCK_PATIENTS: Record<string, PatientData> = {
  "patient-001": {
    patientId: "patient-001",
    mrn: "MRN-20240001",
    firstName: "John",
    lastName: "Doe",
    dateOfBirth: "1985-04-12",
    gender: "Male",
    bloodType: "O+",
    allergies: ["Penicillin", "Sulfa drugs"],
    primaryPhysician: "Dr. Sarah Mitchell",
    insuranceId: "INS-987654",
    enrolledPrograms: ["Diabetes Management", "Hypertension Care"],
    lastVisit: "2024-03-15",
  },
  "patient-002": {
    patientId: "patient-002",
    mrn: "MRN-20240002",
    firstName: "Jane",
    lastName: "Smith",
    dateOfBirth: "1972-09-28",
    gender: "Female",
    bloodType: "A-",
    allergies: [],
    primaryPhysician: "Dr. Robert Chen",
    insuranceId: "INS-112233",
    enrolledPrograms: ["Cardiovascular Monitoring"],
    lastVisit: "2024-03-18",
  },
};

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  logger.setRequestId(context.awsRequestId);

  try {
    // ── Extract authorizer context (injected by JwtAuthorizer) ────────────────
    const authCtx = event.requestContext.authorizer as AuthorizerContext;
    const scopes = authCtx?.scopes?.split(",") ?? [];

    // ── Check required scope ──────────────────────────────────────────────────
    if (!scopes.includes("read:patient")) {
      logger.warn("Insufficient scope", { required: "read:patient", provided: scopes });
      return Responses.forbidden(
        "Insufficient scope. Required: read:patient",
        context.awsRequestId
      );
    }

    // ── Extract patientId from path ───────────────────────────────────────────
    const requestedPatientId = event.pathParameters?.["patientId"];
    if (!requestedPatientId) {
      return Responses.badRequest("patientId path parameter is required", context.awsRequestId);
    }

    // ── Authorization check: can this user access THIS patient? ───────────────
    // The JWT contains the patientId the HMS session was scoped to
    const authorizedPatientId = authCtx?.patientId;
    if (authorizedPatientId && authorizedPatientId !== requestedPatientId) {
      logger.warn("Patient ID mismatch — access denied", {
        requestedPatientId,
        authorizedPatientId,
        userId: authCtx.userId,
      });
      return Responses.forbidden(
        "You do not have access to this patient's data",
        context.awsRequestId
      );
    }

    // ── Fetch patient data ────────────────────────────────────────────────────
    const patient = MOCK_PATIENTS[requestedPatientId];
    if (!patient) {
      return Responses.notFound(`Patient ${requestedPatientId}`, context.awsRequestId);
    }

    logger.info("Patient data retrieved", {
      patientId: requestedPatientId,
      requestedBy: authCtx.userId,
      hmsClientId: authCtx.hmsClientId,
    });

    return successResponse({
      patient,
      accessedBy: {
        userId: authCtx.userId,
        role: authCtx.role,
        hmsClientId: authCtx.hmsClientId,
      },
      accessedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Unexpected error in GetPatientData", error);
    return Responses.internalError(context.awsRequestId);
  }
};
