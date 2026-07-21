export const SEGMENTED_DESCRIPTION_INSTRUCTION = [
  "Latest description format requirement:",
  "Output the title on the first line, then output description HTML from the second line onward.",
  "Put every top-level <h2>, <p>, or <ul> block on its own line.",
  "Use line breaks only between complete top-level HTML blocks, never inside a tag or text node.",
  "This segmented HTML requirement supersedes any older single-line HTML instruction."
].join("\n");

export function formatSegmentedDescriptionHtml(value: string): string {
  return String(value || "")
    .replace(/[ ]*\r?\n[ ]*/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/^ +| +$/g, "")
    .replace(
      /(<\/(?:h2|p|ul)\s*>)\s*(?=<(?:h2|p|ul)>)/gi,
      "$1\n"
    );
}

export function hasInvalidDescriptionLineBreak(value: string): boolean {
  if (/\r/.test(value)) return true;
  return value
    .replace(
      /(<\/(?:h2|p|ul)\s*>)\n(?=<(?:h2|p|ul)>)/gi,
      "$1"
    )
    .includes("\n");
}
