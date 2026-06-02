/**
 * Tests for Issue #12 (DOCTYPE/DTD rejection) and Issue #13 (xmlns anchored to Document root).
 *
 * Issue #12: Any input containing a DOCTYPE declaration must be rejected by
 *   both parse() and validateXsd() before reaching the XML parser.
 *
 * Issue #13: The xmlns namespace is detected from the <Document> root element
 *   only. A fake xmlns inside an XML comment before the root must not steer
 *   namespace detection.
 */

import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser/parser.js'
import { validateXsd } from '../src/xsd.js'
import { writeCreditTransfer } from '../src/writer/writer.js'
import { writeDirectDebit } from '../src/writer/direct-debit.js'
import { euros } from '../src/model/schema.js'
import type { CreditTransferDocument } from '../src/model/schema.js'
import type { DirectDebitDocument } from '../src/model/pain008.js'

// ---------------------------------------------------------------------------
// Minimal valid fixtures
// ---------------------------------------------------------------------------

const NS_PAIN001 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09'
const NS_UNKNOWN = 'urn:example:unknown'

const MINIMAL_CT: CreditTransferDocument = {
  messageId: 'HARDEN-CT-001',
  createdAt: '2024-06-01T09:00:00Z',
  initiatingParty: 'Test Initiator',
  batches: [
    {
      id: 'BATCH-001',
      executionDate: '2024-06-05',
      debtor: {
        name: 'Test Debtor',
        iban: 'DE89370400440532013000',
        bic: 'COBADEFFXXX',
      },
      transfers: [
        {
          endToEndId: 'E2E-0001',
          amount: euros('1.00'),
          creditor: {
            name: 'Test Creditor',
            iban: 'DE65200400300234567000',
          },
        },
      ],
    },
  ],
}

