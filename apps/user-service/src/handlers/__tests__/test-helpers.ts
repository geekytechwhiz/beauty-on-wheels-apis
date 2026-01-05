export function createMockUser() {
  const now = Date.now();
  return {
    userId: 'user-1',
    email: 'user@example.com',
    name: 'Test User',
    createdAt: now,
    updatedAt: now,
  };
}
