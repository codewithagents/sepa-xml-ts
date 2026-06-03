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
// IBAN-BIC country match helpers
// ---------------------------------------------------------------------------

/**
 * Territory exception table for IBAN vs BIC country code consistency.
 *
 * The general rule is: IBAN country code (chars 0-1) should equal BIC country
 * code (chars 4-5). However, several territories use a different IBAN country
 * code from the BIC country code because they are banking dependencies of a
 * larger country. These exceptions are documented here with their rationale.
 *
 * Key format: IBAN_CC -> set of valid BIC country codes.
 *
 * French overseas departments and collectivities (DOM-TOM):
 *   GP (Guadeloupe), GF (French Guiana), MQ (Martinique), RE (Reunion),
 *   YT (Mayotte), PM (Saint-Pierre-et-Miquelon), BL (Saint-Barthelemy),
 *   MF (Saint-Martin) are integral parts of France. Their banks are registered
 *   under FR in the BIC registry (ISO 9362). IBAN prefixes use the territory
 *   ISO 3166-1 code, but BICs use FR.
 *
 * British Crown Dependencies and Overseas Territories in the SEPA zone:
 *   GG (Guernsey), JE (Jersey), IM (Isle of Man) participate in the UK payment
 *   system. Banks are registered under GB in the BIC registry.
 *
 * Aland Islands (AX):
 *   Part of Finland. Banks are registered under FI in the BIC registry.
 *   IBAN uses AX prefix (though AX is rarely seen in practice).
 *
 * Monaco (MC):
 *   Has its own IBAN prefix (MC). Banks are registered under MC in the BIC
 *   registry, but some French branches serving Monaco accounts use FR BICs.
 *   We allow both MC and FR for MC IBANs.
 *
 * San Marino (SM):
 *   Has its own IBAN prefix (SM). Banks are registered under SM in the BIC
 *   registry, but Italian banking partners may use IT BICs for SM accounts.
 *   We allow both SM and IT for SM IBANs.
 */
const IBAN_BIC_TERRITORY_EXCEPTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  // French overseas departments: IBAN country -> allowed BIC countries
  ['GP', new Set(['FR', 'GP'])],
  ['GF', new Set(['FR', 'GF'])],
  ['MQ', new Set(['FR', 'MQ'])],
  ['RE', new Set(['FR', 'RE'])],
  ['YT', new Set(['FR', 'YT'])],
  ['PM', new Set(['FR', 'PM'])],
  ['BL', new Set(['FR', 'BL'])],
  ['MF', new Set(['FR', 'MF'])],
  // British Crown Dependencies: IBAN country -> allowed BIC countries
  ['GG', new Set(['GB', 'GG'])],
  ['JE', new Set(['GB', 'JE'])],
  ['IM', new Set(['GB', 'IM'])],
  // Aland Islands: IBAN country -> allowed BIC countries
  ['AX', new Set(['FI', 'AX'])],
  // Monaco: allow FR BICs for MC IBANs (some French branches serve MC accounts)
  ['MC', new Set(['FR', 'MC'])],
  // San Marino: allow IT BICs for SM IBANs (Italian banking partners)
  ['SM', new Set(['IT', 'SM'])],
])

/**
 * Returns true when the IBAN country and BIC country are consistent, accounting
 * for documented territory exceptions.
 */
function ibanBicCountriesMatch(ibanCc: string, bicCc: string): boolean {
  if (ibanCc === bicCc) {
    return true
  }
  const allowed = IBAN_BIC_TERRITORY_EXCEPTIONS.get(ibanCc)
  return allowed !== undefined && allowed.has(bicCc)
}

/**
 * Push an issue if a BIC is absent on a required agent field.
 * Encapsulates the repeated "if bic undefined, push issue" pattern in requireBic.
 */
function checkBicPresent(
  issues: ProfileIssue[],
  path: string,
  bic: string | undefined,
  role: 'debtor' | 'creditor'
): void {
  if (bic === undefined) {
    issues.push({
      path,
      message: `BIC is required by the selected bank profile but is missing on the ${role}`,
    })
  }
}

/**
 * Push an issue if the IBAN and BIC country codes are inconsistent (when both are present).
 * Encapsulates the repeated IBAN-BIC country match check in ibanBicCountryMatch.
 */
