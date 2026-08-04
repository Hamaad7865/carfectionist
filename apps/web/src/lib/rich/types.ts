/**
 * The rich content a document line can carry.
 *
 * Deliberately tiny. This is ProseMirror/TipTap-shaped — it is what `getJSON()`
 * returns once only the agreed extensions are registered — but it is written out
 * here as our own contract because three renderers have to agree on it forever:
 * the React one (A4 + the Sales screen), the Kotlin/Compose one on the tablet,
 * and the plain-text flattener.
 *
 * Nothing here can carry markup. A renderer walks this tree and emits whitelisted
 * elements, so a line description can never become a script — which is the whole
 * reason it is not stored as HTML. DocumentA4 renders into a live authenticated
 * staff browser, not only into headless Chromium.
 */

/** A stretch of text and the marks on it. `href` makes it a link. */
export interface Run {
  text: string;
  bold?: true;
  italic?: true;
  strike?: true;
  href?: string;
}

/** A list item and a table cell are both just a row of runs. */
export type Runs = Run[];

export interface Paragraph {
  type: "p";
  runs: Runs;
}

export interface BulletList {
  type: "ul";
  items: Runs[];
}

export interface OrderedList {
  type: "ol";
  items: Runs[];
}

/** Flat by construction: no merged cells, no nesting, no header/body split. */
export interface Table {
  type: "table";
  rows: Runs[][];
}

export type Block = Paragraph | BulletList | OrderedList | Table;

export interface RichDoc {
  /**
   * Bumped only when a node or mark is added. Every walker ignores what it does
   * not know, so an older platform renders a newer document minus the new parts
   * rather than failing — but the version is what makes that drift visible.
   */
  schemaVersion: 1;
  blocks: Block[];
}
