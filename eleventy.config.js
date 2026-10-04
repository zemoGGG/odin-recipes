import path from "node:path";
import { HtmlBasePlugin } from "@11ty/eleventy";
import Image from "@11ty/eleventy-img";

const STATUS_ORDER = { published: 0, "coming-soon": 1 };

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(HtmlBasePlugin);

  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });
  eleventyConfig.addPassthroughCopy({ "src/favicon.ico": "favicon.ico" });
  eleventyConfig.addPassthroughCopy({ "src/admin/index.html": "admin/index.html" });
  eleventyConfig.ignores.add("src/admin/index.html");

  // Every recipe that should appear on the site (drafts are hidden).
  // Published recipes come first, then "coming soon", each alphabetical.
  eleventyConfig.addCollection("recipes", (api) =>
    api
      .getFilteredByGlob("src/recipes/*.md")
      .filter((r) => r.data.status !== "draft")
      .sort(
        (a, b) =>
          (STATUS_ORDER[a.data.status] ?? 9) - (STATUS_ORDER[b.data.status] ?? 9) ||
          a.data.title.localeCompare(b.data.title)
      )
  );

  // Recipes family members imported into their personal cookbooks (drafts are hidden).
  eleventyConfig.addCollection("personalRecipes", (api) =>
    api
      .getFilteredByGlob("src/cookbooks/*.md")
      .filter((r) => r.data.status !== "draft" && r.data.cookbook)
      .sort((a, b) => a.data.title.localeCompare(b.data.title))
  );

  // Find an entry in one of the site.js lists by key, e.g. site.authors | lookup("matty").
  eleventyConfig.addFilter("lookup", (list, key) => list.find((item) => item.key === key) ?? { key, label: key });

  eleventyConfig.addFilter("byAuthor", (recipes, author) =>
    recipes.filter((r) => r.data.author === author)
  );

  eleventyConfig.addFilter("byMember", (recipes, member) =>
    recipes.filter((r) => r.data.cookbook === member)
  );

  // Category keys (in site.js order) that at least one recipe in the list uses.
  eleventyConfig.addFilter("usedCategories", (recipes, categories) => {
    const used = new Set(recipes.map((r) => r.data.category));
    return categories.filter((c) => used.has(c.key));
  });

  // Lowercased text the home page search matches against.
  eleventyConfig.addFilter("searchText", (data) =>
    [data.title, data.description, ...(data.ingredient_groups ?? []).flatMap((g) => g.items ?? [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
  );

  // Responsive <picture> for a photo stored under src/, e.g. "/images/recipes/lasagna.png".
  eleventyConfig.addAsyncShortcode("image", async (src, alt, sizes = "100vw", className = "", eager = false) => {
    const metadata = await Image(path.join("src", src), {
      widths: [480, 800, 1280],
      formats: ["webp", "jpeg"],
      outputDir: "_site/img/",
      urlPath: "/img/",
      sharpJpegOptions: { quality: 75, mozjpeg: true },
      sharpWebpOptions: { quality: 75 },
    });
    return Image.generateHTML(metadata, {
      alt: alt ?? "",
      sizes,
      loading: eager ? "eager" : "lazy",
      decoding: "async",
      ...(className && { class: className }),
      ...(eager && { fetchpriority: "high" }),
    });
  });

  return {
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    // Recipe notes are plain Markdown written in the CMS; don't treat {{ }} in them as template code.
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
    // Served from the root of https://cookbook.matthewmar.com/ (GitHub Pages custom domain)
    pathPrefix: "/",
  };
}
