import { useState } from "react";

/** Read long passages in small pages, including at larger text sizes. */
export function ReadingPages({ text }: { text: string }) {
  const [page, setPage] = useState(0);
  const words = text.trim().split(/\s+/);
  const pages = Math.max(1, Math.ceil(words.length / 40));
  const current = Math.min(page, pages - 1);
  return <>
    <p>{words.slice(current * 40, (current + 1) * 40).join(" ")}</p>
    {pages > 1 && <nav className="paged-options__nav" aria-label="Reading pages">
      <button type="button" onClick={() => setPage((current + pages - 1) % pages)}>Previous</button>
      <span role="status">{current + 1} / {pages}</span>
      <button type="button" onClick={() => setPage((current + 1) % pages)}>Next</button>
    </nav>}
  </>;
}
