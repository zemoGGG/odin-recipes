// Read by the import Worker (worker/) to check who a recipe can be saved for and which categories exist.
export const data = {
  permalink: "cookbooks/import-config.json",
  eleventyExcludeFromCollections: true,
};

export function render({ site }) {
  return JSON.stringify({
    members: site.members.map((m) => m.key),
    categories: site.categories.map((c) => c.key),
  });
}
