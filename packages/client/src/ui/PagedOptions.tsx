import { Children, useState, type ComponentProps } from "react";
import "./PagedOptions.css";

/** Short lists with explicit pages keep every choice reachable without swiping. */
export function PagedOptions({ children, ...props }: ComponentProps<"ul">) {
  const options = Children.toArray(children);
  const signature = options.map((child) => typeof child === "object" && child !== null && "key" in child ? child.key : String(child)).join("|");
  return <OptionPages key={signature} options={options} {...props} />;
}

function OptionPages({ options, ...props }: ComponentProps<"ul"> & { options: ReturnType<typeof Children.toArray> }) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(options.length / 3);
  return <div className="paged-options">
    <ul {...props}>{options.slice(page * 3, page * 3 + 3)}</ul>
    {pages > 1 && <nav className="paged-options__nav" aria-label="Choice pages">
      <button type="button" onClick={() => setPage((page + pages - 1) % pages)}>Previous</button>
      <span role="status">{page + 1} / {pages}</span>
      <button type="button" onClick={() => setPage((page + 1) % pages)}>More choices</button>
    </nav>}
  </div>;
}
