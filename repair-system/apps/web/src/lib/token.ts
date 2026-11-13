/** يقبل الرابط كامل (…/track/<token> أو …/receipt/<token>) أو الرمز لوحده. */
export function extractToken(input: string): string {
  const t = input.trim();
  const m = /\/(?:track|receipt)\/([0-9a-f]{20,})/i.exec(t);
  return (m ? m[1] : t).toLowerCase();
}
