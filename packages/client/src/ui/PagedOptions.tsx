import { Children, useState, type ComponentProps } from "react";
import "./PagedOptions.css";

/** Short lists with explicit pages keep every choice reachable without swiping. */
export function PagedOptions({ children, pageSize = 3, ...props }: ComponentProps<"ul"> & { pageSize?: number }) {
  const options = Children.toArray(children);
  const signature = options.map((child) => typeof child === "object" && child !== null && "key" in child ? child.key : String(child)).join("|");
  return <OptionPages key={`${pageSize}:${signature}`} options={options} pageSize={pageSize} {...props} />;
}

function OptionPages({ options, pageSize, ...props }: ComponentProps<"ul"> & { options: ReturnType<typeof Children.toArray>; pageSize: number }) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(options.length / pageSize);
  return <div className="paged-options">
    <ul {...props}>{options.slice(page * pageSize, page * pageSize + pageSize)}</ul>
    {pages > 1 && <nav className="paged-options__nav" aria-label="Choice pages">
      <button type="button" onClick={() => setPage((page + pages - 1) % pages)}>Previous</button>
      <span role="status">{page + 1} / {pages}</span>
      <button type="button" onClick={() => setPage((page + 1) % pages)}>More choices</button>
    </nav>}
  </div>;
}
