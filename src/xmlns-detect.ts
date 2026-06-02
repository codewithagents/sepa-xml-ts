/**
 * Shared xmlns detection helper for SEPA XML documents.
 *
 * Used by both the public parse() path (src/parser/parser.ts) and the XSD
 * validation path (src/xsd.ts) so that the detection logic stays in sync.
 *
 * Design:
 * 1. Strip XML comments before matching so that a namespace value inside a
 *    comment cannot be mistaken for the real root namespace.
 * 2. Anchor the match to the opening tag of the <Document> root element, which
 *    is the only element that should carry the SEPA default xmlns declaration.
 *    The loose first-match approach would allow a comment or a nested element
 *    appearing before the Document tag to steer namespace detection.
 */

/**
 * Detect the ISO 20022 namespace declared on the root <Document> element.
 *
 * Returns the namespace URI string, or null if no matching xmlns attribute
 * is found on a <Document> opening tag.
 */
export function detectSepaNamespace(xml: string): string | null {
  // Strip XML comments to prevent comment content from matching as namespace.
  // This is a deliberate security measure: a crafted document with a fake
  // namespace in a comment before the real root could otherwise steer detection.
  const stripped = xml.replace(/<!--[\s\S]*?-->/g, '')

  // Match xmlns on the <Document> opening tag only.
  // Pattern breakdown:
  //   <Document    - the root element name (SEPA documents always use this)
  //   [^>]*        - any attributes before xmlns (BOM, xml: declarations, etc.)
  //   \s           - at least one whitespace separating the xmlns attribute
  //   xmlns\s*=\s* - the default namespace attribute
  //   ["']([^"']+)["'] - the namespace URI value in single or double quotes
  const match = stripped.match(/<Document[^>]*\sxmlns\s*=\s*["']([^"']+)["']/)
  return match ? (match[1] ?? null) : null
}
