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