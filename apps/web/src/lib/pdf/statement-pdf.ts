import { createElement } from "react";
import { StatementA4, type StatementA4Props } from "@/components/pdf/StatementA4";
import { htmlToPdf, documentHtml } from "@/lib/pdf/render";

/** StatementA4 props → PDF bytes. Shared by the PDF endpoint and the email path so
 *  both emit the identical statement. Mirrors renderDocumentPdf. */
export async function renderStatementPdf(props: StatementA4Props, baseHref?: string): Promise<ArrayBuffer> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const html = documentHtml(renderToStaticMarkup(createElement(StatementA4, props)), baseHref);
  return htmlToPdf(html);
}
