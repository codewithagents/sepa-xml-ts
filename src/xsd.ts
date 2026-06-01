/**
 * XSD validation for SEPA XML documents (pain.001.001.09 and pain.008.001.08).
 *
 * Uses libxml2-wasm for XSD schema validation.
 * This module is intentionally separate from the main export to allow
 * tree-shaking: import from "sepa-xml-ts/xsd" only when XSD validation is needed.
 *
 * The namespace is detected from the XML string to select the matching XSD.
 * Each validator is loaded lazily and cached independently.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// At runtime this file lives at dist/xsd.js, so __dirname = <project>/dist.
// One level up reaches the project root where schemas/ lives.
const SCHEMAS_DIR = join(__dirname, "../schemas/iso20022");

const XSD_PATH_001 = join(SCHEMAS_DIR, "pain.001.001.09.xsd");
const XSD_PATH_008 = join(SCHEMAS_DIR, "pain.008.001.08.xsd");

const NS_PAIN001 = "urn:iso:std:iso:20022:tech:xsd:pain.001.001.09";
const NS_PAIN008 = "urn:iso:std:iso:20022:tech:xsd:pain.008.001.08";

export interface XsdResult {
  /** true if the XML passed XSD validation */
  valid: boolean;
  /** validation errors, empty if valid */
  errors: string[];
}

// Per-namespace validator cache
let cachedValidator001: unknown = null;
let cachedValidator008: unknown = null;

/**
 * Detect the ISO 20022 namespace declared on the root Document element.
 * Uses a simple regex rather than a full XML parse to keep this fast.
 * Looks for: xmlns="urn:iso:std:iso:20022:tech:xsd:pain.NNN.NNN.NN"
 */
function detectNamespace(xml: string): string | null {
  const match = xml.match(/xmlns\s*=\s*["']([^"']+)["']/);
  return match ? (match[1] ?? null) : null;
}

/**
 * Validate an XML string against the appropriate SEPA XSD schema.
 *
 * The namespace is detected from the XML to select the matching XSD:
 * - pain.001.001.09 for CreditTransfer
 * - pain.008.001.08 for DirectDebit
 *
 * Each validator is cached after first load for performance.
 * Uses lazy import of libxml2-wasm to keep the main bundle light.
 *
 * @param xml the XML string to validate
 * @returns XsdResult with valid flag and any error messages
 */
export async function validateXsd(xml: string): Promise<XsdResult> {
  const { XmlDocument, XsdValidator, XmlValidateError } = await import(
    "libxml2-wasm"
  );

  const ns = detectNamespace(xml);

  let xsdPath: string;
  let cachedValidator: unknown;
  let setCachedValidator: (v: unknown) => void;

  if (ns === NS_PAIN008) {
    xsdPath = XSD_PATH_008;
    cachedValidator = cachedValidator008;
    setCachedValidator = (v) => { cachedValidator008 = v; };
  } else {
    // Default to pain.001 (also handles explicit NS_PAIN001)
    xsdPath = XSD_PATH_001;
    cachedValidator = cachedValidator001;
    setCachedValidator = (v) => { cachedValidator001 = v; };
  }

  // Build and cache the XSD validator for this namespace
  if (cachedValidator === null) {
    const xsdContent = readFileSync(xsdPath, "utf-8");
    const xsdDoc = XmlDocument.fromString(xsdContent);
    const validator = XsdValidator.fromDoc(xsdDoc);
    xsdDoc[Symbol.dispose]();
    setCachedValidator(validator);
    cachedValidator = validator;
  }

  const validator = cachedValidator as InstanceType<typeof XsdValidator>;

  let xmlDoc: InstanceType<typeof XmlDocument> | null = null;
  try {
    xmlDoc = XmlDocument.fromString(xml);
    validator.validate(xmlDoc);
    return { valid: true, errors: [] };
  } catch (err) {
    if (err instanceof XmlValidateError) {
      return {
        valid: false,
        errors: [err.message],
      };
    }
    // Re-throw unexpected errors (parse errors, etc.)
    throw err;
  } finally {
    xmlDoc?.[Symbol.dispose]();
  }
}
