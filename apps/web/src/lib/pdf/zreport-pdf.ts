import { createElement } from "react";
import { ZReportA4, type ZReportA4Props } from "@/components/pdf/ZReportA4";
import { htmlToPdf, documentHtml } from "@/lib/pdf/render";

/** ZReportA4 props → PDF bytes. Shared by the Z-report PDF endpoint and the email
 *  path so both emit the identical close report. Mirrors renderDocumentPdf. */
export async function renderZReportPdf(props: ZReportA4Props, baseHref?: string): Promise<ArrayBuffer> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const html = documentHtml(renderToStaticMarkup(createElement(ZReportA4, props)), baseHref);
  return htmlToPdf(html);
}
