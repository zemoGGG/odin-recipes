// Parse a recipe web page into this site's recipe fields.
// Shared by the import Worker (worker/) and the local debug script (scripts/parse-url.js).
import { findRecipe } from "./extract.js";
import { toSiteRecipe, emptyRecipe } from "./normalize.js";

export { findRecipe } from "./extract.js";
export * from "./normalize.js";

/**
 * @param {string} html  the page's HTML
 * @param {string} url   the page's URL (after redirects), used for relative links and credit
 * @param {{ categories?: string[] }} [options]  allowed category keys from site.js
 * @returns {{ recipe: object, warnings: string[] } | { recipe: null, error: string, partial: object }}
 *   When no recipe data is found, `partial` still has the title, photo and source so the
 *   import form can be filled in by hand.
 */
export function parseRecipePage(html, url, options = {}) {
  const { node, meta } = findRecipe(html);
  if (!node) {
    return {
      recipe: null,
      error: "We couldn't find recipe details on that page. You can still type or paste the recipe in below.",
      partial: emptyRecipe(url, meta),
    };
  }

  const recipe = toSiteRecipe(node, url, meta, options);
  const warnings = [];
  if (!recipe.ingredient_groups) warnings.push("No ingredients were found. Add them below.");
  if (!recipe.step_groups) warnings.push("No steps were found. Add them below.");
  if (!recipe.image_url) warnings.push("No photo was found.");
  return { recipe, warnings };
}
