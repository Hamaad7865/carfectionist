// Pure variable rendering — shared by the wizard preview and the send queue so
// what the owner sees is exactly what Meta receives. A campaign's variable_map
// binds each template {{n}} to a source: a customer field, or static text.
//   { "1": "first_name", "2": "name", "3": "static:July promo" }
// Sources:
//   first_name → first word of the customer's name
//   name       → the full customer name
//   static:…   → literal text after the prefix

export interface RenderCustomer {
  name: string;
}

export function firstName(name: string): string {
  return (name ?? "").trim().split(/\s+/)[0] || "";
}

export function resolveVariable(source: string, c: RenderCustomer): string {
  if (source.startsWith("static:")) return source.slice(7);
  switch (source) {
    case "first_name":
      return firstName(c.name);
    case "name":
      return (c.name ?? "").trim();
    default:
      return "";
  }
}

/** Ordered variable values for {{1}}…{{n}} given a variable_count and map. */
export function renderVariables(
  variableMap: Record<string, string>,
  variableCount: number,
  c: RenderCustomer,
): string[] {
  const out: string[] = [];
  for (let i = 1; i <= variableCount; i++) {
    out.push(resolveVariable(variableMap[String(i)] ?? "", c));
  }
  return out;
}

/** Fill {{n}} into the body text for a human-readable preview. */
export function renderBodyPreview(body: string, values: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => values[Number(n) - 1] ?? `{{${n}}}`);
}

/** WhatsApp text formatting → minimal HTML for the bubble preview.
 *  *bold* _italic_ ~strike~ ```mono``` and newlines. Escapes HTML first. */
export function waFormatToHtml(text: string): string {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .replace(/```([\s\S]+?)```/g, "<code>$1</code>")
    .replace(/(^|\s)\*(\S(?:.*?\S)?)\*(?=\s|$)/g, "$1<b>$2</b>")
    .replace(/(^|\s)_(\S(?:.*?\S)?)_(?=\s|$)/g, "$1<i>$2</i>")
    .replace(/(^|\s)~(\S(?:.*?\S)?)~(?=\s|$)/g, "$1<s>$2</s>")
    .replace(/\n/g, "<br/>");
}

/** Count distinct {{n}} placeholders and validate they are 1..N with no gaps. */
export function countVariables(body: string): number {
  const nums = new Set<number>();
  for (const m of body.matchAll(/\{\{(\d+)\}\}/g)) nums.add(Number(m[1]));
  return nums.size;
}
