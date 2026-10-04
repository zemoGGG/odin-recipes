// Build a recipe .md file. Every string is written as a JSON string, which is also a valid
// double-quoted YAML string, so titles like "Mom's: The Best" or "- 1 cup" can't break the file.

const q = (value) => JSON.stringify(String(value));
const isEmpty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length);

/**
 * @param data  flat fields (strings/numbers), plus ingredient_groups / step_groups:
 *              [{ name?, items|steps: string[] }]
 * @param body  Markdown notes
 */
export function toMarkdown(data, body = "") {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    if (isEmpty(value)) continue;
    if (!Array.isArray(value)) {
      lines.push(`${key}: ${q(value)}`);
      continue;
    }
    lines.push(`${key}:`);
    for (const group of value) {
      Object.entries(group)
        .filter(([, v]) => !isEmpty(v))
        .forEach(([k, v], i) => {
          const prefix = i === 0 ? "  - " : "    ";
          if (Array.isArray(v)) {
            lines.push(`${prefix}${k}:`);
            for (const item of v) lines.push(`      - ${q(item)}`);
          } else {
            lines.push(`${prefix}${k}: ${q(v)}`);
          }
        });
    }
  }
  lines.push("---");
  const notes = body.trim();
  return lines.join("\n") + "\n" + (notes ? notes + "\n" : "");
}
