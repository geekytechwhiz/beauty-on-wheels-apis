import { EXTERNAL_USER_MAP, TENANT_MAP } from "../config/tenant-map-config";

 
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

export function getOrganizationId(subdomain: string): string | undefined {
    return TENANT_MAP[subdomain];
  }
  
  export function getCachedUserId(
    subdomain: string,
    externalUserId: string
  ): string | undefined {
    console.log("getCachedUserId subdomain", subdomain);
    console.log("getCachedUserId externalUserId", externalUserId);
    const userids=EXTERNAL_USER_MAP[subdomain]; 
    console.log("getCachedUserId userids", JSON.stringify(userids));
    if (userids) {
      return userids[externalUserId];
    }
    return undefined;
  }