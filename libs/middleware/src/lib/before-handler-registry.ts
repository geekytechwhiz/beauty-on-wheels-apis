import type { BeforeHandler } from './withApiHandler'; 

/**
 * Module-level default before-handler. Set once at cold start only when a
 * service needs non-metadata request prep. Metadata projection loading must
 * NOT run here — it is demand-driven after the DB response.
 *
 * Every withApiHandler invocation that does not explicitly pass `beforeHandler`
 * will run this automatically when set.
 *
 * Pass null to {@link setDefaultBeforeHandler} or call
 * {@link clearDefaultBeforeHandler} to opt the entire process out.
 */
let defaultBeforeHandler: BeforeHandler | null | undefined;

/**
 * Register a service-wide default before-handler.
 * Call once during Lambda cold-start initialisation.
 *
 * Pass `null` to explicitly disable automatic before-handler for this process.
 * Do not register metadata bootstrap/projection warm-up here.
 */
export function setDefaultBeforeHandler(handler: BeforeHandler | null): void {
  defaultBeforeHandler = handler;
}

/**
 * Returns the registered default before-handler, or the platform default
 * (undefined — no metadata preload). Returns undefined if explicitly set to null.
 */
export function getDefaultBeforeHandler(): BeforeHandler | undefined {
  if (defaultBeforeHandler === null) {
    return undefined;
  }
  return defaultBeforeHandler ?? undefined;
}

/**
 * Clears the registered default before-handler (equivalent to setDefaultBeforeHandler(null)).
 * Useful in tests.
 */
export function clearDefaultBeforeHandler(): void {
  defaultBeforeHandler = null;
}

