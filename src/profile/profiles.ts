/**
 * Bundled reference bank profiles.
 *
 * Each profile is a documented overlay: extra validation and/or output tweaks on
 * top of the always-correct SEPA core. Profiles never change the message schema.
 * Named national write-variant profiles (e.g. pain.001.003.03 for Deutsche Kreditwirtschaft)
 * are a separate mechanism and are not included here.
 */

import type { BankProfile, ProfileIssue } from './profile.js'
import type { CreditTransferDocument } from '../model/schema.js'
import type { DirectDebitDocument } from '../model/pain008.js'

// ---------------------------------------------------------------------------
// requireBic: mandate a BIC on every agent
// ---------------------------------------------------------------------------

/**
 * Bank profile that requires a BIC on every agent field.
 *
 * Rationale: the SEPA XSD and the post-2016 SEPA rulebook make BIC optional
 * (IBAN-only payments are the norm), but a number of banks still reject files
 * that omit the BIC on any agent element. This profile catches those rejections
 * at validation time, before submission.
 *
 * Rules:
 *   - pain.001: every batch.debtor must have a bic; every transfer.creditor must have a bic.
 *   - pain.008: doc.creditor must have a bic; every collection.debtor must have a bic.
 *
 * id: "require-bic"
 */
export const requireBic: BankProfile = {
  id: 'require-bic',
  description:
    'Requires a BIC on every agent (debtor + each creditor for credit transfer; ' +
    'creditor + each debtor for direct debit). Some banks reject IBAN-only files even ' +
    'though the SEPA XSD and the post-2016 baseline make BIC optional. ' +
    'This profile surfaces that bank rule before submission.',

  checkCreditTransfer(doc: CreditTransferDocument): ProfileIssue[] {
    const issues: ProfileIssue[] = []
    for (let bi = 0; bi < doc.batches.length; bi++) {
      const batch = doc.batches[bi]
      if (batch === undefined) continue
      if (batch.debtor.bic === undefined) {
        issues.push({
          path: `batches.${bi}.debtor.bic`,
          message: 'BIC is required by the selected bank profile but is missing on the debtor',
        })
      }
      for (let ti = 0; ti < batch.transfers.length; ti++) {
        const transfer = batch.transfers[ti]
        if (transfer === undefined) continue
        if (transfer.creditor.bic === undefined) {
          issues.push({
            path: `batches.${bi}.transfers.${ti}.creditor.bic`,
            message: 'BIC is required by the selected bank profile but is missing on the creditor',
          })
        }
      }
    }
    return issues
  },

  checkDirectDebit(doc: DirectDebitDocument): ProfileIssue[] {
    const issues: ProfileIssue[] = []
    if (doc.creditor.bic === undefined) {
      issues.push({
        path: 'creditor.bic',
        message: 'BIC is required by the selected bank profile but is missing on the creditor',
      })
    }
    for (let bi = 0; bi < doc.batches.length; bi++) {
      const batch = doc.batches[bi]
      if (batch === undefined) continue
      for (let ci = 0; ci < batch.collections.length; ci++) {
        const collection = batch.collections[ci]
        if (collection === undefined) continue
        if (collection.debtor.bic === undefined) {
          issues.push({
            path: `batches.${bi}.collections.${ci}.debtor.bic`,
            message: 'BIC is required by the selected bank profile but is missing on the debtor',
          })
        }
      }
    }
    return issues
  },
}
