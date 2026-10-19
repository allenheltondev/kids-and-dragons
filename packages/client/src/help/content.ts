/**
 * `content/help.json`, fetched on first ask and kept, like the Field Guide: a phone that never taps
 * "?" or long-presses never requests it. The shared screen asks for it when the lobby draws.
 * A failed fetch clears the cache so the next ask retries.
 */

import { useEffect, useState } from "react";
import type { HelpContent } from "@kad/shared";

let help: Promise<HelpContent> | null = null;

export function loadHelp(): Promise<HelpContent> {
  help ??= fetch("/content/help.json")
    .then((response) => {
      if (!response.ok) throw new Error(`help: ${String(response.status)}`);
      return response.json() as Promise<HelpContent>;
    })
    .catch((error: unknown) => {
      help = null;
      throw error;
    });
  return help;
}

/** Test seam: forget the cached help. */
export function resetHelpCache(): void {
  help = null;
}

/** The help content, or null until it arrives (and for good if it never does: help is never load-bearing). */
export function useHelp(): HelpContent | null {
  const [content, setContent] = useState<HelpContent | null>(null);
  useEffect(() => {
    let live = true;
    loadHelp().then(
      (loaded) => { if (live) setContent(loaded); },
      () => undefined,
    );
    return () => { live = false; };
  }, []);
  return content;
}
