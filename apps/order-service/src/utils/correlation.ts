export function getCorrelationId(
  headers: Record<string, string | undefined>
): string {
  const headerName = process.env.CORRELATION_HEADER || "x-correlation-id";
  return headers[headerName] || headers["x-correlation-id"] || "";
}
