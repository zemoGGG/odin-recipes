# Vanessa & Matty's Recipes

Our family recipe site: **https://zemoggg.github.io/odin-recipes/**

It started as the final project of [The Odin Project](https://www.theodinproject.com/)'s HTML Foundations course. It has grown into the place where we keep the recipes we actually cook, and where the rest of the family can keep theirs.

## What's on the site

### The kitchens

- **Matty's Kitchen:** weeknight mains, pasta, soups, pizza from scratch and the sauces that go with them.
- **Vanessa's Bakery:** desserts and baking.

A gold star ★ marks a house specialty. Recipes marked *Coming soon* are on the way.

### Family Cookbooks

Everyone in the family gets their own cookbook at [/cookbooks/](https://zemoggg.github.io/odin-recipes/cookbooks/). To add a recipe from another website:

1. Open [Import a recipe](https://zemoggg.github.io/odin-recipes/cookbooks/import/).
2. Enter the family passcode (ask Matty). You only need to do this once per device.
3. Pick your name, paste the link to the recipe, and click **Get recipe**.
4. Check the ingredients and steps, fix anything that looks off, add your own notes, and click **Save**.

The recipe shows up in your cookbook about a minute later, in the same easy-to-read layout as the rest of the site. Every imported recipe links back to the site it came from.

Some websites block the importer. When that happens, the form still opens, so you can copy the recipe in by hand.

## Using a recipe

- **Search** by recipe name or ingredient, and filter by kitchen or category.
- **Tick off ingredients** as you gather them.
- **Tap a step** to mark it done while you cook.
- **Print** a clean copy with the *Print recipe* button.
- Works on phones, and follows your device's light or dark mode.

## How it's built

- Recipes are plain Markdown files, built into a fast static site by [Eleventy](https://www.11ty.dev/) and hosted on GitHub Pages.
- Matty and Vanessa edit their recipes through [Sveltia CMS](https://github.com/sveltia/sveltia-cms).
- A small [Cloudflare Worker](https://developers.cloudflare.com/workers/) reads recipes from other websites for the importer. It uses the [schema.org Recipe](https://schema.org/Recipe) data that most recipe sites include.
- Photos are resized automatically when the site is built.

To run it locally:

```sh
npm install
npm start   # http://localhost:8080/odin-recipes/
npm test
```
