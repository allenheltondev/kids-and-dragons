/**
 * BadgeArt — the medal on each badge in a kid's page (#299).
 *
 * A placeholder: one plain medal for every badge, until the painted art for
 * each badge lands. Every medal carries `data-badge` (the server's badge id,
 * shared kid-profile.ts) so the real art can be keyed by it, and it is
 * decorative: the badge's name is always printed beside it.
 */

import type { ReactElement } from "react";

export function BadgeArt({ id, className = "" }: { id: string; className?: string }): ReactElement {
  return (
    <svg className={`badge-art ${className}`.trim()} viewBox="0 0 100 100" aria-hidden="true" focusable="false" data-badge={id}>
      <path d="m30 70-9 26 12-6 6 8 6-26Zm40 0 9 26-12-6-6 8-6-26Z" fill="#5b3d9b" />
      <circle cx="50" cy="46" r="40" fill="#d9a24a" />
      <circle cx="50" cy="46" r="33" fill="#6a4aa8" />
      <path d="m50 26 6 12.5 13.7 1.8-10 9.6 2.5 13.6L50 56.700l-12.2 6.8 2.500-13.600-10-9.600L44 38.500Z" fill="#f5c86c" />
    </svg>
  );
}
