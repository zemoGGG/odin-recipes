export default {
  layout: "layouts/recipe.njk",
  status: "published",
  // Imported recipes are public but kept out of search engines.
  noindex: true,
  eleventyComputed: {
    // Published recipes live under their owner's cookbook, e.g. /cookbooks/mom/lasagna.html.
    permalink: (data) =>
      data.status === "published" && data.cookbook ? `cookbooks/${data.cookbook}/${data.page.fileSlug}.html` : false,
  },
};
