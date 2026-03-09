/** Used by CognitoUserService when user already exists in Cognito */
export class UserAlreadyExistsError extends Error {
  constructor(userId: string) {
    super(`User already exists: ${userId}`);
    this.name = 'UserAlreadyExistsError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
