/**
 * parse() returns ok:false for any internal error its backstop catches, so a test that only
 * checks ok:false cannot tell a rejection from a bug. These helpers let every negative case
 * and never-throws property of the parse tests fail on an internal error.
 */

import { expect } from 'vitest'
import type { ParseResult } from '../src/parser/parser.js'

/** The start of every error the parse() backstop returns (pinned by parse-backstop.test.ts). */
export const INTERNAL_PARSE_ERROR_PREFIX = 'Internal parse error'

/** Fail when a parse failure is an internal error the backstop caught, not a rejection. */
export function expectNoInternalParseError(result: ParseResult): void {
  if (result.ok) return
  expect(
    result.error.startsWith(INTERNAL_PARSE_ERROR_PREFIX),
    `parse reported an internal error: ${result.error}`
  ).toBe(false)
}
