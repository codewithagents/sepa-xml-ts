/**
 * XSD validation for SEPA XML documents.
 *
 * Write targets: pain.001.001.09 and pain.008.001.08.
 * Read-only (coexistence) support: pain.001.001.03 and pain.008.001.02.
 *
 * Uses libxml2-wasm for XSD schema validation.
 * This module is intentionally separate from the main export to allow
 * tree-shaking: import from "sepa-xml-ts/xsd" only when XSD validation is needed.
 *
 * The namespace is detected from the XML string to select the matching XSD.
 * Each validator is loaded lazily and cached independently.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// At runtime this file lives at dist/xsd.js, so __dirname = <project>/dist.
// One level up reaches the project root where schemas/ lives.
const SCHEMAS_DIR = join(__dirname, '../schemas/iso20022')

const XSD_PATH_001_09 = join(SCHEMAS_DIR, 'pain.001.001.09.xsd')
const XSD_PATH_001_03 = join(SCHEMAS_DIR, 'pain.001.001.03.xsd')
const XSD_PATH_008_08 = join(SCHEMAS_DIR, 'pain.008.001.08.xsd')
const XSD_PATH_008_02 = join(SCHEMAS_DIR, 'pain.008.001.02.xsd')

const NS_PAIN001_09 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09'
const NS_PAIN001_03 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03'
const NS_PAIN008_08 = 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.08'
const NS_PAIN008_02 = 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.02'

export interface XsdResult {
  /** true if the XML passed XSD validation */
  valid: boolean
  /** validation errors, empty if valid */
  errors: string[]
}

// Per-namespace validator cache (one slot per supported schema)
let cachedValidator001_09: unknown = null
let cachedValidator001_03: unknown = null
let cachedValidator008_08: unknown = null
let cachedValidator008_02: unknown = null

/**
 * Detect the ISO 20022 namespace declared on the root Document element.
 * Uses a simple regex rather than a full XML parse to keep this fast.
 * Looks for: xmlns="urn:iso:std:iso:20022:tech:xsd:pain.NNN.NNN.NN"
 */
function detectNamespace(xml: string): string | null {
  const match = xml.match(/xmlns\s*=\s*["']([^"']+)["']/)
  return match ? (match[1] ?? null) : null
}

/**
 * Validate an XML string against the appropriate SEPA XSD schema.
 *
 * The namespace is detected from the XML to select the matching XSD:
 * - pain.001.001.09 (write target) for CreditTransfer
 * - pain.001.001.03 (read-only coexistence) for CreditTransfer legacy
 * - pain.008.001.08 (write target) for DirectDebit
 * - pain.008.001.02 (read-only coexistence) for DirectDebit legacy
 *
 * Each validator is cached after first load for performance.
 * Uses lazy import of libxml2-wasm to keep the main bundle light.
 *
 * @param xml the XML string to validate
 * @returns XsdResult with valid flag and any error messages
 */
export async function validateXsd(xml: string): Promise<XsdResult> {
  const { XmlDocument, XsdValidator, XmlValidateError } = await import('libxml2-wasm')

  const ns = detectNamespace(xml)

  let xsdPath: string
  let cachedValidator: unknown
  let setCachedValidator: (v: unknown) => void

  if (ns === NS_PAIN001_09) {
    xsdPath = XSD_PATH_001_09
    cachedValidator = cachedValidator001_09
    setCachedValidator = (v) => {
      cachedValidator001_09 = v
    }
  } else if (ns === NS_PAIN001_03) {
    xsdPath = XSD_PATH_001_03
    cachedValidator = cachedValidator001_03
    setCachedValidator = (v) => {
      cachedValidator001_03 = v
    }
  } else if (ns === NS_PAIN008_08) {
    xsdPath = XSD_PATH_008_08
    cachedValidator = cachedValidator008_08
    setCachedValidator = (v) => {
      cachedValidator008_08 = v
    }
  } else if (ns === NS_PAIN008_02) {
    xsdPath = XSD_PATH_008_02
    cachedValidator = cachedValidator008_02
    setCachedValidator = (v) => {
      cachedValidator008_02 = v
    }
  } else {
    // Unknown or missing namespace: do not silently validate against the wrong schema.
    return {
      valid: false,
      errors: [
        ns === null
          ? 'Could not detect an ISO 20022 namespace on the root Document element.'
          : `Unsupported namespace "${ns}". Supported: pain.001.001.09, pain.001.001.03, pain.008.001.08, pain.008.001.02.`,
      ],
    }
  }

  // Build and cache the XSD validator for this namespace
  if (cachedValidator === null) {
    const xsdContent = readFileSync(xsdPath, 'utf-8')
    const xsdDoc = XmlDocument.fromString(xsdContent)
    const validator = XsdValidator.fromDoc(xsdDoc)
    xsdDoc[Symbol.dispose]()
    setCachedValidator(validator)
    cachedValidator = validator
  }

  const validator = cachedValidator as InstanceType<typeof XsdValidator>

  let xmlDoc: InstanceType<typeof XmlDocument> | null = null
  try {
    xmlDoc = XmlDocument.fromString(xml)
    validator.validate(xmlDoc)
    return { valid: true, errors: [] }
  } catch (err) {
    if (err instanceof XmlValidateError) {
      return {
        valid: false,
        errors: [err.message],
      }
    }
    // Re-throw unexpected errors (parse errors, etc.)
    throw err
  } finally {
    xmlDoc?.[Symbol.dispose]()
  }
}
