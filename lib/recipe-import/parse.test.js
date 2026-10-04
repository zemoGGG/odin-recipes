import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseRecipePage,
  formatDuration,
  formatYield,
  pickImage,
  decodeEntities,
  readInstructions,
  guessCategory,
  cleanSourceUrl,
} from "./index.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("top-level array with @type list (Allrecipes / Serious Eats shape)", () => {
  const { recipe, warnings } = parseRecipePage(fixture("dotdash-array.html"), "https://example.com/cookies?utm_source=x");
  assert.deepEqual(warnings, []);
  assert.equal(recipe.title, "Test Chocolate Chip Cookies");
  assert.equal(recipe.description, "Buttery cookies with crisp edges & soft centers.");
  assert.equal(recipe.category, "desserts");
  assert.equal(recipe.servings, "4 dozen cookies");
  assert.equal(recipe.prep_time, "20 min");
  assert.equal(recipe.total_time, "30 min");
  assert.deepEqual(recipe.ingredient_groups, [
    { items: ["1 cup butter, softened", "1 cup white sugar", "2 large eggs", "2 cups chocolate chips"] },
  ]);
  assert.deepEqual(recipe.step_groups, [
    {
      steps: [
        "Preheat the oven to 350°F (175°C).",
        "Beat butter and sugar until smooth.",
        "Stir in chocolate chips. Bake 10 minutes.",
      ],
    },
  ]);
  assert.equal(recipe.image_url, "https://example.com/cookies-4x3.jpg");
  assert.equal(recipe.source_url, "https://example.com/cookies");
  assert.equal(recipe.source_name, "Example Kitchen");
  assert.equal(recipe.source_author, "Pat Baker");
});

test("Yoast @graph with HowToSections (WordPress recipe plugin shape)", () => {
  const { recipe } = parseRecipePage(fixture("yoast-graph-sections.html"), "https://testblog.example/lasagna/");
  assert.equal(recipe.title, "Weeknight Lasagna");
  assert.equal(recipe.description, "Layers of sauce, cheese and noodles – ready in about an hour.");
  assert.equal(recipe.category, "pasta");
  assert.equal(recipe.servings, "8 servings");
  assert.equal(recipe.cook_time, "1 hr");
  assert.equal(recipe.total_time, "1 hr 20 min");
  assert.deepEqual(recipe.ingredient_groups[0].items, [
    "1 lb ground beef",
    "1 ½ cups ricotta",
    "12 lasagna noodles",
    "Sam’s favorite marinara (24 oz)",
  ]);
  assert.deepEqual(recipe.step_groups, [
    { name: "Make the sauce", steps: ["Brown the beef in a large skillet.", "Add the marinara and simmer 10 minutes."] },
    {
      name: "Assemble & bake",
      steps: ["Layer noodles, ricotta and sauce in a 9x13 pan.", "Bake covered at 375°F for 45 minutes."],
    },
  ]);
  assert.equal(recipe.image_url, "https://testblog.example/wp-content/uploads/lasagna.jpg");
  assert.equal(recipe.source_name, "Test Blog");
  assert.equal(recipe.source_author, "Sam Cook");
});

test("CDATA-wrapped JSON-LD, string instructions, invalid sibling block", () => {
  const { recipe, warnings } = parseRecipePage(fixture("string-instructions.html"), "https://www.sauces.example/marinara");
  assert.equal(recipe.title, "Simple Marinara Sauce");
  assert.equal(recipe.category, "sauces");
  assert.equal(recipe.servings, "4 servings");
  assert.equal(recipe.cook_time, "25 min");
  assert.deepEqual(recipe.ingredient_groups[0].items, ["2 tbsp olive oil", "3 cloves garlic, sliced", "1 (28 oz) can whole tomatoes"]);
  assert.deepEqual(recipe.step_groups[0].steps, [
    "Warm the oil and garlic over low heat.",
    "Add the tomatoes, crushing them by hand.",
    "Simmer 20 minutes.",
  ]);
  assert.equal(recipe.image_url, "https://www.sauces.example/images/marinara.jpg");
  assert.equal(recipe.source_name, "sauces.example");
  assert.deepEqual(warnings, []);
});

test("microdata fallback", () => {
  const { recipe } = parseRecipePage(fixture("microdata.html"), "https://oldsite.example/biscuits");
  assert.equal(recipe.title, "Grandma's Buttermilk Biscuits");
  assert.equal(recipe.category, "breads");
  assert.equal(recipe.servings, "10 biscuits");
  assert.equal(recipe.prep_time, "15 min");
  assert.equal(recipe.cook_time, "12 min");
  assert.deepEqual(recipe.ingredient_groups[0].items, ["2 cups flour", "1 tbsp baking powder", "3/4 cup cold buttermilk"]);
  assert.deepEqual(recipe.step_groups[0].steps, [
    "Cut the butter into the flour.",
    "Stir in the buttermilk, pat out and cut.",
    "Bake at 450°F for 12 minutes.",
  ]);
  assert.equal(recipe.image_url, "https://oldsite.example/biscuits.jpg");
  assert.equal(recipe.source_author, "Ruth");
});

