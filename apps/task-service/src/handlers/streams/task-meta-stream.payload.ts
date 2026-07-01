import { z } from 'zod';

import { TaskMetaStreamPayloadSchema } from './task-meta-stream.schema';

export type TaskMetaStreamPayload = z.infer<typeof TaskMetaStreamPayloadSchema>;
