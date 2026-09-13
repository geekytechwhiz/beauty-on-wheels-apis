export interface QueueMessageBatchEntry {
  id: string;
  body: string;
}

export interface IQueueProvider {
  sendMessageBatch(
    queueUrl: string,
    entries: QueueMessageBatchEntry[],
  ): Promise<{
    successful: string[];
    failed: { id: string; message: string }[];
  }>;
}