const MINIMAL_DD: DirectDebitDocument = {
  messageId: 'HARDEN-DD-001',
  createdAt: '2024-06-01T09:00:00Z',
  initiatingParty: 'Test Initiator',
  creditor: {
    name: 'Test Creditor',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX',
    creditorId: 'DE98ZZZ09999999999',
  },
  batches: [
    {
      id: 'SDD-BATCH-001',
      collectionDate: '2024-07-05',
      sequenceType: 'FRST',
      localInstrument: 'CORE',
      collections: [
        {
          endToEndId: 'SDD-E2E-0001',
          amount: euros('1.00'),
          debtor: {
            name: 'Test Debtor',
            iban: 'DE65200400300234567000',
          },
          mandate: {
            id: 'MAND-0001',
            signatureDate: '2024-01-15',
          },
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Issue #12: DOCTYPE/DTD rejection
// ---------------------------------------------------------------------------

describe('parse() DOCTYPE rejection (Issue #12)', () => {
  it('rejects a document with a simple DOCTYPE declaration', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo>
<Document xmlns="${NS_PAIN001}"><CstmrCdtTrfInitn/></Document>`
    const result = parse(xml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error).toMatch(/DOCTYPE|DTD/i)
  })

  it('rejects a document with a DOCTYPE and an internal subset containing an entity', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY x "PWNED">
]>
<Document xmlns="${NS_PAIN001}"><CstmrCdtTrfInitn>&x;</CstmrCdtTrfInitn></Document>`
    const result = parse(xml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error).toMatch(/DOCTYPE|DTD/i)
  })

  it('rejects a DOCTYPE with mixed case (e.g. <!doctype)', () => {
    const xml = `<?xml version="1.0"?>
<!doctype foo>
<Document xmlns="${NS_PAIN001}"><CstmrCdtTrfInitn/></Document>`
    const result = parse(xml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error).toMatch(/DOCTYPE|DTD/i)
  })
})

describe('validateXsd() DOCTYPE rejection (Issue #12)', () => {
  it('rejects a document with a simple DOCTYPE declaration', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo>
<Document xmlns="${NS_PAIN001}"><CstmrCdtTrfInitn/></Document>`
    const result = await validateXsd(xml)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toMatch(/DOCTYPE|DTD/i)
  })

  it('rejects a document with an internal subset containing an entity', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe "PWNED">
]>
<Document xmlns="${NS_PAIN001}"><CstmrCdtTrfInitn>&xxe;</CstmrCdtTrfInitn></Document>`
    const result = await validateXsd(xml)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toMatch(/DOCTYPE|DTD/i)
  })
})

// ---------------------------------------------------------------------------
// Issue #12 regression: standard entity escaping must still work
// ---------------------------------------------------------------------------

describe('standard escaped entities still parse correctly (Issue #12 regression)', () => {
  it('a party name with &apos; in the XML still decodes to an apostrophe', () => {
    // The apostrophe is the only XML-escapable character that is also valid in
    // the SEPA charset (& < > " are all outside it), so it is the right probe
    // to prove the DOCTYPE guard did not break standard entity decoding.
    const validXml = writeCreditTransfer(MINIMAL_CT)
    const withApos = validXml.replace('<Nm>Test Creditor</Nm>', '<Nm>O&apos;Brien Trading</Nm>')

    // The injected XML carries a standard entity, not a DOCTYPE.
    expect(withApos).toContain('&apos;')
    expect(withApos).not.toMatch(/<!DOCTYPE/i)

    const result = parse(withApos)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok:true, got: ' + result.error)
    expect(result.type).toBe('pain.001')
    // &apos; must have been decoded back to a literal apostrophe.
    expect(result.data.batches[0].transfers[0].creditor.name).toBe("O'Brien Trading")
  })

  it('a party name with &lt; and &gt; in the XML still parses correctly', () => {
    // The SEPA charset does not include < or >, so the writer replaces them.
    // We inject them directly into the XML to test the entity path.
    const validXml = writeCreditTransfer(MINIMAL_CT)
    // Replace the creditor name with an escaped angle bracket variant
    const withLtGt = validXml.replace('<Nm>Test Creditor</Nm>', '<Nm>Test &lt;Creditor&gt;</Nm>')
    const result = parse(withLtGt)
    // It may fail model validation (charset), but it must NOT throw
    expect(() => parse(withLtGt)).not.toThrow()
    expect(typeof result.ok).toBe('boolean')
  })

  it('valid pain.001 XML round-trips correctly after DOCTYPE guard is in place', () => {
    const xml = writeCreditTransfer(MINIMAL_CT)
    const result = parse(xml)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok:true, got: ' + result.error)
    if (result.type !== 'pain.001') throw new Error('expected type pain.001')
    expect(result.data).toEqual(MINIMAL_CT)
  })

  it('valid pain.008 XML round-trips correctly after DOCTYPE guard is in place', () => {
    const xml = writeDirectDebit(MINIMAL_DD)
    const result = parse(xml)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok:true, got: ' + result.error)
    if (result.type !== 'pain.008') throw new Error('expected type pain.008')
    expect(result.data).toEqual(MINIMAL_DD)
  })
})

// ---------------------------------------------------------------------------
// Issue #13: xmlns anchored to <Document> root (comment-steering prevention)
// ---------------------------------------------------------------------------

describe('xmlns detection anchored to <Document> root (Issue #13)', () => {
  it('a fake xmlns in an XML comment before the Document tag is ignored', () => {
    // Attacker inserts a comment with a bogus namespace before the real root.
    // With the old first-match regex this would have returned NS_UNKNOWN.
    // With the anchored regex it must use the real Document xmlns.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- xmlns="${NS_UNKNOWN}" this is a comment, not a namespace declaration -->
<Document xmlns="${NS_PAIN001}">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>HARDEN-001</MsgId>
      <CreDtTm>2024-06-01T09:00:00Z</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>1.00</CtrlSum>
      <InitgPty><Nm>Test</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>B1</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>1.00</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt><Dt>2024-06-05</Dt></ReqdExctnDt>
      <Dbtr><Nm>Test Debtor</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>DE89370400440532013000</IBAN></Id></DbtrAcct>
      <DbtrAgt><FinInstnId><BICFI>COBADEFFXXX</BICFI></FinInstnId></DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
      <CdtTrfTxInf>
        <PmtId><EndToEndId>E2E-0001</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">1.00</InstdAmt></Amt>
        <CdtrAgt><FinInstnId/></CdtrAgt>
        <Cdtr><Nm>Test Creditor</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>DE65200400300234567000</IBAN></Id></CdtrAcct>
      </CdtTrfTxInf>
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`

    const result = parse(xml)
    // Must parse as pain.001, not fail with "unknown namespace"
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('expected ok:true but got: ' + result.error)
    }
    expect(result.type).toBe('pain.001')
  })

  it('a document with only a fake xmlns in a comment (no real Document xmlns) returns ok:false with missing namespace', () => {
    // The real Document tag has no xmlns. Only the comment has one.
    // Old code would have picked up the comment's xmlns and tried to parse as pain.001.
    // New code must return "missing xmlns" because Document has no xmlns.
    const xml = `<?xml version="1.0"?>
<!-- xmlns="${NS_PAIN001}" -->
<Document>
  <CstmrCdtTrfInitn/>
</Document>`

    const result = parse(xml)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected ok:false')
    expect(result.error).toMatch(/xmlns|namespace/i)
  })

  it('validateXsd: fake xmlns in comment does not steer schema selection', async () => {
    // The XML has a comment with a supported namespace, but the real Document
    // tag uses an unknown/unsupported namespace. validateXsd must report
    // unsupported namespace (or missing), never try to validate against a
    // schema selected from the comment.
    const xml = `<?xml version="1.0"?>
<!-- xmlns="${NS_PAIN001}" -->
<Document xmlns="${NS_UNKNOWN}">
  <SomeElement/>
</Document>`

    const result = await validateXsd(xml)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    // Must mention the actual (unknown) namespace, not the comment's namespace
    expect(result.errors[0]).toMatch(/unsupported|unknown|namespace/i)
  })

  it('pain.008 XML with a comment containing a different namespace still parses as pain.008', () => {
    const baseXml = writeDirectDebit(MINIMAL_DD)
    // Insert a comment with a pain.001 namespace after the XML declaration
    const xmlWithComment = baseXml.replace(
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- xmlns="${NS_PAIN001}" ignore this -->`
    )

    const result = parse(xmlWithComment)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected ok:true, got: ' + result.error)
    expect(result.type).toBe('pain.008')
  })
})
