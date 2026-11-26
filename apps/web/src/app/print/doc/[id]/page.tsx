import { notFound } from "next/navigation";
import { getDocumentProps } from "@/lib/supabase/queries/render";
import { parseAlsoDocIds } from "@/lib/documents/print-href";
import { DocumentA4 } from "@/components/pdf/DocumentA4";
import { PrintToolbar } from "./PrintToolbar";

// Standalone print view (outside the app shell). Opening it pops the browser's
// native print dialog (Windows print / Save as PDF). RLS scopes the query to
// the tenant via the session cookie.
//
// ?also=<id>,<id> prints the other quotes/invoices of a split visit after it in
// one window (one Print dialog, one page per company, no pop-up blocker).
export default async function PrintDocPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ also?: string }>;
}) {
  const { id } = await params;
  const { also } = await searchParams;
  const props = await getDocumentProps(id);
  if (!props) notFound();
  const otherIds = parseAlsoDocIds(id, also);
  const others = (await Promise.all(otherIds.map((x) => getDocumentProps(x)))).filter(
    (x): x is NonNullable<typeof x> => !!x,
  );
  const multi = others.length > 0;

  return (
    <div className={`print-screen${multi ? " print-multi" : ""}`} style={{ background: "#e9edf0", minHeight: "100vh", padding: "16px" }}>
      <PrintToolbar count={1 + others.length} />
      <DocumentA4 {...props} />
      {others.map((other, i) => (
        <div key={otherIds[i] ?? i} className="doc-next" style={{ marginTop: 16 }}>
          <DocumentA4 {...other} />
        </div>
      ))}
      <style>{`
        ${multi ? "@page { size: A4; margin: 0; }" : ""}
        @media print {
          .print-screen { background:#fff !important; padding:0 !important; min-height:0 !important; }
          .print-toolbar { display:none !important; }
          .doc-next { break-before: page; page-break-before: always; margin-top:0 !important; }
          .print-multi .paper { min-height: 296mm !important; }
        }
      `}</style>
    </div>
  );
}
