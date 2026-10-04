// "Sign In with GitHub" routes for the admin, with GitHub's token endpoint faked.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const WORKER = "https://import.example.workers.dev";
const env = {
  ALLOWED_ORIGINS: "https://zemoggg.github.io,http://localhost:8080",
  GITHUB_CLIENT_ID: "client-123",
  GITHUB_CLIENT_SECRET: "secret-456",
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const get = (path, { cookie, envOverride } = {}) =>
  worker.fetch(new Request(`${WORKER}${path}`, { headers: cookie ? { Cookie: cookie } : {} }), { ...env, ...envOverride });

test("/auth redirects to GitHub with a state cookie", async () => {
  const res = await get("/auth?provider=github&site_id=zemoggg.github.io&scope=repo");
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get("Location"));
  assert.equal(location.origin + location.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(location.searchParams.get("client_id"), "client-123");
  assert.equal(location.searchParams.get("redirect_uri"), `${WORKER}/callback`);
  assert.equal(location.searchParams.get("scope"), "public_repo");
  const state = location.searchParams.get("state");
  assert.match(state, /^[0-9a-f]{32}$/);
  assert.match(res.headers.get("Set-Cookie"), new RegExp(`^cms-oauth-state=${state}; HttpOnly; Secure`));
});

test("/auth refuses other sites and reports missing setup", async () => {
  let res = await get("/auth?provider=github&site_id=evil.example");
  assert.match(await res.text(), /isn't allowed/);

  res = await get("/auth?provider=github&site_id=zemoggg.github.io", { envOverride: { GITHUB_CLIENT_SECRET: undefined } });
  assert.match(await res.text(), /missing the GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET secret/);
});

test("/callback rejects a state that doesn't match the cookie", async () => {
  globalThis.fetch = () => assert.fail("should not call GitHub");
  const res = await get("/callback?code=abc&state=aaaa", { cookie: "cms-oauth-state=bbbb" });
  const html = await res.text();
  assert.match(html, /authorization:github:error:/);
  assert.match(html, /expired/);
});

test("/callback swaps the code for a token and posts it only to allowed origins", async () => {
  let sent;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://github.com/login/oauth/access_token");
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ access_token: "gho_token</script>" }), { headers: { "Content-Type": "application/json" } });
  };
  const res = await get("/callback?code=abc&state=s1", { cookie: "other=1; cms-oauth-state=s1" });
  const html = await res.text();

  assert.deepEqual(sent, { client_id: "client-123", client_secret: "secret-456", code: "abc", redirect_uri: `${WORKER}/callback` });
  assert.match(html, /authorization:github:success:/);
  assert.match(html, /gho_token\\u003c\/script>/, "token can't break out of the script tag");
  assert.doesNotMatch(html, /gho_token<\/script>/);
  assert.match(html, /const allowed = \["https:\/\/zemoggg.github.io","http:\/\/localhost:8080"\]/);
  assert.match(res.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("/callback shows GitHub's error when sign-in is cancelled", async () => {
  const res = await get("/callback?error=access_denied&error_description=The+user+has+denied+your+application+access.");
  assert.match(await res.text(), /The user has denied your application access\./);
});
