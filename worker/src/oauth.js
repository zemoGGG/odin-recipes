// "Sign In with GitHub" for the Sveltia CMS admin (/admin/). Same flow as sveltia-cms-auth:
// the CMS opens GET /auth in a popup → GitHub's consent page → GET /callback, which swaps the
// code for a token and hands it back to the admin window with postMessage.
// Needs a GitHub OAuth App whose callback URL is <worker url>/callback (see SETUP.md).

const STATE_COOKIE = "cms-oauth-state";

// public_repo is enough to edit this (public) repo. Use "repo" if the repo is ever made private.
const SCOPE = "public_repo";

export function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function handleAuth(request, env) {
  const url = new URL(request.url);
  const siteId = url.searchParams.get("site_id");
  const provider = url.searchParams.get("provider");

  if (provider && provider !== "github") return page(env, { error: "Only GitHub sign-in is supported." });
  if (siteId && !allowedOrigins(env).some((o) => new URL(o).hostname === siteId)) {
    return page(env, { error: "This site isn't allowed to sign in here." });
  }
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return page(env, { error: "GitHub sign-in isn't set up yet: missing the GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET secret." });
  }

  const state = crypto.randomUUID().replaceAll("-", "");
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.search = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: `${url.origin}/callback`,
    scope: SCOPE,
    state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.href,
      "Set-Cookie": `${STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    },
  });
}

export async function handleCallback(request, env) {
  const url = new URL(request.url);
  const params = url.searchParams;

  if (params.get("error")) {
    return page(env, { error: params.get("error_description") || "GitHub sign-in was cancelled." });
  }
  const state = params.get("state");
  if (!state || state !== readCookie(request, STATE_COOKIE)) {
    return page(env, { error: "That sign-in link expired. Close this window and try again." });
  }

  let data = {};
  try {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "odin-recipes-import" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code: params.get("code"),
        redirect_uri: `${url.origin}/callback`,
      }),
    });
    data = await res.json();
  } catch {
    // handled below
  }
  if (!data.access_token) {
    return page(env, { error: data.error_description || "GitHub didn't send back a sign-in token. Please try again." });
  }
  return page(env, { token: data.access_token });
}

function readCookie(request, name) {
  const cookies = request.headers.get("Cookie") ?? "";
  return cookies.split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}

// JSON that's safe to drop inside a <script> tag.
const scriptJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// The popup page: tells the admin window it's ready, then sends the result once the admin
// answers, and only to one of the site's own origins.
function page(env, { token, error }) {
  const content = error ? { provider: "github", error } : { provider: "github", token };
  const message = `authorization:github:${error ? "error" : "success"}:${JSON.stringify(content)}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Signing in…</title></head>
<body style="font-family: system-ui, sans-serif; padding: 24px">
<p>${error ? escapeHtml(error) : "Signed in. This window will close on its own."}</p>
<script>
(() => {
  const allowed = ${scriptJson(allowedOrigins(env))};
  const message = ${scriptJson(message)};
  window.addEventListener("message", ({ data, origin }) => {
    if (data === "authorizing:github" && allowed.includes(origin)) window.opener?.postMessage(message, origin);
  });
  window.opener?.postMessage("authorizing:github", "*");
})();
</script>
</body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
    },
  });
}
