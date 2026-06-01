/**
 * XSD validation for pain.001.001.09 XML documents.
 *
 * Uses libxml2-wasm for XSD schema validation.
 * This module is intentionally separate from the main export to allow
 * tree-shaking: import from "sepa-xml/xsd" only when XSD validation is needed.
 *
 * The XSD is loaded lazily on first call to validateXsd.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolved path to the XSD file.
// At runtime, this file lives at dist/xsd.js, so __dirname = <project>/dist.
// One level up reaches the project root where schemas/ lives.
const XSD_PATH = join(__dirname, "../schemas/iso20022/pain.001.001.09.xsd");

export interface XsdResult {
  /** true if the XML passed XSD validation */
  valid: boolean;
  /** validation errors, empty if valid */
  errors: string[];
}

let cachedValidator: unknown = null;
let libxmlLoaded = false;

/**
 * Validate an XML string against the pain.001.001.09 XSD schema.
 *
 * The validator is cached after first load for performance.
 * Uses lazy import of libxml2-wasm to keep the main bundle light.
 *
 * @param xml the XML string to validate
 * @returns XsdResult with valid flag and any error messages
 */
export async function validateXsd(xml: string): Promise<XsdResult> {
  // Lazy-load libxml2-wasm
  const { XmlDocument, XsdValidator, XmlValidateError } = await import(
    "libxml2-wasm"
  );

  if (!libxmlLoaded) {
    libxmlLoaded = true;
  }

  // Build and cache the XSD validator
  if (cachedValidator === null) {
    const xsdContent = readFileSync(XSD_PATH, "utf-8");
    const xsdDoc = XmlDocument.fromString(xsdContent);
    cachedValidator = XsdValidator.fromDoc(xsdDoc);
    xsdDoc[Symbol.dispose]();
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
