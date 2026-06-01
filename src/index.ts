/**
 * sepa-xml-ts public API.
 *
 * Exports:
 * - CreditTransferDocumentSchema: Zod schema for the pain.001 document model
 * - CreditTransferDocument: TypeScript type for the document model
 * - writeCreditTransfer: convert a model to pain.001.001.09 XML
 * - parse: parse XML back to model (stub, not yet implemented)
 * - validate: validate an unknown input against the document schema
 *
 * Internal helpers (IBAN validation, SEPA charset, XML escaping) are NOT re-exported.
 * Import from "sepa-xml-ts/xsd" for XSD schema validation.
 */

export { CreditTransferDocumentSchema } from "./model/schema.js";
export type {
  CreditTransferDocument,
  PaymentInstruction,
  CreditTransferTransaction,
  GroupHeader,
  Party,
  Agent,
} from "./model/schema.js";

export { writeCreditTransfer } from "./writer/writer.js";
export { parse } from "./parser/parser.js";
export type { ParseResult } from "./parser/parser.js";

export { validate } from "./model/validate.js";
export type { ValidationResult, ValidationSuccess, ValidationFailure } from "./model/validate.js";
