/**
 * The Diagnostics panel (#459): a read-only list for the grown-up helping, with
 * a Copy button that puts the same words on the clipboard. Loaded only when
 * "Diagnostics" is opened (`HelpControl.tsx`), so it adds nothing to the first
 * paint. The rows reuse the shape of the TV's capability report
 * (display/DisplayExtras.tsx `CapabilityReport`).
 */

import { useEffect, useState } from "react";
import { collectDiagnostics, diagnosticRows, diagnosticsText, type Diagnostics } from "./diagnostics";

import "./DiagnosticsPanel.css";

export default function DiagnosticsPanel(): React.JSX.Element {
  const [found, setFound] = useState<Diagnostics | null>(null);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  useEffect(() => {
    let live = true;
    void collectDiagnostics().then((next) => { if (live) setFound(next); });
    return () => { live = false; };
  }, []);

  const copy = (): void => {
    if (!found) return;
    const text = diagnosticsText(found);
    const done = (ok: boolean): void => { setCopied(ok ? "done" : "failed"); };
    try {
      void navigator.clipboard.writeText(text).then(() => { done(true); }, () => { done(false); });
    } catch {
      done(false);
    }
  };

  return (
    <section className="kad-diagnostics" aria-label="Diagnostics">
      {found ? (
        <>
          <ul className="kad-diagnostics__rows">
            {diagnosticRows(found).map((row) => (
              <li key={row.id} data-diagnostic={row.id}>
                <b>{row.label}</b>
                <span>{row.value}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="kad-diagnostics__copy kad-focusable" onClick={copy}>
            Copy
          </button>
          <span role="status" className="kad-diagnostics__status">
            {copied === "done" ? "Copied" : copied === "failed" ? "Could not copy" : ""}
          </span>
        </>
      ) : (
        <p>Checking…</p>
      )}
    </section>
  );
}
