/**
 * sepa-xml-ts public API (0.2.0).
 *
 * Exports:
 * - CreditTransferDocumentSchema: Zod schema for the pain.001 document model
 * - Types: CreditTransferDocument, PaymentBatch, Transfer, AccountParty, Money
 * - Helpers: euros, formatMoney
 * - writeCreditTransfer: convert a model to pain.001.001.09 XML
 * - parse: parse a pain.001.001.09 XML string into a model
 * - validate: validate an unknown input against the document schema
 *
 * Internal helpers (IBAN validation, SEPA charset, XML escaping) are NOT re-exported.
 * Import from "sepa-xml-ts/xsd" for XSD schema validation.
 */

export {
  CreditTransferDocumentSchema,
  euros,
  formatMoney,
} from "./model/schema.js";

export type {
  CreditTransferDocument,
  PaymentBatch,
  Transfer,
  AccountParty,
  Money,
} from "./model/schema.js";

export { writeCreditTransfer } from "./writer/writer.js";

export { parse } from "./parser/parser.js";
export type { ParseResult, ParseSuccess, ParseFailure } from "./parser/parser.js";

export { validate } from "./model/validate.js";
export type { ValidationResult, ValidationSuccess, ValidationFailure } from "./model/validate.js";
