// Shared site settings. The admin's author/category dropdowns are generated
// from this file too (see src/admin/config.yml.njk), so edit lists here only.
export default {
  title: "Vanessa & Matty's Recipes",
  tagline: "Family recipes from Matty's kitchen and Vanessa's bakery.",
  url: "https://zemoggg.github.io/odin-recipes/",
  repo: "zemoGGG/odin-recipes",

  authors: [
    { key: "matty", label: "Matty's Kitchen", short: "Matty", specialty: "A Matthew Specialty" },
    { key: "vanessa", label: "Vanessa's Bakery", short: "Vanessa", specialty: "A Vanessa Specialty" },
  ],

  // Family members with a personal cookbook (recipes imported from other sites).
  // The key is used in URLs (/cookbooks/<key>/) and must be lowercase letters, numbers or dashes.
  members: [
    { key: "member-one", label: "Member One's Cookbook", short: "Member One" },
    { key: "member-two", label: "Member Two's Cookbook", short: "Member Two" },
  ],

  // Cloudflare Worker that parses and saves imported recipes (see worker/README.md).
  importApi: "https://odin-recipes-import.example.workers.dev",

  categories: [
    { key: "mains", label: "Mains" },
    { key: "pasta", label: "Pasta" },
    { key: "soups", label: "Soups" },
    { key: "pizza", label: "Pizza" },
    { key: "sauces", label: "Sauces" },
    { key: "breads", label: "Breads" },
    { key: "sides", label: "Sides" },
    { key: "breakfast", label: "Breakfast" },
    { key: "desserts", label: "Desserts" },
  ],

  statuses: [
    { key: "published", label: "Published" },
    { key: "coming-soon", label: "Coming soon (card only, no page)" },
    { key: "draft", label: "Draft (hidden)" },
  ],
};
