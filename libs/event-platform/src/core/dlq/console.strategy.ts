import { DlqStrategy, DlqMessage } from '../../typings/dlq.types';

export class ConsoleDlqStrategy implements DlqStrategy {
  async send(message: DlqMessage): Promise<void> {
    console.error('DLQ MESSAGE', JSON.stringify(message, null, 2));
  }
}