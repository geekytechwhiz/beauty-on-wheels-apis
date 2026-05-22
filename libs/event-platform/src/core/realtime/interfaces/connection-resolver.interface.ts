export interface ConnectionResolver {
  resolve(destination: string): Promise<string[]>;
}
