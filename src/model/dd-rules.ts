/**
 * Cross-field business rules for pain.008 DirectDebitDocument.
 *
 * These rules enforce SEPA rulebook constraints that go beyond what the Zod schema
 * can express as per-field refinements. They operate on an already-validated
 * DirectDebitDocument (schema parse must have succeeded before calling this).
 *
 * Rules:
 *   R1 (signature before collection): mandate.signatureDate must not be after the
 *      batch collectionDate. Equal dates are allowed. Compare as YYYY-MM-DD strings
 *      (lexicographic order is correct for ISO 8601 date-only values).
 *
 *   R2 (OOFF is single-use): a mandate id that appears in any OOFF batch must appear
 *      in exactly ONE collection across the whole document, and must NOT appear in any
 *      batch with a different sequence type.
 *
 *   R3 (consistent scheme per mandate): a given mandate id must not be used under both
 *      CORE and B2B local instruments in the same document. localInstrument defaults to
 *      CORE when absent, matching the writer default.
 *
 *   R4 (SMNDA requires FRST): if a batch contains any collection whose
 *      mandate.amendment.sameMandateNewDebtorAccount === true, that batch's sequenceType
 *      MUST be 'FRST'. The SMNDA flag signals a new debtor account at the same bank,
 *      which constitutes the first collection under the amended mandate.
 */

import type { DirectDebitDocument } from './pain008.js'
import type { ProfileIssue } from '../profile/profile.js'

/** Internal record of one mandate usage within a document, used for R2/R3 checks. */
interface MandateUsage {
  batchIdx: number
  colIdx: number
  collectionDate: string
  signatureDate: string
  sequenceType: string
  localInstrument: string
}

/**
 * Append a mandate usage record to the index map, creating a new entry if needed.
 * This is a pure accumulator with no side effects beyond the map mutation.
 */
function accumulateMandateUsage(
  index: Map<string, MandateUsage[]>,
  mandateId: string,
  usage: MandateUsage
): void {
  const existing = index.get(mandateId)
  if (existing !== undefined) {
    existing.push(usage)
  } else {
    index.set(mandateId, [usage])
  }
}

/**
 * R1: mandate signatureDate must not be after the batch collectionDate.
 * Returns a ProfileIssue if violated, null otherwise.
 */
function checkR1SignatureBeforeCollection(
  bIdx: number,
  cIdx: number,
  signatureDate: string,
  collectionDate: string
): ProfileIssue | null {
  if (signatureDate <= collectionDate) return null
  return {
    path: `batches.${bIdx}.collections.${cIdx}.mandate.signatureDate`,
    message:
      `R1: mandate signatureDate (${signatureDate}) is after` +
      ` the batch collectionDate (${collectionDate}).` +
      ` A debit cannot precede the mandate signature.`,
  }
}

/**
 * R2: a mandate id used in an OOFF batch must appear in exactly one collection
 * across the whole document. Returns issues for all occurrences beyond the first.
 */
function checkR2Issues(mandateId: string, usages: MandateUsage[]): ProfileIssue[] {
  const hasOoff = usages.some((u) => u.sequenceType === 'OOFF')
  if (!hasOoff) return []

  // The mandate appears more than once and at least one occurrence is OOFF.
  // Report all occurrences beyond the first to make the error precise.
  const issues: ProfileIssue[] = []
  for (let i = 1; i < usages.length; i++) {
    const u = usages[i]
    if (u === undefined) continue
    issues.push({
      path: `batches.${u.batchIdx}.collections.${u.colIdx}.mandate.id`,
      message:
        `R2: mandate "${mandateId}" is used in an OOFF batch and appears in` +
        ` more than one collection in this document.` +
        ` An OOFF mandate authorizes exactly one collection.`,
    })
  }
  return issues
}

/**
 * R3: a mandate id must not appear under both CORE and B2B local instruments
 * in the same document. Returns issues for all conflicting occurrences.
 */
