// TCP → USB print bridge.
//
// The Android app only speaks network ESC/POS (raw TCP, port 9100). This laptop's
// thermal printer is on USB, so this bridge listens on 9100 and forwards whatever the
// app sends straight to the Windows RAW spooler for that printer. From the emulator,
// point the app at Network · 10.0.2.2 : 9100 (10.0.2.2 = this host); from a real device
// on the LAN, use this laptop's LAN IP.
//
//   node scripts/print-bridge.mjs ["RONGTA 80mm Series Printer"] [port]
import net from "node:net";
import { writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PRINTER = process.argv[2] || "RONGTA 80mm Series Printer";
const PORT = Number(process.argv[3]) || 9100;

// P/Invoke the Win32 spooler so ESC/POS bytes go to the printer verbatim (RAW datatype),
// not through the driver (which would render them as text).
const PS_SEND = (file) => `
$ErrorActionPreference='Stop'
$src = @'
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool OpenPrinter(string pName, out IntPtr hPrinter, IntPtr pDefault);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);
  public static void Send(string printer, byte[] bytes) {
    IntPtr h;
    if(!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("OpenPrinter failed err="+Marshal.GetLastWin32Error());
    try {
      DOCINFO di = new DOCINFO(); di.pDocName="ESC/POS"; di.pDataType="RAW";
      if(StartDocPrinter(h,1,ref di)==0) throw new Exception("StartDocPrinter failed err="+Marshal.GetLastWin32Error());
      StartPagePrinter(h);
      int written; WritePrinter(h, bytes, bytes.Length, out written);
      EndPagePrinter(h); EndDocPrinter(h);
    } finally { ClosePrinter(h); }
  }
}
'@
Add-Type -TypeDefinition $src
$bytes=[System.IO.File]::ReadAllBytes(${JSON.stringify(file)})
[RawPrinter]::Send(${JSON.stringify(PRINTER)}, $bytes)
`;

function rawPrint(buf) {
  const tmp = join(tmpdir(), `escpos-${process.pid}-${Date.now()}.bin`);
  writeFileSync(tmp, buf);
  try {
    execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", PS_SEND(tmp)], { stdio: "pipe" });
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

const server = net.createServer((sock) => {
  const chunks = [];
  sock.on("data", (d) => chunks.push(d));
  sock.on("end", () => {
    const buf = Buffer.concat(chunks);
    if (!buf.length) return;
    try { rawPrint(buf); console.log(`→ printed ${buf.length} bytes`); }
    catch (e) { console.error("✗ print failed:", e.message); }
  });
  sock.on("error", () => {});
});
server.on("error", (e) => { console.error("bridge error:", e.message); process.exit(1); });
server.listen(PORT, "0.0.0.0", () => console.log(`✓ print bridge listening on :${PORT} → "${PRINTER}"`));
