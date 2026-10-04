// Minimal GitHub REST helpers: check a file exists, and commit several files in one commit.

const API = "https://api.github.com";

async function gh(env, path, init = {}) {
  return fetch(`${API}/repos/${env.REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "odin-recipes-import",
      ...(init.body && { "Content-Type": "application/json" }),
    },
  });
}

async function ghJson(env, path, init) {
  const res = await gh(env, path, init);
  if (!res.ok) throw new Error(`GitHub ${init?.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const post = (body) => ({ method: "POST", body: JSON.stringify(body) });

export async function fileExists(env, path) {
  const res = await gh(env, `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(env.BRANCH)}`);
  if (res.status === 404) return false;
  if (res.ok) return true;
  throw new Error(`GitHub contents check for ${path} failed: ${res.status}`);
}

export function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Commit files to env.BRANCH in a single commit (Git Data API).
 * @param files [{ path, content: string | Uint8Array }]
 */
export async function commitFiles(env, files, message) {
  const blobs = [];
  for (const file of files) {
    const bytes = typeof file.content === "string" ? new TextEncoder().encode(file.content) : file.content;
    const blob = await ghJson(env, "/git/blobs", post({ content: toBase64(bytes), encoding: "base64" }));
    blobs.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  // If someone else pushed in between, the ref update fails with 422; rebuild on the new head once.
  for (let attempt = 0; ; attempt++) {
    const ref = await ghJson(env, `/git/ref/heads/${env.BRANCH}`);
    const head = await ghJson(env, `/git/commits/${ref.object.sha}`);
    const tree = await ghJson(env, "/git/trees", post({ base_tree: head.tree.sha, tree: blobs }));
    const commit = await ghJson(env, "/git/commits", post({ message, tree: tree.sha, parents: [ref.object.sha] }));
    const update = await gh(env, `/git/refs/heads/${env.BRANCH}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
    if (update.ok) return commit.sha;
    if (update.status !== 422 || attempt >= 1) {
      throw new Error(`GitHub ref update failed: ${update.status} ${await update.text()}`);
    }
  }
}