function checkR3Issues(mandateId: string, usages: MandateUsage[]): ProfileIssue[] {
  const instruments = new Set(usages.map((u) => u.localInstrument))
  if (instruments.size <= 1) return []

  // Mandate appears under multiple instruments (e.g. CORE and B2B). Report from second occurrence.
  const issues: ProfileIssue[] = []
  const first = usages[0]
  if (first === undefined) return []

  for (let i = 1; i < usages.length; i++) {
    const u = usages[i]
    if (u === undefined) continue
    if (u.localInstrument !== first.localInstrument) {
      issues.push({
        path: `batches.${u.batchIdx}.collections.${u.colIdx}.mandate.id`,
        message:
          `R3: mandate "${mandateId}" is used under local instrument "${u.localInstrument}"` +
          ` in batch ${u.batchIdx} but under "${first.localInstrument}" in batch ${first.batchIdx}.` +
          ` A mandate is bound to one scheme (CORE or B2B) and cannot be reused across schemes.`,
      })
    }
  }
  return issues
}

/**
 * R4: if any collection in a batch has mandate.amendment.sameMandateNewDebtorAccount === true
 * (SMNDA), the batch's sequenceType must be 'FRST'.
 * Returns issues for each violating collection.
 */
function checkR4SmndaRequiresFirst(doc: DirectDebitDocument): ProfileIssue[] {
  const issues: ProfileIssue[] = []

  for (let bIdx = 0; bIdx < doc.batches.length; bIdx++) {
    const batch = doc.batches[bIdx]
    if (batch === undefined) continue
    if (batch.sequenceType === 'FRST') continue

    for (let cIdx = 0; cIdx < batch.collections.length; cIdx++) {
      const col = batch.collections[cIdx]
      if (col === undefined) continue

      if (col.mandate.amendment?.sameMandateNewDebtorAccount === true) {
        issues.push({
          path: `batches.${bIdx}.collections.${cIdx}.mandate.amendment.sameMandateNewDebtorAccount`,
          message:
            `R4: batch ${bIdx} has sequenceType "${batch.sequenceType}" but collection ${cIdx}` +
            ` has sameMandateNewDebtorAccount=true (SMNDA).` +
            ` A batch containing SMNDA collections must have sequenceType FRST,` +
            ` because SMNDA represents the first collection under the amended mandate.`,
        })
      }
    }
  }

  return issues
}

/**
 * Check cross-field SEPA rulebook constraints on a DirectDebitDocument.
 * Returns an empty array when the document passes all rules.
 * Returns one ProfileIssue per violation with a precise path and message.
 *
 * @param doc A DirectDebitDocument that has already passed Zod schema validation.
 * @returns An array of ProfileIssue describing any violations (empty when valid).
 */
export function checkDirectDebitRules(doc: DirectDebitDocument): ProfileIssue[] {
  const issues: ProfileIssue[] = []
  const mandateIndex = new Map<string, MandateUsage[]>()

  // Build the mandate index and collect R1 issues in collection-traversal order.
  for (let bIdx = 0; bIdx < doc.batches.length; bIdx++) {
    const batch = doc.batches[bIdx]
    if (batch === undefined) continue
    const effectiveLocalInstrument = batch.localInstrument ?? 'CORE'

    for (let cIdx = 0; cIdx < batch.collections.length; cIdx++) {
      const col = batch.collections[cIdx]
      if (col === undefined) continue

      const r1Issue = checkR1SignatureBeforeCollection(
        bIdx,
        cIdx,
        col.mandate.signatureDate,
        batch.collectionDate
      )
      if (r1Issue !== null) issues.push(r1Issue)

      accumulateMandateUsage(mandateIndex, col.mandate.id, {
        batchIdx: bIdx,
        colIdx: cIdx,
        collectionDate: batch.collectionDate,
        signatureDate: col.mandate.signatureDate,
        sequenceType: batch.sequenceType,
        localInstrument: effectiveLocalInstrument,
      })
    }
  }

  // Collect R2 and R3 issues per mandate entry (R2 before R3 within each mandate, preserving original order).
  for (const [mandateId, usages] of mandateIndex) {
    if (usages.length < 2) continue
    issues.push(...checkR2Issues(mandateId, usages))
    issues.push(...checkR3Issues(mandateId, usages))
  }

  // Collect R4 issues (SMNDA must be in a FRST batch).
  issues.push(...checkR4SmndaRequiresFirst(doc))

  return issues
}
