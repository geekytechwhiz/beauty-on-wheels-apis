import { BusinessRuleError, NotFoundError } from "@api-hub/utils";

/** Query-string vendor scope. Create uses the request body instead. */
export function requireVendorId(raw: unknown): string {
    if (typeof raw !== "string" || raw.trim().length === 0) {
        throw new BusinessRuleError("vendorId query parameter is required");
    }
    return raw.trim();
}

/**
 * Hide another vendor's row. A mismatched owner is the same result as a missing id.
 */
export function assertVendorOwner(
    ownerId: string | undefined,
    vendorId: string,
    label: string,
    id: string,
): void {
    if (ownerId !== vendorId) {
        throw new NotFoundError(`${label} not found: ${id}`);
    }
}
