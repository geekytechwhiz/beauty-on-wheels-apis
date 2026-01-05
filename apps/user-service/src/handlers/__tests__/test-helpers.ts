export function createMockUser() {
  const now = Date.now();
  return {
    userId: 'user-1',
    email: 'user@example.com',
    emailAddress: 'user@example.com',
    name: 'Test User',
    firstName: 'Test',
    fullName: 'Test User',
    createdAt: now,
    updatedAt: now,
  };
}
