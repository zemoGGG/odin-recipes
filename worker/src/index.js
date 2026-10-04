// Family Cookbooks import API (Cloudflare Worker).
//   POST /parse  { passcode, url }                      → parsed recipe for the preview form
//   POST /save   { passcode, member, recipe, notes }    → commits src/cookbooks/<slug>.md (+ photo)
// Setup and secrets: see the "Family Cookbooks" section of the repo README.
import { parseRecipePage, cleanText, absoluteUrl } from "../../lib/recipe-import/index.js";
import { toMarkdown } from "./frontmatter.js";
import { commitFiles, fileExists } from "./github.js";

const MAX_BODY_BYTES = 200_000;
const MAX_PAGE_BYTES = 3_000_000;
const MAX_IMAGE_BYTES = 8_000_000;
const CONFIG_TTL_MS = 5 * 60_000;

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// The only paths this Worker may ever write. Keeps a leaked passcode from touching anything else.
const ALLOWED_PATHS = [/^src\/cookbooks\/[a-z0-9-]+\.md$/, /^src\/images\/cookbooks\/[a-z0-9-]+\.(jpg|png|webp|avif)$/];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (!cors) return json({ error: "This site isn't allowed to use the importer." }, 403, {});
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const route = ROUTES[new URL(request.url).pathname];
    if (!route || request.method !== "POST") return json({ error: "Not found" }, 404, cors);

    try {
      const body = await readJson(request);
      await checkPasscode(request, env, body.passcode);
      return json(await route(body, env), 200, cors);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status, cors);
      console.error(err);
      return json({ error: "Something went wrong on our end. Please try again in a minute." }, 500, cors);
    }
  },
};

const ROUTES = { "/parse": parse, "/save": save };

// ---------- /parse ----------

async function parse(body, env) {
  const url = checkUrl(body.url);

  let res;
  try {
    res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow", signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new HttpError(502, "We couldn't reach that site. Check the link and try again.");
  }
  if (!res.ok) {
    throw new HttpError(
      502,
      res.status === 404
        ? "That page doesn't exist (404). Check the link and try again."
        : `That site wouldn't let the importer in (error ${res.status}). You can still copy the recipe in by hand below.`
    );
  }
  const type = res.headers.get("Content-Type") ?? "";
  if (type && !/html|xml/i.test(type)) throw new HttpError(422, "That link isn't a web page with a recipe on it.");

  const html = new TextDecoder().decode(await readLimited(res, MAX_PAGE_BYTES, true));
  const config = await getConfig(env).catch(() => null);
  return parseRecipePage(html, res.url || url, { categories: config?.categories });
}

// ---------- /save ----------

async function save(body, env) {
  const config = await getConfig(env).catch(() => {
    throw new HttpError(503, "Couldn't load the family list. Please try again in a minute.");
  });
  const member = String(body.member ?? "");
  if (!config.members.includes(member)) throw new HttpError(400, "Pick whose cookbook this goes in.");

  const recipe = sanitizeRecipe(body.recipe ?? {}, config.categories);
  if (!recipe.title) throw new HttpError(400, "Give the recipe a title.");
  const notes = sanitizeNotes(body.notes);

  const slug = await freeSlug(env, slugify(recipe.title));
  const warnings = [];
  const files = [];

  let image;
  if (recipe.image_url) {
    image = await downloadImage(recipe.image_url, recipe.source_url).catch(() => null);
    if (image) files.push({ path: `src/images/cookbooks/${slug}.${image.ext}`, content: image.bytes });
    else warnings.push("The photo couldn't be downloaded, so the recipe was saved without one.");
  }

  const markdown = toMarkdown(
    {
      title: recipe.title,
      cookbook: member,
      category: recipe.category,
      status: "published",
      description: recipe.description,
      image: image ? `/images/cookbooks/${slug}.${image.ext}` : "",
      image_alt: image ? recipe.title : "",
      servings: recipe.servings,
      prep_time: recipe.prep_time,
      cook_time: recipe.cook_time,
      total_time: recipe.total_time,
      source_url: recipe.source_url,
      source_name: recipe.source_name,
      source_author: recipe.source_author,
      imported_at: new Date().toISOString().slice(0, 10),
      ingredient_groups: recipe.ingredient_groups,
      step_groups: recipe.step_groups,
    },
    notes
  );
  files.unshift({ path: `src/cookbooks/${slug}.md`, content: markdown });

  for (const file of files) {
    if (!ALLOWED_PATHS.some((re) => re.test(file.path))) throw new Error(`Refusing to write ${file.path}`);
  }
  await commitFiles(env, files, `Import recipe: ${recipe.title} (for ${member})`);

  return { url: `${env.SITE_URL}cookbooks/${member}/${slug}.html`, slug, warnings };
}

const LIMITS = { title: 200, description: 1000, short: 60, name: 200, url: 2000, group: 100, item: 500, step: 3000 };

