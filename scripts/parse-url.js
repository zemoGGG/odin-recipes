// Print what the importer would pull out of a recipe page, without saving anything.
// Usage: npm run parse -- https://example.com/some-recipe
import site from "../src/_data/site.js";
import { parseRecipePage } from "../lib/recipe-import/index.js";

const url = process.argv[2];
if (!url) {
  console.error("Usage: npm run parse -- <recipe url>");
  process.exit(1);
}

const res = await fetch(url, {
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml",
  },
  redirect: "follow",
});
if (!res.ok) {
  console.error(`The site answered ${res.status} ${res.statusText}.`);
  process.exit(1);
}

const result = parseRecipePage(await res.text(), res.url, { categories: site.categories.map((c) => c.key) });
console.log(JSON.stringify(result, null, 2));
