export function validateUserOrganizationRequest(req: any) {
  const params = req?.params ?? req;
  if (!params.userId || !params.organizationId) {
    const error: any = new Error('organizationId and userId are required');
    error.statusCode = 400;
    throw error;
  }
}