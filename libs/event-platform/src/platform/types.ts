// packages/platform/src/types.ts

export type Middleware = (
    event: any,
    context: any,
    next: () => Promise<any>
  ) => Promise<any>;