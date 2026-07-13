// Phone normalization for WhatsApp sends — the Graph API wants E.164 digits
// (country code + number, no "+", no punctuation). Mauritius-aware: local
// 8-digit mobiles (5xxx xxxx) and 7-digit landlines get the 230 prefix;
// full international numbers pass through. Returns null when the input can't
// be a real phone — the campaign queue marks those recipients "invalid"
// instead of burning a paid send on them.

export function normalizePhoneMU(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const plus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (plus) {
    // "+230 5258 8854", "+33 6 12 34 56 78" — already international.
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2); // 00230… → 230…
  } else if (digits.length === 8 || digits.length === 7) {
    digits = `230${digits}`; // local MU: 8-digit mobile / 7-digit landline
  }
  // else: assume the country code was typed without "+" (e.g. 23052588854)

  if (digits.length < 10 || digits.length > 15) return null; // E.164 bounds (230 + 7 … 15)
  return digits;
}

/** Pretty display for a normalized number: 23052588854 → "+230 5258 8854". */
export function formatPhone(e164digits: string): string {
  if (e164digits.startsWith("230")) {
    const local = e164digits.slice(3);
    return `+230 ${local.length === 8 ? `${local.slice(0, 4)} ${local.slice(4)}` : local}`;
  }
  return `+${e164digits}`;
}
