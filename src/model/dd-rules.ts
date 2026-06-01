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

  // Build an index: mandateId -> list of { batchIdx, colIdx, collectionDate, sequenceType, localInstrument }
  interface MandateUsage {
    batchIdx: number
    colIdx: number
    collectionDate: string
    signatureDate: string
    sequenceType: string
    localInstrument: string
  }

  const mandateIndex = new Map<string, MandateUsage[]>()

  for (let bIdx = 0; bIdx < doc.batches.length; bIdx++) {
    const batch = doc.batches[bIdx]
    // doc is validated so batch is always defined here
    if (batch === undefined) continue

    const effectiveLocalInstrument = batch.localInstrument ?? 'CORE'

    for (let cIdx = 0; cIdx < batch.collections.length; cIdx++) {
      const col = batch.collections[cIdx]
      if (col === undefined) continue

      const usage: MandateUsage = {
        batchIdx: bIdx,
        colIdx: cIdx,
        collectionDate: batch.collectionDate,
        signatureDate: col.mandate.signatureDate,
        sequenceType: batch.sequenceType,
        localInstrument: effectiveLocalInstrument,
      }

      // R1: signatureDate must not be after collectionDate (YYYY-MM-DD lexicographic)
      if (col.mandate.signatureDate > batch.collectionDate) {
        issues.push({
          path: `batches.${bIdx}.collections.${cIdx}.mandate.signatureDate`,
          message:
            `R1: mandate signatureDate (${col.mandate.signatureDate}) is after` +
            ` the batch collectionDate (${batch.collectionDate}).` +
            ` A debit cannot precede the mandate signature.`,
        })
      }

      // Accumulate usage for R2 and R3
      const existing = mandateIndex.get(col.mandate.id)
      if (existing !== undefined) {
        existing.push(usage)
      } else {
        mandateIndex.set(col.mandate.id, [usage])
      }
    }
  }

  // R2 and R3: check each mandate that appears more than once
  for (const [mandateId, usages] of mandateIndex) {
    if (usages.length < 2) continue

    // R2: if any usage is under OOFF, the mandate may appear exactly once in total
    const hasOoff = usages.some((u) => u.sequenceType === 'OOFF')
    if (hasOoff) {
      // The mandate appears more than once and at least one occurrence is OOFF.
      // Report one issue pointing to the second (and later) OOFF or non-OOFF occurrences.
      // We report all occurrences beyond the first to make the error precise.
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
    }

    // R3: all usages of a mandate must share the same local instrument
    const instruments = new Set(usages.map((u) => u.localInstrument))
    if (instruments.size > 1) {
      // Mandate appears under multiple instruments (e.g. CORE and B2B). Report from second occurrence.
      for (let i = 1; i < usages.length; i++) {
        const u = usages[i]
        if (u === undefined) continue
        const first = usages[0]
        if (first === undefined) continue
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
    }
  }

  // R4: SMNDA requires FRST sequenceType
  // If any collection in a batch has mandate.amendment.sameMandateNewDebtorAccount === true,
  // the batch's sequenceType must be 'FRST'.
  for (let bIdx = 0; bIdx < doc.batches.length; bIdx++) {
    const batch = doc.batches[bIdx]
    if (batch === undefined) continue

    if (batch.sequenceType === 'FRST') {
      // Already FRST, no violation possible for this batch.
      continue
    }

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
