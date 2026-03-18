import { DEFAULT_PASSWORD } from "../constants/constants";

export const decodeJwtPayload = (token: string) => {
    try {
      const jwt = token.replace('Bearer ', '');
  
      const base64Url = jwt.split('.')[1];
  
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  
      const payload = Buffer.from(base64, 'base64').toString();
  
      return JSON.parse(payload);
    } catch {
      return {};
    }
  };
 
  export const generatePassword = (): string => {
    // return `Comm@n12${Math.random().toString(36).substring(5)}`;
    return DEFAULT_PASSWORD;
  };