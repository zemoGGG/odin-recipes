// Family Cookbooks import page: fetch and parse a recipe link through the import Worker,
// let the person check it over, then save it (the Worker commits it to the repo).
(() => {
  const root = document.getElementById("import");
  const api = root.dataset.api.replace(/\/+$/, "");
  const $ = (id) => document.getElementById(id);

  const fetchForm = $("fetch-form");
  const recipeForm = $("recipe-form");
  const status = $("status");
  const passcode = $("passcode");
  const member = $("member");
  const url = $("url");
  const fields = ["title", "category", "servings", "prep_time", "cook_time", "total_time", "description"];

  // Where the recipe came from; not editable, but saved for the "Adapted from" credit.
  let source = {};

  // ---------- passcode, remembered per device ----------
  const PASSCODE_KEY = "family-cookbook-passcode";
  const store = {
    get: () => { try { return localStorage.getItem(PASSCODE_KEY); } catch { return null; } },
    set: (v) => { try { localStorage.setItem(PASSCODE_KEY, v); } catch { /* private mode */ } },
    clear: () => { try { localStorage.removeItem(PASSCODE_KEY); } catch { /* private mode */ } },
  };
  const saved = store.get();
  if (saved) {
    passcode.value = saved;
    $("passcode-row").hidden = true;
  }

  const forMember = new URLSearchParams(location.search).get("for");
  if (forMember && [...member.options].some((o) => o.value === forMember)) member.value = forMember;

  // ---------- status messages ----------
  function showStatus(message, kind = "", link) {
    status.replaceChildren(document.createTextNode(message));
    if (link) {
      const a = document.createElement("a");
      a.href = link.href;
      a.textContent = link.text;
      status.append(" ", a);
    }
    status.className = `status-msg${kind ? ` is-${kind}` : ""}`;
    status.hidden = false;
  }

  function setBusy(button, busy, label) {
    button.disabled = busy;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = label;
    } else if (button.dataset.label) {
      button.textContent = button.dataset.label;
    }
  }

  async function callApi(path, payload) {
    let res;
    try {
      res = await fetch(api + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: passcode.value.trim(), ...payload }),
      });
    } catch {
      throw Object.assign(new Error("Couldn't reach the importer. Check your internet connection and try again."), { status: 0 });
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      store.clear();
      $("passcode-row").hidden = false;
      passcode.value = "";
      passcode.focus();
    }
    if (!res.ok) throw Object.assign(new Error(data.error || `Something went wrong (error ${res.status}).`), { status: res.status });
    store.set(passcode.value.trim());
    return data;
  }

  // ---------- ingredient / step groups ----------
  let groupCount = 0;

  function addGroup(container, group = {}) {
    const node = $("group-template").content.firstElementChild.cloneNode(true);
    const id = `group-${++groupCount}`;
    for (const label of node.querySelectorAll("[data-for]")) label.htmlFor = `${id}-${label.dataset.for}`;
    for (const input of node.querySelectorAll("[data-id]")) input.id = `${id}-${input.dataset.id}`;
    node.querySelector("[data-for='lines']").textContent = container.dataset.label;
    node.querySelector("[data-id='name']").value = group.name ?? "";
    node.querySelector("[data-id='lines']").value = (group[container.dataset.list] ?? []).join("\n");
    container.append(node);
    updateRemoveButtons(container);
    return node;
  }

  function updateRemoveButtons(container) {
    const groups = container.querySelectorAll(".group-editor");
    groups.forEach((g) => (g.querySelector("[data-remove-group]").hidden = groups.length === 1));
  }

  function setGroups(container, groups) {
    container.replaceChildren();
    (groups?.length ? groups : [{}]).forEach((g) => addGroup(container, g));
  }

  function readGroups(container) {
    const key = container.dataset.list;
    return [...container.querySelectorAll(".group-editor")]
      .map((node) => ({
        name: node.querySelector("[data-id='name']").value.trim(),
        [key]: node.querySelector("[data-id='lines']").value.split("\n").map((s) => s.trim()).filter(Boolean),
      }))
      .filter((g) => g[key].length);
  }

  document.querySelectorAll("[data-add-group]").forEach((button) =>
    button.addEventListener("click", () => {
      addGroup($(button.dataset.addGroup)).querySelector("[data-id='name']").focus();
    })
  );

  recipeForm.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-group]");
    if (!remove) return;
    const container = remove.closest("[data-list]");
    remove.closest(".group-editor").remove();
    updateRemoveButtons(container);
  });

  // ---------- fill / read the preview form ----------
  function fillForm(recipe = {}) {
    for (const field of fields) $(field).value = recipe[field] ?? "";
    if ($("category").selectedIndex < 0) $("category").selectedIndex = 0;
    setGroups($("ingredient-groups"), recipe.ingredient_groups);
    setGroups($("step-groups"), recipe.step_groups);
    $("notes").value = "";

    source = {
      source_url: recipe.source_url ?? "",
      source_name: recipe.source_name ?? "",
      source_author: recipe.source_author ?? "",
      image_url: recipe.image_url ?? "",
    };

    const credit = $("source-credit");
    if (source.source_url) {
      const a = document.createElement("a");
      a.href = source.source_url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = source.source_name || new URL(source.source_url).hostname;
      credit.replaceChildren("From ", a, source.source_author ? ` · by ${source.source_author}` : "");
      credit.hidden = false;
    } else {
      credit.hidden = true;
    }

    $("photo-row").hidden = !source.image_url;
    $("photo").src = source.image_url || "";
    $("use-photo").checked = true;

    recipeForm.hidden = false;
    recipeForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function readForm() {
    const recipe = Object.fromEntries(fields.map((f) => [f, $(f).value.trim()]));
    recipe.ingredient_groups = readGroups($("ingredient-groups"));
    recipe.step_groups = readGroups($("step-groups"));
    return { ...recipe, ...source, image_url: $("use-photo").checked ? source.image_url : "" };
  }

  function sourceFromLink(link) {
    try {
      const u = new URL(link);
      return { source_url: u.href, source_name: u.hostname.replace(/^www\./, "") };
    } catch {
      return {};
    }
  }

  // ---------- actions ----------
  fetchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!url.value.trim()) {
      showStatus("Paste a recipe link first, or choose \"type one in by hand\".", "error");
      url.focus();
      return;
    }
    const button = $("fetch-button");
    setBusy(button, true, "Reading the recipe…");
    showStatus("Reading the recipe… this can take a few seconds.");
    try {
      const data = await callApi("/parse", { url: url.value.trim() });
      if (data.recipe) {
        fillForm(data.recipe);
        const warnings = data.warnings ?? [];
        showStatus(warnings.length ? warnings.join(" ") : "Here's what we found. Fix anything that looks off, then save it.");
      } else {
        fillForm(data.partial);
        showStatus(data.error, "error");
      }
    } catch (err) {
      showStatus(err.message, "error");
      // The site blocked us or had no recipe: open an empty form that still credits the link.
      if (err.status === 502 || err.status === 422) fillForm(sourceFromLink(url.value.trim()));
    } finally {
      setBusy(button, false);
    }
  });

  $("manual-button").addEventListener("click", () => {
    fillForm(sourceFromLink(url.value.trim()));
    status.hidden = true;
    $("title").focus();
  });

  recipeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!member.value) {
      showStatus("Choose whose cookbook this goes in (at the top).", "error");
      member.focus();
      return;
    }
    if (!passcode.value.trim()) {
      showStatus("Enter the family passcode (at the top).", "error");
      $("passcode-row").hidden = false;
      passcode.focus();
      return;
    }
    const button = $("save-button");
    setBusy(button, true, "Saving…");
    try {
      const recipe = readForm();
      const result = await callApi("/save", { member: member.value, recipe, notes: $("notes").value });
      const name = member.options[member.selectedIndex].text;
      recipeForm.hidden = true;
      url.value = "";
      showStatus(
        `Saved to ${name}! ${result.warnings?.length ? result.warnings.join(" ") + " " : ""}It'll show up on the site in about a minute:`,
        "success",
        { href: result.url, text: recipe.title }
      );
      status.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      showStatus(err.message, "error");
    } finally {
      setBusy(button, false);
    }
  });

  $("start-over").addEventListener("click", () => {
    recipeForm.hidden = true;
    status.hidden = true;
    url.value = "";
    url.focus();
  });
})();
