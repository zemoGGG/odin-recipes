// Find the schema.org Recipe data in a recipe web page.
// Works on a raw HTML string (no DOM), so it runs the same in Node and in a Cloudflare Worker.

const LD_JSON_RE = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
const META_RE = /<meta\b[^>]*>/gi;
const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/**
 * @returns {{ node: object|null, meta: object, source?: "json-ld"|"microdata" }}
 *   node is the schema.org Recipe object; meta holds Open Graph fallbacks.
 */
export function findRecipe(html) {
  const meta = readMeta(html);

  for (const match of html.matchAll(LD_JSON_RE)) {
    const data = parseJson(match[1]);
    const node = data && findRecipeNode(data);
    if (node) return { node, meta, source: "json-ld" };
  }

  const node = readMicrodata(html);
  if (node) return { node, meta, source: "microdata" };

  return { node: null, meta };
}

export function isRecipeType(type) {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => typeof t === "string" && /(^|[/:#])Recipe$/i.test(t.trim()));
}

// Sites wrap JSON-LD in CDATA or comments, and some leave raw newlines inside strings.
function parseJson(text) {
  const cleaned = text
    .trim()
    .replace(/^(?:\/\/\s*)?<!\[CDATA\[|(?:\/\/\s*)?\]\]>$/g, "")
    .replace(/^<!--|-->$/g, "")
    .trim();
  for (const candidate of [cleaned, cleaned.replace(/[\u0000-\u001f]+/g, " ")]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next cleanup
    }
  }
  return null;
}

// Depth-first search through objects, arrays and @graph for a Recipe node.
function findRecipeNode(data, depth = 0) {
  if (!data || typeof data !== "object" || depth > 8) return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (isRecipeType(data["@type"])) return data;
  for (const value of Object.values(data)) {
    const found = findRecipeNode(value, depth + 1);
    if (found) return found;
  }
  return null;
}

export function parseAttrs(tag) {
  const attrs = {};
  for (const [, name, dq, sq, bare] of tag.matchAll(ATTR_RE)) {
    attrs[name.toLowerCase()] ??= dq ?? sq ?? bare ?? "";
  }
  return attrs;
}

function readMeta(html) {
  const meta = {};
  for (const [tag] of html.matchAll(META_RE)) {
    const attrs = parseAttrs(tag);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (attrs.content && ["og:site_name", "og:image", "og:title", "og:url", "application-name"].includes(key)) {
      meta[key] ??= attrs.content;
    }
  }
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title) meta.title = title[1];
  const canonical = html.match(/<link\b[^>]*\brel\s*=\s*["']?canonical["']?[^>]*>/i);
  if (canonical) meta.canonical = parseAttrs(canonical[0]).href;
  return meta;
}

// ---------- Microdata fallback (older sites) ----------
// A best-effort scan of itemprop="…" elements after the Recipe itemscope. Values are left as raw
// HTML/text; normalize.js cleans them the same way it cleans JSON-LD.

const SINGLE_PROPS = ["name", "description", "prepTime", "cookTime", "totalTime", "recipeYield", "recipeCategory", "recipeCuisine", "keywords", "image"];
const VOID_TAGS = new Set(["meta", "link", "img", "input", "br", "source"]);

function readMicrodata(html) {
  const scope = html.search(/itemtype\s*=\s*["']?https?:\/\/schema\.org\/Recipe["'\s>]/i);
  if (scope === -1) return null;
  const start = html.lastIndexOf("<", scope);
  const body = html.slice(start);

  const node = { "@type": "Recipe", recipeIngredient: [], recipeInstructions: [] };
  const authors = [];

  for (const match of body.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bitemprop\s*=\s*["']?([^"'>]+)["']?[^>]*>/gi)) {
    const [tag, tagName] = match;
    const attrs = parseAttrs(tag);
    const props = match[2].trim().split(/\s+/);
    const value = () =>
      attrs.content ?? attrs.datetime ?? (VOID_TAGS.has(tagName.toLowerCase()) ? attrs.src ?? attrs.href ?? "" : innerHtml(body, match.index, tagName));

    for (const prop of props) {
      if (prop === "recipeIngredient" || prop === "ingredients") node.recipeIngredient.push(value());
      else if (prop === "recipeInstructions") node.recipeInstructions.push(value());
      else if (prop === "author") authors.push(value());
      else if (SINGLE_PROPS.includes(prop)) node[prop] ??= value();
    }
  }

  if (authors.length) node.author = authors;
  return node.name || node.recipeIngredient.length ? node : null;
}

// The HTML between an element's opening tag at `index` and its matching closing tag.
function innerHtml(html, index, tagName) {
  const openEnd = html.indexOf(">", index) + 1;
  const re = new RegExp(`<(/?)${tagName}\\b[^>]*>`, "gi");
  re.lastIndex = openEnd;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(openEnd, m.index);
  }
  return html.slice(openEnd, openEnd + 2000);
}
