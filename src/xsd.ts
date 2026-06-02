/**
 * XSD validation for SEPA XML documents.
 *
 * Write targets: pain.001.001.09, pain.001.003.03 (DK CT variant), pain.008.001.08,
 * and pain.008.003.02 (DK SDD variant).
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
import { detectSepaNamespace } from './xmlns-detect.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// At runtime this file lives at dist/xsd.js, so __dirname = <project>/dist.
// One level up reaches the project root where schemas/ lives.
const SCHEMAS_ISO_DIR = join(__dirname, '../schemas/iso20022')
const SCHEMAS_DK_DIR = join(__dirname, '../schemas/dk')

const XSD_PATH_001_09 = join(SCHEMAS_ISO_DIR, 'pain.001.001.09.xsd')
const XSD_PATH_001_03 = join(SCHEMAS_ISO_DIR, 'pain.001.001.03.xsd')
const XSD_PATH_001_003_03 = join(SCHEMAS_DK_DIR, 'pain.001.003.03.xsd')
const XSD_PATH_008_08 = join(SCHEMAS_ISO_DIR, 'pain.008.001.08.xsd')
const XSD_PATH_008_02 = join(SCHEMAS_ISO_DIR, 'pain.008.001.02.xsd')
const XSD_PATH_008_003_02 = join(SCHEMAS_DK_DIR, 'pain.008.003.02.xsd')

const NS_PAIN001_09 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09'
const NS_PAIN001_03 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03'
const NS_PAIN001_003_03 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.003.03'
const NS_PAIN008_08 = 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.08'
const NS_PAIN008_02 = 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.02'
const NS_PAIN008_003_02 = 'urn:iso:std:iso:20022:tech:xsd:pain.008.003.02'

export interface XsdResult {
  /** true if the XML passed XSD validation */
  valid: boolean
  /** validation errors, empty if valid */
  errors: string[]
}

// Per-namespace validator cache (one slot per supported schema)
let cachedValidator001_09: unknown = null
let cachedValidator001_03: unknown = null
let cachedValidator001_003_03: unknown = null
let cachedValidator008_08: unknown = null
let cachedValidator008_02: unknown = null
let cachedValidator008_003_02: unknown = null

/**
 * Detect the ISO 20022 namespace declared on the root Document element.
 * Delegates to the shared detectSepaNamespace helper (see src/xmlns-detect.ts),
 * which strips XML comments before matching and anchors the search to the
 * <Document> opening tag to prevent namespace-steering via crafted comments.
 */
function detectNamespace(xml: string): string | null {
  return detectSepaNamespace(xml)
}

/**
 * Validate an XML string against the appropriate SEPA XSD schema.
 *
 * The namespace is detected from the XML to select the matching XSD:
 * - pain.001.001.09 (write target) for CreditTransfer
 * - pain.001.001.03 (read-only coexistence) for CreditTransfer legacy
 * - pain.001.003.03 (German DK write+read variant) for CreditTransfer
 * - pain.008.001.08 (write target) for DirectDebit
 * - pain.008.001.02 (read-only coexistence) for DirectDebit legacy
 * - pain.008.003.02 (German DK write+read variant) for DirectDebit
 *
 * Each validator is cached after first load for performance.
 * Uses lazy import of libxml2-wasm to keep the main bundle light.
 *
 * @param xml the XML string to validate
 * @returns XsdResult with valid flag and any error messages
 */
export async function validateXsd(xml: string): Promise<XsdResult> {
  // Reject DOCTYPE/DTD declarations. SEPA documents never legitimately contain a
  // DTD, and allowing them into the libxml2 parse path would expose the library
  // to XXE (external-entity expansion) and entity-bomb attacks.
  if (/<!DOCTYPE/i.test(xml)) {
    return {
      valid: false,
      errors: ['DOCTYPE/DTD is not permitted in SEPA documents'],
    }
  }

  const { XmlDocument, XsdValidator, XmlValidateError, ParseOption } = await import('libxml2-wasm')

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
  } else if (ns === NS_PAIN001_003_03) {
    xsdPath = XSD_PATH_001_003_03
    cachedValidator = cachedValidator001_003_03
    setCachedValidator = (v) => {
      cachedValidator001_003_03 = v
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
  } else if (ns === NS_PAIN008_003_02) {
    xsdPath = XSD_PATH_008_003_02
    cachedValidator = cachedValidator008_003_02
    setCachedValidator = (v) => {
      cachedValidator008_003_02 = v
    }
  } else {
    // Unknown or missing namespace: do not silently validate against the wrong schema.
    return {
      valid: false,
      errors: [
        ns === null
          ? 'Could not detect an ISO 20022 namespace on the root Document element.'
          : `Unsupported namespace "${ns}". Supported: pain.001.001.09, pain.001.001.03, pain.001.003.03, pain.008.001.08, pain.008.001.02, pain.008.003.02.`,
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
    // XML_PARSE_NO_XXE: explicitly disable loading of external DTDs and external
    // entities (both general and parameter entities). This is a defense-in-depth
    // measure alongside the DOCTYPE guard above. The ParseOption enum is
    // well-documented in the libxml2-wasm type declarations (document.d.mts).
    xmlDoc = XmlDocument.fromString(xml, { option: ParseOption.XML_PARSE_NO_XXE })
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
