export const handleHealth = async () => ({
  statusCode: 200,
  body: JSON.stringify({ status: 'UP' }),
});
