import { configureEventRuntime } from '../events/bootstrap/event-runtime';
import { handler } from '../events/consumer/event-bridge/threshold-breach.consumer';

configureEventRuntime();

export const main = handler;
