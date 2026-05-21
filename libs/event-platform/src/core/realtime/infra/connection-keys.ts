export function connectionPk(connectionId: string): string {
  return `CONN#${connectionId.trim()}`;
}

export function connectionSk(destination: string): string {
  return `SUB#${destination.trim()}`;
}

export function parseConnectionIdFromPk(pk: string): string | undefined {
  const prefix = 'CONN#';
  if (!pk.startsWith(prefix)) {
    return undefined;
  }
  const id = pk.slice(prefix.length).trim();
  return id.length > 0 ? id : undefined;
}