const str = (value, max) => cleanText(value).slice(0, max);
const httpUrl = (value) => (typeof value === "string" && value.length <= LIMITS.url ? absoluteUrl(value) : "");

function sanitizeGroups(groups, listKey, maxLength) {
  if (!Array.isArray(groups)) return [];
  return groups
    .slice(0, 20)
    .map((group) => {
      const list = (Array.isArray(group?.[listKey]) ? group[listKey] : []).slice(0, 150).map((s) => str(s, maxLength)).filter(Boolean);
      const name = str(group?.name, LIMITS.group);
      return name ? { name, [listKey]: list } : { [listKey]: list };
    })
    .filter((group) => group[listKey].length);
}

export function sanitizeRecipe(input, categories) {
  return {
    title: str(input.title, LIMITS.title),
    description: str(input.description, LIMITS.description),
    category: categories.includes(input.category) ? input.category : categories.includes("mains") ? "mains" : categories[0],
    servings: str(input.servings, LIMITS.short),
    prep_time: str(input.prep_time, LIMITS.short),
    cook_time: str(input.cook_time, LIMITS.short),
    total_time: str(input.total_time, LIMITS.short),
    ingredient_groups: sanitizeGroups(input.ingredient_groups, "items", LIMITS.item),
    step_groups: sanitizeGroups(input.step_groups, "steps", LIMITS.step),
    image_url: httpUrl(input.image_url),
    source_url: httpUrl(input.source_url),
    source_name: str(input.source_name, LIMITS.name),
    source_author: str(input.source_author, LIMITS.name),
  };
}

// Notes are Markdown, and the site's Markdown allows raw HTML, so escape "<" to keep it text.
export function sanitizeNotes(notes) {
  return String(notes ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/</g, "&lt;")
    .slice(0, 5000);
}

export function slugify(title) {
  return (
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "recipe"
  );
}

async function freeSlug(env, base) {
  for (let n = 1; n <= 50; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await fileExists(env, `src/cookbooks/${slug}.md`))) return slug;
  }
  throw new HttpError(409, "There are already a lot of recipes with that title. Try a different one.");
}

// Download the photo and check its real format from the first bytes. A broken or mislabeled
// image would otherwise fail the site build when eleventy-img tries to resize it.
async function downloadImage(url, referer) {
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, Accept: "image/avif,image/webp,image/*,*/*;q=0.8", ...(referer && { Referer: referer }) },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  if (Number(res.headers.get("Content-Length")) > MAX_IMAGE_BYTES) return null;
  const bytes = await readLimited(res, MAX_IMAGE_BYTES, false);
  const ext = sniffImage(bytes);
  return ext ? { bytes, ext } : null;
}

export function sniffImage(b) {
  if (!b || b.length < 12) return null;
  const ascii = (start, end) => String.fromCharCode(...b.subarray(start, end));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) return "avif";
  return null;
}

// ---------- helpers ----------

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const headers = { Vary: "Origin" };
  if (!origin) return headers; // not a browser request (e.g. curl while testing)
  if (!allowed.includes(origin)) return null;
  return {
    ...headers,
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

async function readJson(request) {
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES) throw new HttpError(413, "That recipe is too long to save.");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "That recipe is too long to save.");
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object") return body;
  } catch {
    // fall through
  }
  throw new HttpError(400, "Bad request.");
}

async function checkPasscode(request, env, passcode) {
  if (env.PASSCODE_LIMITER) {
    const key = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.PASSCODE_LIMITER.limit({ key });
    if (!success) throw new HttpError(429, "Too many tries. Wait a minute and try again.");
  }
  if (!env.PASSCODE_HASH) throw new Error("PASSCODE_HASH secret is not set");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(passcode ?? "").trim()));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!timingSafeEqual(hex, env.PASSCODE_HASH.trim().toLowerCase())) throw new HttpError(401, "That passcode isn't right.");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function checkUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw new HttpError(400, "That doesn't look like a web address. Copy the link from your browser's address bar.");
  }
  const host = url.hostname;
  if (
    !/^https?:$/.test(url.protocol) ||
    host === "localhost" ||
    host.endsWith(".local") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":") // IPv6 literal
  ) {
    throw new HttpError(400, "Only regular web links (https://…) can be imported.");
  }
  return url.href;
}

// Read a response body up to `max` bytes. Pages are cut off at the limit (the recipe data is
// almost always near the top); images over the limit are rejected.
async function readLimited(res, max, truncate) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      if (!truncate) return null;
      chunks.push(value.subarray(0, value.length - (size - max)));
      size = max;
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

let cachedConfig = null;
async function getConfig(env) {
  if (cachedConfig && Date.now() - cachedConfig.at < CONFIG_TTL_MS) return cachedConfig.value;
  const res = await fetch(`${env.SITE_URL}cookbooks/import-config.json`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`import-config.json: ${res.status}`);
  const value = await res.json();
  if (!Array.isArray(value.members) || !Array.isArray(value.categories)) throw new Error("import-config.json is malformed");
  cachedConfig = { at: Date.now(), value };
  return value;
}
