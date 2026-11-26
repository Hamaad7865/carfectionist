const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** URL that opens every document of a split visit/sale in one printable tab. */
export function printDocsHref(ids: readonly string[]): string {
  const unique: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (id && !unique.includes(id)) unique.push(id);
  }
  if (unique.length === 0) return "";
  const [first, ...rest] = unique;
  return rest.length > 0 ? `/print/doc/${first}?also=${rest.join(",")}` : `/print/doc/${first}`;
}

/** Validated extra document IDs from `/print/doc/[id]?also=...`, deduped and excluding `primaryId`. */
export function parseAlsoDocIds(primaryId: string, also?: string, limit = 4): string[] {
  if (!also) return [];
  const out: string[] = [];
  for (const part of also.split(",")) {
    const id = part.trim();
    if (!UUID_RE.test(id) || id === primaryId || out.includes(id)) continue;
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}
