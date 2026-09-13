declare module 'jwk-to-pem' {
  interface Jwk {
    kty: string;
    n?: string;
    e?: string;
    kid?: string;
    alg?: string;
    use?: string;
    [key: string]: unknown;
  }

  function jwkToPem(jwk: Jwk, options?: { private?: boolean }): string;
  export = jwkToPem;
}
