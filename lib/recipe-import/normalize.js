// Turn a schema.org Recipe object into this site's recipe fields
// (the same frontmatter shape src/recipes/*.md and src/cookbooks/*.md use).

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", deg: "°", times: "×", frac12: "½", frac14: "¼",
  frac34: "¾", frac13: "⅓", frac23: "⅔", frac18: "⅛", eacute: "é", egrave: "è", ecirc: "ê", aacute: "á",
  agrave: "à", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", ccedil: "ç", uuml: "ü", ouml: "ö",
  auml: "ä", reg: "®", copy: "©", trade: "™", bull: "•", middot: "·",
};

export function decodeEntities(str) {
  // Two passes, because some sites double-encode (&amp;#39;).
  let out = String(str);
  for (let pass = 0; pass < 2 && /&(#\d+|#x[\da-f]+|[a-z]+\d*);/i.test(out); pass++) {
    out = out.replace(/&(#\d+|#x[\da-f]+|[a-z]+\d*);/gi, (whole, code) => {
      if (code[0] === "#") {
        const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
      }
      return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
    });
  }
  return out;
}

// Plain, single-line text: strip tags, decode entities, collapse whitespace.
export function cleanText(value) {
  if (value == null) return "";
  return decodeEntities(String(value).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// "PT1H30M" → "1 hr 30 min". Anything that isn't ISO 8601 is passed through as cleaned text.
export function formatDuration(value) {
  const text = cleanText(Array.isArray(value) ? value[0] : value);
  const m = text.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!m) return text;
  const [, d = 0, h = 0, min = 0, s = 0] = m;
  let total = Math.round(Number(d) * 1440 + Number(h) * 60 + Number(min) + Number(s) / 60);
  if (!total) return "";
  const days = Math.floor(total / 1440);
  total -= days * 1440;
  const hours = Math.floor(total / 60);
  const minutes = total - hours * 60;
  return [days && `${days} day${days > 1 ? "s" : ""}`, hours && `${hours} hr`, minutes && `${minutes} min`]
    .filter(Boolean)
    .join(" ");
}

// recipeYield can be "4", 4, "4 servings", or ["4", "4 servings"]. Prefer the most descriptive.
export function formatYield(value) {
  const options = (Array.isArray(value) ? value : [value]).map(cleanText).filter(Boolean);
  if (!options.length) return "";
  const best = options.find((o) => /[a-z]/i.test(o)) ?? options[0];
  return /^\d+(\s*[-–]\s*\d+)?$/.test(best) ? `${best} servings` : best;
}

// Size hint for an image: its width/height, or dimensions in the file name ("-225x225.jpg").
// A URL with no size at all is usually the full-size original.
function imageArea(url, width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w) return w * (h || w);
  const dims = url.match(/(\d{2,5})x(\d{1,5})(?=[^/]*$)/);
  return dims ? Number(dims[1]) * (Number(dims[2]) || Number(dims[1])) : Number.MAX_SAFE_INTEGER;
}

// image can be a URL, an ImageObject, or an array of either. Pick the biggest.
export function pickImage(value, baseUrl) {
  const candidates = (Array.isArray(value) ? value : [value])
    .map((img) => {
      const url = typeof img === "string" ? img : img && typeof img === "object" ? img.url || img.contentUrl : "";
      return typeof url === "string" && url.trim() ? { url, area: imageArea(url, img?.width, img?.height) } : null;
    })
    .filter(Boolean);
  if (!candidates.length) return "";
  const best = candidates.reduce((a, b) => (b.area > a.area ? b : a));
  return absoluteUrl(decodeEntities(best.url.trim()), baseUrl);
}

export function absoluteUrl(url, baseUrl) {
  try {
    const u = new URL(url, baseUrl);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

function names(value) {
  const list = (Array.isArray(value) ? value : [value])
    .map((v) => (v && typeof v === "object" ? v.name : v))
    .map(cleanText)
    .filter(Boolean);
  return [...new Set(list)].join(" & ");
}

export function readIngredients(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\n+/) : [];
  return list.map((item) => cleanText(typeof item === "object" ? item?.text ?? item?.name : item)).filter(Boolean);
}

// Leading "1.", "1)", "Step 1:" numbering that some sites put inside the step text.
const STEP_NUMBER_RE = /^(?:step\s*)?\d+\s*[.):-]\s*/i;

// Split a block of instruction text/HTML into separate steps.
function splitSteps(text) {
  return String(text)
    .split(/<\/?(?:li|p|ol|ul)\b[^>]*>|<br\s*\/?>|\n+/i)
    .map((s) => cleanText(s).replace(STEP_NUMBER_RE, ""))
    .filter(Boolean);
}

/**
 * recipeInstructions comes as a string, HowToStep[], HowToSection[] (with itemListElement),
 * an ItemList, or a mix. Returns site step_groups: [{ name?, steps: [] }].
 */
export function readInstructions(value) {
  const groups = [];
  let loose = null; // steps not inside a named section

  const addLoose = (steps) => {
    if (!steps.length) return;
    if (!loose) {
      loose = { steps: [] };
      groups.push(loose);
    }
    loose.steps.push(...steps);
  };

  const stepsOf = (item) => {
    if (item == null) return [];
    if (typeof item === "string") return splitSteps(item);
    if (Array.isArray(item)) return item.flatMap(stepsOf);
    if (typeof item !== "object") return [];
    if (item.itemListElement) return stepsOf(item.itemListElement);
    const text = item.text ?? item.description ?? item.name;
    return text ? splitSteps(text) : [];
  };

  const visit = (item) => {
    if (Array.isArray(item)) return item.forEach(visit);
    const type = item && typeof item === "object" ? [].concat(item["@type"] ?? []).join(" ") : "";
    if (/HowToSection/i.test(type)) {
      const steps = stepsOf(item.itemListElement);
      if (steps.length) {
        groups.push({ name: cleanText(item.name), steps });
        loose = null; // steps after a section start a new unnamed group
      }
    } else if (/ItemList/i.test(type) && item.itemListElement) {
      visit(item.itemListElement);
    } else {
      addLoose(stepsOf(item));
    }
  };

  visit(value);
  return groups.map((g) => (g.name ? g : { steps: g.steps }));
}

// Guess one of the site's category keys (src/_data/site.js). It's only a starting point; the
// import preview lets people change it.
const CATEGORY_RULES = [
  ["desserts", /\b(desserts?|cakes?|cookies?|pies?|brownies?|blondies?|puddings?|ice cream|cheesecakes?|cupcakes?|tarts?|cand(y|ies)|fudge|cobbler|crisp|sweets?)\b/],
  ["breakfast", /\b(breakfast|brunch|pancakes?|waffles?|french toast|omelett?es?|frittata|oatmeal|granola|muffins?|scones?)\b/],
  ["pizza", /\bpizzas?\b/],
  ["soups", /\b(soups?|stews?|chili|chowder|bisque|pho|ramen|gumbo)\b/],
  ["pasta", /\b(pasta|spaghetti|lasagn[ae]|noodles?|macaroni|mac and cheese|penne|fettuccine|linguine|rigatoni|ravioli|gnocchi|orzo|ziti)\b/],
  ["sauces", /\b(sauces?|dressings?|marinades?|gravy|salsa|pesto|dips?|vinaigrette|condiments?|aioli)\b/],
  ["breads", /\b(breads?|rolls?|buns?|biscuits?|focaccia|loaf|loaves|bagels?|tortillas?|naan|sourdough)\b/],
  ["sides", /\b(sides?|side dish(es)?|salads?|appetizers?|snacks?|vegetables?)\b/],
  ["mains", /\b(main( course| dish)?s?|dinners?|entr[ée]es?|lunch)\b/],
];

export function guessCategory(node, allowed) {
  const ok = (key) => !allowed || allowed.includes(key);
  // The title is the strongest signal, then the site's own category, then cuisine/keywords.
  const sources = [node.name, node.recipeCategory, [node.recipeCuisine, node.keywords]].map((v) =>
    [].concat(v ?? []).flat().map(cleanText).join(" ").toLowerCase()
  );
  for (const text of sources) {
    if (!text) continue;
    const hit = CATEGORY_RULES.find(([key, re]) => ok(key) && re.test(text));
    if (hit) return hit[0];
  }
  return ok("mains") ? "mains" : allowed?.[0] ?? "mains";
}

function hostName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Drop tracking parameters so the saved source link is clean.
export function cleanSourceUrl(url) {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_[ce]id$)/i.test(key)) u.searchParams.delete(key);
    }
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
}

