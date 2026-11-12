/**
 * Reads the first `[[target]]` / `[[target|alias]]` / `[[target#heading]]` out
 * of a piece of text.
 *
 * Item names keep only the link itself: the date markers are stripped while
 * parsing, so a raw note line such as `[[大师傅但是 2026-09-21 ~ 2026-09-23]]`
 * reaches the views as `[[大师傅但是]]`. Taking the target from the rendered
 * name is what keeps the hover preview pointing at the right note.
 */
export function extractWikilink(text: string | null | undefined): string | null {
  if (!text) return null;

  const match = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/.exec(text);
  if (!match) return null;

  // A removed period can leave a stray space inside the brackets
  const target = match[1].trim().replace(/\s+/g, ' ');
  return target === '' ? null : target;
}
