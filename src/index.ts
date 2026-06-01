/**
 * sepa-xml-ts public API.
 *
 * Exports:
 * - CreditTransferDocumentSchema: Zod schema for the pain.001 document model
 * - CreditTransferDocument: TypeScript type for the document model
 * - writeCreditTransfer: convert a model to pain.001.001.09 XML
 * - validate: validate an unknown input against the document schema
 *
 * Internal helpers (IBAN validation, SEPA charset, XML escaping) are NOT re-exported.
 * Import from "sepa-xml-ts/xsd" for XSD schema validation.
 *
 * Note: parse (XML to model) is intentionally not part of the public API yet.
 * It will be added once it is fully implemented and XSD-round-trip tested.
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

export { validate } from "./model/validate.js";
export type { ValidationResult, ValidationSuccess, ValidationFailure } from "./model/validate.js";
