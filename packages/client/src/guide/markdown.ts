/**
 * The guide's Markdown (#257), read into blocks the guide screen draws.
 *
 * Only what `guide.md` uses, and nothing else: a title, sections and
 * subsections, paragraphs, lists, pictures on a line of their own, and bold.
 * Anything else is an error rather than a guess, so a construct this cannot
 * draw fails the guide's test instead of reaching a grown-up as stray
 * asterisks. Plain data out, never HTML, so the screen needs no
 * `dangerouslySetInnerHTML`.
 */

/** A run of text: plain, or bold (the guide's bold is what the screen says). */
export type Inline = { text: string; bold: boolean };

export type Block =
  | { kind: "paragraph"; text: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "picture"; alt: string; name: string }
  | { kind: "subheading"; text: string };

export interface Section {
  id: string;
  title: string;
  blocks: Block[];
}

export interface Guide {
  title: string;
  /** Before the first section: a line or two under the title. */
  intro: Block[];
  sections: Section[];
}

const PICTURE = /^!\[([^\]]+)\]\(([^)\s]+)\)$/;
const BULLET = /^- (.+)$/;
const NUMBERED = /^\d+\. (.+)$/;

/** A picture's file name, wherever the Markdown points at it. */
export function pictureName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function inline(text: string, where: string): Inline[] {
  const parts = text.split("**");
  if (parts.length % 2 === 0) throw new Error(`${where}: an unclosed ** in "${text}"`);
  const out: Inline[] = [];
  parts.forEach((part, i) => {
    if (/[*_`<>[\]]/.test(part)) throw new Error(`${where}: Markdown the guide does not draw in "${text}"`);
    if (part !== "") out.push({ text: part, bold: i % 2 === 1 });
  });
  return out;
}

export function parseGuide(source: string): Guide {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let title: string | null = null;
  const intro: Block[] = [];
  const sections: Section[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;

  const target = (): Block[] => sections.at(-1)?.blocks ?? intro;

  const flush = (): void => {
    if (paragraph.length > 0) {
      target().push({ kind: "paragraph", text: inline(paragraph.join(" "), paragraph[0] ?? "") });
      paragraph = [];
    }
    if (list !== null) {
      target().push({ kind: "list", ...list });
      list = null;
    }
  };

  lines.forEach((raw, index) => {
    const line = raw.trim();
    const where = `guide.md:${String(index + 1)}`;
    if (line === "" || (line.startsWith("<!--") && line.endsWith("-->"))) {
      flush();
      return;
    }
    if (line.startsWith("# ")) {
      if (title !== null) throw new Error(`${where}: a second title`);
      flush();
      title = line.slice(2).trim();
      return;
    }
    if (line.startsWith("## ")) {
      flush();
      const name = line.slice(3).trim();
      sections.push({ id: slug(name), title: name, blocks: [] });
      return;
    }
    if (line.startsWith("### ")) {
      flush();
      target().push({ kind: "subheading", text: line.slice(4).trim() });
      return;
    }
    if (line.startsWith("#")) throw new Error(`${where}: a heading deeper than ###`);
    const picture = PICTURE.exec(line);
    if (picture) {
      flush();
      target().push({ kind: "picture", alt: picture[1] ?? "", name: pictureName(picture[2] ?? "") });
      return;
    }
    const item = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (item) {
      const ordered = NUMBERED.test(line);
      if (paragraph.length > 0 || (list !== null && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push(inline(item[1] ?? "", where));
      return;
    }
    if (list !== null && raw.startsWith("  ")) {
      // A list item that wraps onto the next line.
      const last = list.items.pop() ?? [];
      list.items.push([...last, ...inline(` ${line}`, where)]);
      return;
    }
    if (list !== null) flush();
    paragraph.push(line);
  });
  flush();

  if (title === null) throw new Error("guide.md: no title");
  return { title, intro, sections };
}

/** Every word a grown-up reads, for the reading-time check. */
export function words(guide: Guide): number {
  const text: string[] = [guide.title];
  const add = (blocks: Block[]): void => {
    for (const block of blocks) {
      if (block.kind === "paragraph") text.push(...block.text.map((run) => run.text));
      if (block.kind === "list") text.push(...block.items.flat().map((run) => run.text));
      if (block.kind === "subheading") text.push(block.text);
    }
  };
  add(guide.intro);
  for (const section of guide.sections) {
    text.push(section.title);
    add(section.blocks);
  }
  return text.join(" ").split(/\s+/).filter((word) => /\w/.test(word)).length;
}
