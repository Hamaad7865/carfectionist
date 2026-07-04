/**
 * MUR amount-in-words for the document template, e.g.
 *   8878000 → "EIGHTY EIGHT THOUSAND SEVEN HUNDRED EIGHTY RUPEES ONLY"
 * Uppercase, no hyphens, no "AND" inside the number (matches the client's format).
 * Input is integer cents.
 */

const ONES = [
  '', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
  'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN',
  'SEVENTEEN', 'EIGHTEEN', 'NINETEEN',
];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
const SCALES = ['', 'THOUSAND', 'MILLION', 'BILLION', 'TRILLION'];

function underThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(ONES[hundreds], 'HUNDRED');
  if (rest > 0) {
    if (rest < 20) parts.push(ONES[rest]);
    else {
      parts.push(TENS[Math.floor(rest / 10)]);
      if (rest % 10 > 0) parts.push(ONES[rest % 10]);
    }
  }
  return parts.join(' ');
}

function integerToWords(n: number): string {
  if (n === 0) return 'ZERO';
  const groups: number[] = [];
  let x = n;
  while (x > 0) {
    groups.push(x % 1000);
    x = Math.floor(x / 1000);
  }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    parts.push(underThousand(groups[i]));
    if (SCALES[i]) parts.push(SCALES[i]);
  }
  return parts.join(' ');
}

export function amountInWordsMUR(centsValue: number): string {
  const total = Math.abs(Math.trunc(centsValue));
  const rupees = Math.floor(total / 100);
  const cents = total % 100;
  const rupeeWords = integerToWords(rupees);
  if (cents === 0) return `${rupeeWords} RUPEES ONLY`;
  return `${rupeeWords} RUPEES AND ${integerToWords(cents)} CENTS ONLY`;
}
