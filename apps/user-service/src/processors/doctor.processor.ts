import { serializeError } from "@api-hub/logger";
import { UserRepository } from "../repositories/user.repository";

const repository = new UserRepository();

export interface AssignDoctorInput {
  doctorId?: string
  doctorID?: string
  userId?: string
  userID?: string
}

export async function handleDoctorAssignment(
  user: any,
  assignDoctor: AssignDoctorInput | undefined,
  organizationID: string,
  logger: any,
) {

  if (!assignDoctor || Object.keys(assignDoctor).length === 0) {
    return;
  }

  const doctorId =
    assignDoctor.doctorId ||
    assignDoctor.doctorID ||
    assignDoctor.userId ||
    assignDoctor.userID;

  if (!doctorId) {
    logger.warn({
      event: "doctor_assignment_missing_id",
      message: "Doctor ID not provided",
    });
    return;
  }

  try {

    const doctor = await repository.getUser(
      doctorId,
      organizationID
    );

    if (!doctor) {

      logger.warn({
        event: "doctor_not_found",
        doctorId,
        organizationID,
      });

      return;
    }

    const doctorFullName =
      doctor.namePrefix &&
      String(doctor.namePrefix)
        .toLowerCase()
        .includes("dr")
        ? `${doctor.namePrefix} ${doctor.fullName || doctor.firstName || ""}`.trim()
        : doctor.fullName || doctor.firstName || "";

    // Save doctor → patient mapping
    await repository.saveDoctorPatientLink(
      doctorId,
      user.userID,
      organizationID
    );

    // Update patient reporter
    await repository.updatePatientReporter(
      user.userID,
      organizationID,
      {
        reporterId: doctorId,
        reporterName: doctorFullName,
        reporterProfilePic: (doctor as any).profilePic,
        reporterEmail: (doctor as any).emailAddress,
      }
    );

    logger.info({
      event: "doctor_linked_to_patient",
      doctorId,
      userId: user.userID,
    });

  } catch (err) {

    logger.warn({
      event: "doctor_assignment_failed",
      err: serializeError(err),
    });

  }

}