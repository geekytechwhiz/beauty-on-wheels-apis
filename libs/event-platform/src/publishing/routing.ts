import type { EventTransport } from '../core/schema/define-event';

export type PublishRoutingMode = 'single' | 'fanOut';

export type PublishRoutingTransport = {
  transport: EventTransport;
};

export type PublishRoutingConfig = {
  mode: PublishRoutingMode;
  transports: PublishRoutingTransport[];
};

export type PublishPlan = {
  mode: PublishRoutingMode;
  transports: EventTransport[];
};

export function resolvePublishPlan(input: {
  schemaTransport: EventTransport;
  routing?: PublishRoutingConfig;
}): PublishPlan {
  if (!input.routing) {
    return {
      mode: 'single',
      transports: [input.schemaTransport],
    };
  }

  const transports = input.routing.transports.map((entry) => entry.transport);
  if (transports.length === 0) {
    return {
      mode: 'single',
      transports: [input.schemaTransport],
    };
  }

  if (input.routing.mode === 'fanOut') {
    return {
      mode: 'fanOut',
      transports,
    };
  }

  return {
    mode: 'single',
    transports: [transports[0] ?? input.schemaTransport],
  };
}
