// Runs the Worker in Node with a fake fetch (GitHub, the recipe site and the image host).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import worker, { slugify, sniffImage, sanitizeNotes } from "../src/index.js";

const PASSCODE = "grandmas sunday sauce";
const ORIGIN = "https://zemoggg.github.io";
const env = {
  REPO: "zemoGGG/odin-recipes",
  BRANCH: "main",
  SITE_URL: "https://zemoggg.github.io/odin-recipes/",
  ALLOWED_ORIGINS: `${ORIGIN},http://localhost:8080`,
  GITHUB_TOKEN: "test-token",
  PASSCODE_HASH: createHash("sha256").update(PASSCODE).digest("hex"),
};

const recipeHtml = readFileSync(new URL("../../lib/recipe-import/fixtures/dotdash-array.html", import.meta.url), "utf8");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1]);

let calls;
let existing; // repo paths that already exist
let imageBody;
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  existing = new Set();
  imageBody = JPEG;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const ok = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

    if (url === `${env.SITE_URL}cookbooks/import-config.json`) {
      return ok({ members: ["mom", "dad"], categories: ["mains", "desserts", "soups"] });
    }
    if (url === "https://example.com/cookies-4x3.jpg") {
      return new Response(imageBody, { headers: { "Content-Type": "image/jpeg" } });
    }
    if (url.startsWith("https://example.com/cookies")) {
      return new Response(recipeHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    const gh = url.replace(`https://api.github.com/repos/${env.REPO}`, "");
    if (gh.startsWith("/contents/")) {
      const path = decodeURIComponent(gh.slice("/contents/".length).split("?")[0]);
      return existing.has(path) ? ok({ path }) : ok({ message: "Not Found" }, 404);
    }
    if (gh === "/git/blobs") return ok({ sha: `blob${calls.filter((c) => c.url.endsWith("/git/blobs")).length}` }, 201);
    if (gh === "/git/ref/heads/main") return ok({ object: { sha: "head" } });
    if (gh === "/git/commits/head") return ok({ tree: { sha: "tree0" } });
    if (gh === "/git/trees") return ok({ sha: "tree1" }, 201);
    if (gh === "/git/commits") return ok({ sha: "commit1" }, 201);
    if (gh === "/git/refs/heads/main" && method === "PATCH") return ok({ object: { sha: "commit1" } });

    throw new Error(`Unexpected fetch: ${method} ${url}`);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function call(path, data, { origin = ORIGIN, method = "POST" } = {}) {
  return worker.fetch(
    new Request(`https://import.example.workers.dev${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(origin && { Origin: origin }) },
      ...(method === "POST" && { body: JSON.stringify(data) }),
    }),
    env
  );
}

const decodeBlob = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

test("CORS preflight from the site is allowed; other origins are refused", async () => {
  const pre = await call("/parse", null, { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("Access-Control-Allow-Origin"), ORIGIN);

  const evil = await call("/parse", { passcode: PASSCODE, url: "https://example.com/cookies" }, { origin: "https://evil.example" });
  assert.equal(evil.status, 403);
});

test("wrong passcode is rejected", async () => {
  const res = await call("/parse", { passcode: "nope", url: "https://example.com/cookies" });
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /passcode/);
});

test("/parse returns the parsed recipe", async () => {
  const res = await call("/parse", { passcode: PASSCODE, url: "https://example.com/cookies" });
  assert.equal(res.status, 200);
  const { recipe, warnings } = await res.json();
  assert.equal(recipe.title, "Test Chocolate Chip Cookies");
  assert.equal(recipe.category, "desserts");
  assert.equal(recipe.ingredient_groups[0].items.length, 4);
  assert.deepEqual(warnings, []);
});

test("/parse rejects non-web and local links", async () => {
  for (const url of ["not a url", "ftp://example.com/x", "http://localhost:8080/", "http://192.168.1.10/recipe", "file:///etc/passwd"]) {
    const res = await call("/parse", { passcode: PASSCODE, url });
    assert.equal(res.status, 400, url);
  }
});

test("/save commits the recipe and photo in one commit, avoiding an existing slug", async () => {
  existing.add("src/cookbooks/test-chocolate-chip-cookies.md");
  const parsed = await (await call("/parse", { passcode: PASSCODE, url: "https://example.com/cookies" })).json();

  const res = await call("/save", {
    passcode: PASSCODE,
    member: "mom",
    recipe: { ...parsed.recipe, title: 'Test Chocolate Chip Cookies', step_groups: [{ name: "Bake", steps: ['Bake at 350°F: "until golden"'] }] },
    notes: "Use <b>brown</b> butter.\r\nSo good.",
  });
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.equal(result.url, "https://zemoggg.github.io/odin-recipes/cookbooks/mom/test-chocolate-chip-cookies-2.html");
  assert.deepEqual(result.warnings, []);

  const tree = calls.find((c) => c.url.endsWith("/git/trees")).body;
  assert.deepEqual(
    tree.tree.map((t) => t.path),
    ["src/cookbooks/test-chocolate-chip-cookies-2.md", "src/images/cookbooks/test-chocolate-chip-cookies-2.jpg"]
  );
  assert.equal(calls.find((c) => c.url.endsWith("/git/commits") && c.method === "POST").body.message, "Import recipe: Test Chocolate Chip Cookies (for mom)");
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 1);

  const md = decodeBlob(calls.find((c) => c.url.endsWith("/git/blobs")).body.content);
  assert.match(md, /^---\ntitle: "Test Chocolate Chip Cookies"\ncookbook: "mom"\ncategory: "desserts"\nstatus: "published"\n/);
  assert.match(md, /image: "\/images\/cookbooks\/test-chocolate-chip-cookies-2\.jpg"/);
  assert.match(md, /source_url: "https:\/\/example\.com\/cookies"/);
  assert.match(md, /step_groups:\n {2}- name: "Bake"\n {4}steps:\n {6}- "Bake at 350°F: \\"until golden\\""\n/);
  assert.match(md, /---\nUse &lt;b>brown&lt;\/b> butter.\nSo good.\n$/);
});

test("/save refuses unknown members and missing titles", async () => {
  let res = await call("/save", { passcode: PASSCODE, member: "../../etc", recipe: { title: "X" } });
  assert.equal(res.status, 400);
  res = await call("/save", { passcode: PASSCODE, member: "dad", recipe: { title: "   " } });
  assert.equal(res.status, 400);
  assert.ok(!calls.some((c) => c.url.includes("/git/")));
});

test("/save skips a photo that isn't really an image", async () => {
  imageBody = new TextEncoder().encode("<html>Access denied</html>");
  const res = await call("/save", {
    passcode: PASSCODE,
    member: "dad",
    recipe: { title: "Soup", category: "not-a-category", image_url: "https://example.com/cookies-4x3.jpg" },
  });
  const result = await res.json();
  assert.equal(res.status, 200);
  assert.equal(result.warnings.length, 1);
  const tree = calls.find((c) => c.url.endsWith("/git/trees")).body;
  assert.deepEqual(tree.tree.map((t) => t.path), ["src/cookbooks/soup.md"]);
  const md = decodeBlob(calls.find((c) => c.url.endsWith("/git/blobs")).body.content);
  assert.match(md, /category: "mains"/);
  assert.doesNotMatch(md, /image:/);
});

test("helpers", () => {
  assert.equal(slugify("Crème Brûlée & Friends!"), "creme-brulee-and-friends");
  assert.equal(slugify("!!!"), "recipe");
  assert.equal(sniffImage(JPEG), "jpg");
  assert.equal(sniffImage(new TextEncoder().encode("RIFF1234WEBPVP8 ")), "webp");
  assert.equal(sniffImage(new TextEncoder().encode("GIF89a........")), null);
  assert.equal(sanitizeNotes("a <script>"), "a &lt;script>");
});
