// Reading a receipt photo. Nothing outside this file knows the provider.
// Rule: the result only ever pre-fills a form the manager confirms; it never goes
// straight into the ledger.
import { todayTehran } from "@/lib/date";

export type ExtractedReceipt = {
  amountRial?: bigint;
  occurredOn?: string; // ISO date, 'YYYY-MM-DD'
  traceNumber?: string; // شماره پیگیری
  payee?: string;
  confidence: number; // 0..1
  raw: unknown; // provider response, stored in documents.extracted
};

export interface ReceiptExtractor {
  extract(image: Buffer, mimeType: string): Promise<ExtractedReceipt>;
}

/** Below this, the form stays empty and asks for manual entry. */
export const MIN_CONFIDENCE = 0.6;

/** Stand-in for the MVP: a short delay, then fixed values at confidence 0.8. */
export class MockReceiptExtractor implements ReceiptExtractor {
  constructor(private delayMs = 600) {}

  async extract(image: Buffer, mimeType: string): Promise<ExtractedReceipt> {
    await new Promise((r) => setTimeout(r, this.delayMs));
    return {
      amountRial: 12_500_000n,
      occurredOn: todayTehran(),
      traceNumber: "123456",
      payee: "فروشگاه نمونه",
      confidence: 0.8,
      raw: { provider: "mock", bytes: image.length, mimeType },
    };
  }
}

let extractor: ReceiptExtractor | undefined;

export function getReceiptExtractor(): ReceiptExtractor {
  if (extractor) return extractor;
  const kind = process.env.RECEIPT_EXTRACTOR ?? "mock";
  if (kind === "mock") return (extractor = new MockReceiptExtractor());
  throw new Error(`RECEIPT_EXTRACTOR=${kind} is not implemented yet`);
}
