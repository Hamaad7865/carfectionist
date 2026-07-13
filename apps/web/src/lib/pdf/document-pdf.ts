import { createElement } from "react";
import { DocumentA4, type DocumentA4Props } from "@/components/pdf/DocumentA4";
import { htmlToPdf, documentHtml } from "@/lib/pdf/render";

/** DocumentA4 props → PDF bytes. Shared by the authenticated PDF endpoint, the
 *  public tokenized route, and the send-to-customer flow so all three emit the
 *  identical document. */
export async function renderDocumentPdf(props: DocumentA4Props): Promise<ArrayBuffer> {
  // Dynamic import dodges Next's RSC-context guard on react-dom/server.
  const { renderToStaticMarkup } = await import("react-dom/server");
  const html = documentHtml(renderToStaticMarkup(createElement(DocumentA4, props)));
  return htmlToPdf(html);
}
