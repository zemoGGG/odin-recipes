# Vanessa & Matty's Recipes

Family recipe site, live at **https://zemoggg.github.io/odin-recipes/**. It started as the final project of The Odin Project's HTML Foundations course.

Recipes are Markdown files in `src/recipes/`. [Eleventy](https://www.11ty.dev/) builds them into a static site, and GitHub Actions deploys it to GitHub Pages on every push to `main`.

## Adding or editing recipes (admin)

1. Go to **https://zemoggg.github.io/odin-recipes/admin/**.
2. Choose **Sign In Using Access Token** and paste your GitHub token (see below). The "Sign In with GitHub" button needs an OAuth server, which this setup skips.
3. Add or edit a recipe and click **Save**. That commits straight to `main`, and the site updates in about a minute (watch the **Actions** tab).

Each recipe has a **Status**:

| Status | What happens |
| --- | --- |
| Published | Shows on the home page and gets its own page |
| Coming soon | Shows a greyed-out card on the home page with no page yet |
| Draft | Hidden from the site; use it for the wishlist |

### One-time setup

- **Pages:** in the repo, go to *Settings → Pages → Build and deployment → Source* and pick **GitHub Actions**.
- **Admin token:** on GitHub, go to *Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*.
  - Repository access: *Only select repositories* → `odin-recipes`
  - Permissions: **Contents: Read and write**
  - The CMS remembers the token in your browser, so you only paste it once per device.

## Family Cookbooks (importing recipes from other sites)

Family members can save recipes from other websites into their own cookbook at **/cookbooks/**. They open **/cookbooks/import/**, enter the family passcode, pick their name and paste a link. The importer reads the recipe's ingredients, steps, times and photo, and shows them in a form to check over. Saving commits the recipe to `src/cookbooks/` (plus its photo in `src/images/cookbooks/`), and the site rebuilds in about a minute.

Imported recipe pages are public but marked `noindex`, and always credit and link the original site.

How it works: the static site can't fetch other websites or hold a GitHub token, so a small Cloudflare Worker (`worker/`) does both. The parsing code is in `lib/recipe-import/`.

### One-time setup

1. **GitHub token for the Worker.** Create a fine-grained token (*Settings → Developer settings → Personal access tokens → Fine-grained tokens*) with access to only `odin-recipes` and **Contents: Read and write**. Make it separate from your admin token, so you can revoke either one on its own.
2. **Cloudflare.** Sign up for a free account at https://dash.cloudflare.com/sign-up, then:
   ```sh
   cd worker
   npm install
   npx wrangler login
   npm run hash-passcode                    # type the family passcode, copy the hash it prints
   npx wrangler secret put PASSCODE_HASH    # paste the hash
   npx wrangler secret put GITHUB_TOKEN     # paste the token from step 1
   npm run deploy                           # prints the Worker URL
   ```
3. Put the Worker URL in `importApi` in `src/_data/site.js`, then commit and push.
4. Share the passcode and the **/cookbooks/import/** link with the family.

### Day to day

- **Add or rename a family member:** edit `members` in `src/_data/site.js`. The import page, cookbook pages and admin pick it up after the next deploy. The Worker sees the change within about 5 minutes.
- **Change the passcode:** `cd worker && npm run hash-passcode`, then `npx wrangler secret put PASSCODE_HASH`. Each device will ask for the new passcode the next time it's used.
- **Fix, hide or delete an imported recipe:** use the **Family cookbooks** collection in the admin. Set Status to *Draft* to hide a recipe without deleting it.
- **Check what the importer finds on a page:** `npm run parse -- <recipe url>`.
- **Some sites block the importer** (it shows "wouldn't let the importer in"). The form still opens empty with the link credited, so the recipe can be pasted in by hand.

### Testing the importer locally

```sh
npm test                       # parser + Worker tests
cd worker
# .dev.vars (gitignored) holds local secrets:
#   PASSCODE_HASH=<hash>
#   GITHUB_TOKEN=<token>
#   BRANCH=import-test         # an existing scratch branch, so test imports don't go live
#   SITE_URL=http://localhost:8080/odin-recipes/   # read the member list from your local site
npm run dev                    # http://localhost:8787
```

Then temporarily set `importApi` to `http://localhost:8787`, run `npm start`, and open http://localhost:8080/odin-recipes/cookbooks/import/.

## Local development

```sh
npm install
npm start        # http://localhost:8080/odin-recipes/
npm run build    # outputs to _site/
```

You can also use the admin locally without a token. Run `npm start`, open http://localhost:8080/odin-recipes/admin/ in Chrome or Edge, and choose **Work with Local Repository**. Then pick this folder, and edits are written straight to `src/`.

## Project layout

```
src/
  _data/site.js           site title, kitchens (authors), categories, statuses
  _includes/layouts/      base page + recipe page templates
  _includes/partials/     recipe card
  admin/                  Sveltia CMS (config.yml is generated from site.js)
  css/main.css            all styles
  js/                     home page filters, recipe page extras
  images/recipes/         recipe photos (resized automatically at build time)
  recipes/*.md            one file per recipe
  cookbooks/*.md          recipes imported into family members' cookbooks
  family*.njk             Family Cookbooks pages and the import page
  index.njk               home page
lib/recipe-import/        turns a recipe web page into the site's recipe format (+ tests)
worker/                   Cloudflare Worker behind the import page
eleventy.config.js
```

To add a new category or kitchen, edit `src/_data/site.js`. The admin dropdowns pick it up automatically.
