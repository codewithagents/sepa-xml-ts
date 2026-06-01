/**
 * Parser stub for pain.001.001.09 XML documents.
 * Full parsing implementation is deferred to a future iteration.
 */

import type { CreditTransferDocument } from "../model/schema.js";

export interface ParseResult {
  ok: boolean;
  data?: CreditTransferDocument;
  error?: string;
}

/**
 * Parse a pain.001.001.09 XML string into a CreditTransferDocument model.
 *
 * NOTE: This is a stub. Full parsing is not yet implemented.
 * Returns an error result for all inputs.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function parse(_xml: string): ParseResult {
  return {
    ok: false,
    error: "parse() is not yet implemented",
  };
}
