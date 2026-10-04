export default {
  layout: "layouts/recipe.njk",
  status: "draft",
  eleventyComputed: {
    // Only published recipes get a page. Keeps the old /recipes/<name>.html URLs working.
    permalink: (data) => (data.status === "published" ? `recipes/${data.page.fileSlug}.html` : false),
  },
};