test("page without recipe data returns an error and a partial recipe", () => {
  const result = parseRecipePage(fixture("no-recipe.html"), "https://breadblog.example/tips");
  assert.equal(result.recipe, null);
  assert.match(result.error, /couldn't find recipe/);
  assert.deepEqual(result.partial, {
    title: "10 Tips for Better Bread",
    image_url: "https://breadblog.example/tips.jpg",
    source_url: "https://breadblog.example/tips",
    source_name: "Bread Blog",
  });
});

test("formatDuration", () => {
  assert.equal(formatDuration("PT45M"), "45 min");
  assert.equal(formatDuration("PT1H30M"), "1 hr 30 min");
  assert.equal(formatDuration("PT90M"), "1 hr 30 min");
  assert.equal(formatDuration("PT2H"), "2 hr");
  assert.equal(formatDuration("P1DT2H"), "1 day 2 hr");
  assert.equal(formatDuration("PT0M"), "");
  assert.equal(formatDuration("PT0.5H"), "30 min");
  assert.equal(formatDuration(undefined), "");
  assert.equal(formatDuration("About 20 minutes"), "About 20 minutes");
});

test("formatYield", () => {
  assert.equal(formatYield(4), "4 servings");
  assert.equal(formatYield("6"), "6 servings");
  assert.equal(formatYield("4-6"), "4-6 servings");
  assert.equal(formatYield(["16", "1 loaf"]), "1 loaf");
  assert.equal(formatYield("Makes 12 rolls"), "Makes 12 rolls");
  assert.equal(formatYield(undefined), "");
});

test("pickImage", () => {
  const base = "https://site.example/recipe/";
  assert.equal(pickImage("https://cdn.example/a.jpg", base), "https://cdn.example/a.jpg");
  assert.equal(pickImage("../img/a.jpg", base), "https://site.example/img/a.jpg");
  assert.equal(
    pickImage([{ url: "https://cdn.example/small.jpg", width: 300, height: 200 }, { url: "https://cdn.example/big.jpg", width: 1200, height: 800 }], base),
    "https://cdn.example/big.jpg"
  );
  assert.equal(pickImage({ "@type": "ImageObject", contentUrl: "https://cdn.example/c.jpg" }, base), "https://cdn.example/c.jpg");
  assert.equal(pickImage("javascript:alert(1)", base), "");
  assert.equal(pickImage(undefined, base), "");
});

test("decodeEntities handles named, numeric and double-encoded entities", () => {
  assert.equal(decodeEntities("Mac &amp; Cheese"), "Mac & Cheese");
  assert.equal(decodeEntities("Grandma&#039;s &#x2014; best"), "Grandma's — best");
  assert.equal(decodeEntities("Sam&amp;#8217;s"), "Sam’s");
  assert.equal(decodeEntities("&unknown; stays"), "&unknown; stays");
});

test("readInstructions mixes loose steps and sections", () => {
  assert.deepEqual(
    readInstructions([
      "Preheat the oven.",
      { "@type": "HowToSection", name: "Topping", itemListElement: [{ "@type": "HowToStep", text: "Mix crumbs." }] },
      { "@type": "HowToStep", text: "Serve warm." },
    ]),
    [{ steps: ["Preheat the oven."] }, { name: "Topping", steps: ["Mix crumbs."] }, { steps: ["Serve warm."] }]
  );
  assert.deepEqual(readInstructions("Mix.\n\nBake."), [{ steps: ["Mix.", "Bake."] }]);
  assert.deepEqual(readInstructions(undefined), []);
});

test("guessCategory", () => {
  assert.equal(guessCategory({ name: "Beef Chili", recipeCategory: "Dinner" }), "soups");
  assert.equal(guessCategory({ name: "Grilled Pork Chops", recipeCategory: ["Main Course"] }), "mains");
  assert.equal(guessCategory({ name: "Fluffy Pancakes" }), "breakfast");
  assert.equal(guessCategory({ name: "Thing", keywords: "easy, cookies" }), "desserts");
  assert.equal(guessCategory({ name: "Something" }), "mains");
  assert.equal(guessCategory({ name: "Fluffy Pancakes" }, ["mains", "sides"]), "mains");
});

test("cleanSourceUrl drops tracking parameters", () => {
  assert.equal(cleanSourceUrl("https://a.example/r?id=3&utm_source=pin&fbclid=x#comments"), "https://a.example/r?id=3");
});
