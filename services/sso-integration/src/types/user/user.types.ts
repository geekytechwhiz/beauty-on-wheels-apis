export interface User {
    id: string | number
    externalId: string | number
    provider: string
    tenantId: string
    
    email?: string
    phone?: string
    firstName?: string
    lastName?: string
  
    status: 'ACTIVE' | 'INACTIVE' | 'PENDING'
  
    cognitoUsername?: string
    doctorId?: number | string
    partnerSource?: string
    organizationId?: string
  
    launchSource?: string
  
    createdAt: string
    updatedAt: string
  }