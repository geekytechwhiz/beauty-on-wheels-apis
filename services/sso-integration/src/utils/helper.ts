import { TENANT_MAP } from "../config/tenant-map-config";

 
export const makePrefixFromGender = (gender: string): string => {
    const prefixes: Record<string, string> = { male: 'Mr', female: 'Ms' };
    return prefixes[gender.toLowerCase()] || 'Mr';
}

export const getOrganizationIdBySubdomain = (subdomain: string): string => {
    const organizationId = TENANT_MAP[subdomain as keyof typeof TENANT_MAP];
    if (!organizationId) {
        throw new Error(`Organization ID not found for subdomain: ${subdomain}`);
    }
    return organizationId;
}