/**
 * @param node   schema.org Recipe object (from extract.js)
 * @param url    the page the recipe came from
 * @param meta   Open Graph fallbacks from extract.js
 * @param options.categories  allowed category keys
 */
export function toSiteRecipe(node, url, meta = {}, { categories } = {}) {
  const ingredients = readIngredients(node.recipeIngredient ?? node.ingredients);
  const steps = readInstructions(node.recipeInstructions);

  const recipe = {
    title: cleanText(node.name) || cleanText(meta["og:title"]) || cleanText(meta.title),
    description: cleanText(node.description).slice(0, 1000),
    category: guessCategory(node, categories),
    servings: formatYield(node.recipeYield ?? node.yield),
    prep_time: formatDuration(node.prepTime),
    cook_time: formatDuration(node.cookTime),
    total_time: formatDuration(node.totalTime),
    ingredient_groups: ingredients.length ? [{ items: ingredients }] : [],
    step_groups: steps,
    image_url: pickImage(node.image, url) || pickImage(meta["og:image"], url),
    source_url: cleanSourceUrl(url),
    source_name: cleanText(meta["og:site_name"]) || names(node.publisher) || cleanText(meta["application-name"]) || hostName(url),
    source_author: names(node.author),
  };

  // Leave out empty fields so the saved frontmatter stays tidy.
  for (const [key, value] of Object.entries(recipe)) {
    if (value === "" || (Array.isArray(value) && !value.length)) delete recipe[key];
  }
  return recipe;
}

export function emptyRecipe(url, meta = {}) {
  const recipe = {
    title: cleanText(meta["og:title"]) || cleanText(meta.title),
    image_url: pickImage(meta["og:image"], url),
    source_url: cleanSourceUrl(url),
    source_name: cleanText(meta["og:site_name"]) || hostName(url),
  };
  for (const [key, value] of Object.entries(recipe)) if (!value) delete recipe[key];
  return recipe;
}