function checkIbanBicCountryConsistency(
  issues: ProfileIssue[],
  path: string,
  iban: string,
  bic: string | undefined,
  role: 'debtor' | 'creditor'
): void {
  if (bic === undefined) return
  const ibanCc = iban.slice(0, 2).toUpperCase()
  const bicCc = bic.slice(4, 6).toUpperCase()
  if (!ibanBicCountriesMatch(ibanCc, bicCc)) {
    issues.push({
      path,
      message:
        `IBAN country (${ibanCc}) does not match BIC country (${bicCc}) on the ${role}. ` +
        'Check for a data-entry error or use a different bank profile if this is intentional.',
    })
  }
}

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
      checkBicPresent(issues, `batches.${bi}.debtor.bic`, batch.debtor.bic, 'debtor')
      for (let ti = 0; ti < batch.transfers.length; ti++) {
        const transfer = batch.transfers[ti]
        if (transfer === undefined) continue
        checkBicPresent(
          issues,
          `batches.${bi}.transfers.${ti}.creditor.bic`,
          transfer.creditor.bic,
          'creditor'
        )
      }
    }
    return issues
  },

  checkDirectDebit(doc: DirectDebitDocument): ProfileIssue[] {
    const issues: ProfileIssue[] = []
    checkBicPresent(issues, 'creditor.bic', doc.creditor.bic, 'creditor')
    for (let bi = 0; bi < doc.batches.length; bi++) {
      const batch = doc.batches[bi]
      if (batch === undefined) continue
      for (let ci = 0; ci < batch.collections.length; ci++) {
        const collection = batch.collections[ci]
        if (collection === undefined) continue
        checkBicPresent(
          issues,
          `batches.${bi}.collections.${ci}.debtor.bic`,
          collection.debtor.bic,
          'debtor'
        )
      }
    }
    return issues
  },
}

// ---------------------------------------------------------------------------
// ibanBicCountryMatch: opt-in IBAN-BIC country consistency check
// ---------------------------------------------------------------------------

/**
 * Bank profile that checks IBAN-BIC country code consistency.
 *
 * Rationale: when a party has BOTH an IBAN and a BIC, the IBAN country code
 * (chars 1-2) and the BIC country code (chars 5-6) should normally match.
 * A mismatch can indicate a data-entry error (e.g. copying the wrong IBAN or
 * the wrong BIC). Some banks perform this check and reject mismatched files.
 *
 * This is intentionally a PROFILE rather than a core rule because the exception
 * list is fuzzy: French overseas territories (GP, GF, MQ, RE, YT, PM, BL, MF)
 * use FR-registered BICs with their own IBAN prefixes. Encoding a core rule
 * without a complete and maintained exception table risks false positives on
 * legitimate files. This profile ships with a documented exception table; users
 * can opt in when they know their bank performs this check.
 *
 * Exceptions are documented in IBAN_BIC_TERRITORY_EXCEPTIONS above.
 *
 * id: "iban-bic-country-match"
 */
export const ibanBicCountryMatch: BankProfile = {
  id: 'iban-bic-country-match',
  description:
    'Checks that each party IBAN country code matches the BIC country code, ' +
    'accounting for documented territory exceptions (French DOM-TOM, Channel Islands, etc.). ' +
    'This is an opt-in profile because the exception list is fuzzy and a false positive ' +
    'on a legitimate file is worse than no check.',

  checkCreditTransfer(doc: CreditTransferDocument): ProfileIssue[] {
    const issues: ProfileIssue[] = []
    for (let bi = 0; bi < doc.batches.length; bi++) {
      const batch = doc.batches[bi]
      if (batch === undefined) continue
      // Check debtor
      checkIbanBicCountryConsistency(
        issues,
        `batches.${bi}.debtor`,
        batch.debtor.iban,
        batch.debtor.bic,
        'debtor'
      )
      // Check per-transfer creditors
      for (let ti = 0; ti < batch.transfers.length; ti++) {
        const transfer = batch.transfers[ti]
        if (transfer === undefined) continue
        checkIbanBicCountryConsistency(
          issues,
          `batches.${bi}.transfers.${ti}.creditor`,
          transfer.creditor.iban,
          transfer.creditor.bic,
          'creditor'
        )
      }
    }
    return issues
  },

  checkDirectDebit(doc: DirectDebitDocument): ProfileIssue[] {
    const issues: ProfileIssue[] = []
    // Check document-level creditor
    checkIbanBicCountryConsistency(
      issues,
      'creditor',
      doc.creditor.iban,
      doc.creditor.bic,
      'creditor'
    )
    // Check per-collection debtors
    for (let bi = 0; bi < doc.batches.length; bi++) {
      const batch = doc.batches[bi]
      if (batch === undefined) continue
      for (let ci = 0; ci < batch.collections.length; ci++) {
        const collection = batch.collections[ci]
        if (collection === undefined) continue
        checkIbanBicCountryConsistency(
          issues,
          `batches.${bi}.collections.${ci}.debtor`,
          collection.debtor.iban,
          collection.debtor.bic,
          'debtor'
        )
      }
    }
    return issues
  },
}
