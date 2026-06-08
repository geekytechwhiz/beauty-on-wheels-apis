import { createLogger } from "@api-hub/observability";
import { getEnvConfig } from "../config/env"; 
import { getCachedExternalTenantByTenantId } from "../services/external-tenant.service";

export const makePrefixFromGender = (gender: string): string => {
  const prefixes: Record<string, string> = { male: "Mr", female: "Ms" };
  return prefixes[gender.toLowerCase()] || "Mr";
};

export type TenantDetails = {
  organizationId: string;
  subdomain: string;
  provider: string;
}
export const loadTenantDetails = (subdomain: string): TenantDetails => {
  const envConfig= getEnvConfig();
  const cachedTenant = getCachedExternalTenantByTenantId(
    envConfig.PROVIDER,
    subdomain,
  );
  if (!cachedTenant) {
    throw new Error(
      `External tenant not found for provider=${envConfig.PROVIDER}, tenantId=${subdomain}`,
    );
  }
  const tenantDetails={
    organizationId: cachedTenant.organizationId,
    subdomain: subdomain,
    provider: cachedTenant.provider,
    
  } 
  return tenantDetails;
};
 

export function getOrganizationId(subdomain: string): string {
  const tenantDetails = loadTenantDetails(subdomain);
  if (!tenantDetails) {
    throw new Error(`Tenant details not found for subdomain: ${subdomain}`);
  }
  return tenantDetails.organizationId;
}
/**
 * Helper function to append a suffix to doctor and patient contact details.
 *
 * This is mainly used for testing scenarios to avoid conflicts such as:
 * - Duplicate email errors
 * - Duplicate phone numbers
 * - User provisioning conflicts (HTTP 409)
 *
 * The function preserves the original data structure and only modifies:
 * - patient.phone
 * - patient.email
 * - doctor.phone
 * - doctor.email
 *
 * @param appointments - Array of appointment objects from HMS
 * @param suffix - Letter/string to append to phone/email (default: "a")
 * @returns Modified appointments array with updated contact details
 */
export function appendSuffixToContacts<T extends any[]>(
  appointments: T,
  perfix = "a" // default suffix is "a"
): T {
  try {
   const suffix = Math.random().toString(36).substring(2, 15);
    // Validate input
    if (!Array.isArray(appointments)) {
      console.warn("appendSuffixToContacts: appointments is not an array");
      return appointments;
    }

    // Iterate through appointments and modify contact fields
    const updatedAppointments = appointments.map((appointment: any) => {
      try {
        // Create a shallow copy to avoid mutating original object
        const updated = { ...appointment };

        /**
         * Update PATIENT contact details
         */
        if (updated.patient) {
          // Append suffix to phone number
          if (updated?.patient?.phone) {
            // updated?.patient?.phone = `${updated?.patient?.phone}${suffix}`;
            updated.patient.id = `${updated?.patient?.id}${suffix}`;
          }

          // Append suffix to email before the domain
          // if (updated?.patient?.email && updated?.patient?.email.includes("@")) {
          //   const [name, domain] = updated?.patient?.email.split("@");
          //   // updated?.patient?.email = `${name}${suffix}@${domain}`;
          //   // updated?.patient?.id = `${updated?.patient?.id}${suffix}`;
          // } 
        }

        /**
         * Update DOCTOR contact details
         */
        if (updated.doctor) {
          // Append suffix to phone number
          if (updated.doctor.phone) {
            // updated.doctor.phone = `${updated.doctor.phone}${suffix}`;
            updated.doctor.id = `${updated?.doctor?.id}${suffix}`;
          }

          // Append suffix to email before the domain
          if (updated.doctor.email && updated.doctor.email.includes("@")) {
            const [name, domain] = updated.doctor.email.split("@");
            updated.doctor.email = `${name}${suffix}@${domain}`;
          }
        }

        return updated;
      } catch (innerError) {
        // Log error but continue processing other records
        console.error(
          "appendSuffixToContacts: error processing appointment",
          appointment?.appointment_id,
          innerError
        );
        return appointment;
      }
    });

    return updatedAppointments as T;
  } catch (error) {
    // Global failure safeguard
    console.error("appendSuffixToContacts: unexpected error", error);

    // Return original data if something goes wrong
    return appointments;
  }
}
 
export const baseLogger = createLogger({
  service: 'sso-integration',
  redactPII: true,
});