import * as crypto from 'crypto';
import { ActionReceipt } from './types';

export class ActionReceiptStore {
  private readonly receipts: ActionReceipt[] = [];

  public recordReceipt(receipt: Omit<ActionReceipt, 'id'>): ActionReceipt {
    const id = `rcpt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const fullReceipt: ActionReceipt = {
      id,
      ...receipt
    };
    this.receipts.push(fullReceipt);
    return fullReceipt;
  }

  public getReceiptsForRun(runId: string): readonly ActionReceipt[] {
    return this.receipts.filter((r) => r.runId === runId);
  }

  public getAllReceipts(): readonly ActionReceipt[] {
    return [...this.receipts];
  }

  public getLatestReceipt(): ActionReceipt | undefined {
    return this.receipts[this.receipts.length - 1];
  }

  public clear(): void {
    this.receipts.length = 0;
  }
}
