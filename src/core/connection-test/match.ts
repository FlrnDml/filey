import { MAX_SENDER_LENGTH, sanitizeValue } from '../filer';

/** What a known document must yield; used by the connection test (§6.2). */
export interface SenderExpectation {
  /** Preferred sender; compared after the same normalisation the Filer applies (sanitize, cut to 10 characters). */
  sender: string;
  /** Further acceptable senders, e.g. the full name or an abbreviation. */
  senderAlternatives?: string[];
}

/** Same shaping the Filer applies to a sender (arc42 §5.2), plus case folding for comparison. */
export function normalizeSender(sender: string | null | undefined): string {
  const cut = Array.from(sanitizeValue(sender)).slice(0, MAX_SENDER_LENGTH).join('').trim();
  return (cut || 'Unknown').toLocaleLowerCase('de');
}

/** True if `actual` would end up as the same sender in the file name as the expected sender or one of its alternatives. */
export function senderMatches(expected: SenderExpectation, actual: string | null | undefined): boolean {
  const accepted = [expected.sender, ...(expected.senderAlternatives ?? [])].map(normalizeSender);
  return accepted.includes(normalizeSender(actual));
}
