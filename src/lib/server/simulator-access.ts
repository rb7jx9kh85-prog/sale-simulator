import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Optional protection for a personal MVP deployed on a public Vercel URL.
 * Set SALES_SIMULATOR_ACCESS_CODE in Vercel to require the user-entered code.
 */
export function hasValidSimulatorAccess(submittedCode: string | null) {
  const expectedCode = process.env.SALES_SIMULATOR_ACCESS_CODE;
  if (!expectedCode) return true;
  if (!submittedCode) return false;

  const expected = Buffer.from(expectedCode);
  const submitted = Buffer.from(submittedCode);
  return expected.length === submitted.length && timingSafeEqual(expected, submitted);
}
