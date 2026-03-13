import { ServiceTokenContext, UserRole } from "./launch.types"

export interface ServiceTokenPayload {

  iss: string
  aud: string
  sub: string

  tokenType: "SERVICE"

  tenantId: string

  context: ServiceTokenContext

  jti: string
  iat: number
  exp: number

}
 

export interface ServiceTokenResult {
  token: string;
  expiresIn: number;
  userId: string;
  role: UserRole;
}