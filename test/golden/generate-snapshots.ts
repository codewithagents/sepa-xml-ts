/**
 * Canonical snapshot generator for golden-file regression tests.
 *
 * Run this script once to (re-)generate the committed snapshot XML files:
 *
 *   UPDATE_SNAPSHOTS=true pnpm test -- test/golden.test.ts
 *
 * Or run it directly:
 *
 *   node --import tsx/esm test/golden/generate-snapshots.ts
 *
 * The snapshots capture our writer output at a fixed point in time so that any
 * future drift (formatting change, field order change, element rename) is caught
 * immediately rather than silently shipping.
 */

import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeCreditTransfer } from '../../src/writer/writer.js'
import { writeDirectDebit } from '../../src/writer/direct-debit.js'
import { euros } from '../../src/model/schema.js'
import type { CreditTransferDocument } from '../../src/model/schema.js'
import type { DirectDebitDocument } from '../../src/model/pain008.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SNAPSHOTS_DIR = join(__dirname, 'snapshots')

// ---------------------------------------------------------------------------
// Canonical pain.001.001.09 snapshot model
// Multi-batch: batch 1 has 2 transfers (with + without BIC, with + without remittanceInfo),
// batch 2 has 1 transfer without BIC with remittanceInfo. Fixed deterministic inputs.
// ---------------------------------------------------------------------------

export const GOLDEN_CREDIT_TRANSFER: CreditTransferDocument = {
  messageId: 'GOLDEN-CT-001',
  createdAt: '2025-01-15T09:00:00Z',
  initiatingParty: 'Golden Test Corp',
  batches: [
    {
      id: 'GOLDEN-BATCH-01',
      executionDate: '2025-01-20',
      debtor: {
        name: 'Golden Test Corp',
        iban: 'DE89370400440532013000',
        bic: 'COBADEFFXXX',
      },
      transfers: [
        {
          endToEndId: 'GOLDEN-E2E-0001',
          amount: euros('123.45'),
          creditor: {
            name: 'Supplier One',
            iban: 'DE65200400300234567000',
            bic: 'DEUTDEDBFRA',
          },
          remittanceInfo: 'Invoice 2025/001',
        },
        {
          endToEndId: 'GOLDEN-E2E-0002',
          amount: euros('0.01'),
          creditor: {
            name: 'Supplier Two',
            iban: 'FR7630006000011234567890189',
          },
        },
      ],
    },
    {
      id: 'GOLDEN-BATCH-02',
      executionDate: '2025-02-01',
      debtor: {
        name: 'Golden Test Corp',
        iban: 'DE89370400440532013000',
      },
      transfers: [
        {
          endToEndId: 'GOLDEN-E2E-0003',
          amount: euros('999.99'),
          creditor: {
            name: 'Large Vendor',
            iban: 'NL91ABNA0417164300',
          },
          remittanceInfo: 'Q1 service fee',
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Canonical pain.008.001.08 snapshot model
// FRST batch + RCUR batch, with creditorId and mandates. Fixed deterministic inputs.
// ---------------------------------------------------------------------------

export const GOLDEN_DIRECT_DEBIT: DirectDebitDocument = {
  messageId: 'GOLDEN-DD-001',
  createdAt: '2025-01-15T09:00:00Z',
  initiatingParty: 'Golden Test Corp',
  creditor: {
    name: 'Golden Test Corp',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX',
    creditorId: 'DE98ZZZ09999999999',
  },
  batches: [
    {
      id: 'GOLDEN-DD-BATCH-01',
      collectionDate: '2025-02-05',
      sequenceType: 'FRST',
      localInstrument: 'CORE',
      collections: [
        {
          endToEndId: 'GOLDEN-DD-E2E-0001',
          amount: euros('49.99'),
          debtor: {
            name: 'Customer One',
            iban: 'DE65200400300234567000',
            bic: 'DEUTDEDBFRA',
          },
          mandate: {
            id: 'GOLDEN-MAND-001',
            signatureDate: '2025-01-10',
          },
          remittanceInfo: 'First collection Jan 2025',
        },
      ],
    },
    {
      id: 'GOLDEN-DD-BATCH-02',
      collectionDate: '2025-02-05',
      sequenceType: 'RCUR',
      localInstrument: 'CORE',
      collections: [
        {
          endToEndId: 'GOLDEN-DD-E2E-0002',
          amount: euros('19.99'),
          debtor: {
            name: 'Customer Two',
            iban: 'NL91ABNA0417164300',
          },
          mandate: {
            id: 'GOLDEN-MAND-002',
            signatureDate: '2024-06-01',
          },
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Write snapshot files
// ---------------------------------------------------------------------------

// Script entry point: invoked directly via node, not imported by any test file.
// fallow-ignore-next-line unused-export
export function writeSnapshots(): void {
  const ctXml = writeCreditTransfer(GOLDEN_CREDIT_TRANSFER)
  writeFileSync(join(SNAPSHOTS_DIR, 'pain.001.001.09.xml'), ctXml, 'utf-8')
  console.log('Written: snapshots/pain.001.001.09.xml')

  const ddXml = writeDirectDebit(GOLDEN_DIRECT_DEBIT)
  writeFileSync(join(SNAPSHOTS_DIR, 'pain.008.001.08.xml'), ddXml, 'utf-8')
  console.log('Written: snapshots/pain.008.001.08.xml')
}
