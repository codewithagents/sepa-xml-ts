/**
 * sepa-xml-ts public API.
 *
 * pain.001 (Credit Transfer):
 * - CreditTransferDocumentSchema: Zod schema
 * - Types: CreditTransferDocument, PaymentBatch, Transfer, AccountParty, Money
 * - Helpers: euros, formatMoney
 * - writeCreditTransfer: model -> pain.001.001.09 XML
 *
 * pain.008 (Direct Debit):
 * - DirectDebitDocumentSchema: Zod schema
 * - Types: DirectDebitDocument, DirectDebitBatch, Collection, Creditor, Mandate, SequenceType, LocalInstrument
 * - writeDirectDebit: model -> pain.008.001.08 XML
 *
 * Shared:
 * - parse: auto-detects pain.001 or pain.008 and returns a discriminated union
 * - validateCreditTransfer: validate an unknown input against the pain.001 document schema
 * - validateDirectDebit: validate an unknown input against the pain.008 document schema
 * - validate: alias for validateCreditTransfer (backward compatibility)
 *
 * Internal helpers (IBAN validation, SEPA charset, XML escaping) are NOT re-exported.
 * Import from "sepa-xml-ts/xsd" for XSD schema validation.
 */

// ---------------------------------------------------------------------------
// pain.001 exports
// ---------------------------------------------------------------------------

export { CreditTransferDocumentSchema, euros, formatMoney } from './model/schema.js'

export type {
  CreditTransferDocument,
  PaymentBatch,
  Transfer,
  AccountParty,
  Money,
} from './model/schema.js'

export { writeCreditTransfer } from './writer/writer.js'

// ---------------------------------------------------------------------------
// pain.008 exports
// ---------------------------------------------------------------------------

export {
  DirectDebitDocumentSchema,
  SequenceTypeSchema,
  LocalInstrumentSchema,
} from './model/pain008.js'

export type {
  DirectDebitDocument,
  DirectDebitBatch,
  Collection,
  Creditor,
  Mandate,
  SequenceType,
  LocalInstrument,
} from './model/pain008.js'

export { writeDirectDebit } from './writer/direct-debit.js'

// ---------------------------------------------------------------------------
// Shared: parse (auto-detects message type), validate
// ---------------------------------------------------------------------------

export { parse } from './parser/parser.js'
export type {
  ParseResult,
  ParseSuccess,
  ParseSuccess001,
  ParseSuccess008,
  ParseFailure,
} from './parser/parser.js'

export { validate, validateCreditTransfer, validateDirectDebit } from './model/validate.js'
export type {
  ValidationResult,
  ValidationSuccess,
  ValidationFailure,
  DirectDebitValidationResult,
  DirectDebitValidationSuccess,
  DirectDebitValidationFailure,
} from './model/validate.js'
