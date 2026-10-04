// Home page filtering: author tabs (synced with the URL hash), category chips, and search.
(() => {
  const tabs = [...document.querySelectorAll(".tab")];
  const chips = [...document.querySelectorAll(".chip")];
  const sections = [...document.querySelectorAll(".kitchen")];
  const search = document.getElementById("search");
  const emptyState = document.getElementById("empty-state");
  if (!search) return; // e.g. an empty family cookbook page has no toolbar
  const authors = tabs.map((t) => t.dataset.author);

  const state = { author: "all", category: "all", query: "" };

  function authorFromHash() {
    const key = location.hash.slice(1);
    return authors.includes(key) ? key : "all";
  }

  function setPressed(buttons, attr, value) {
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset[attr] === value)));
  }

  function apply() {
    const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    const categoriesInView = new Set();
    let anyVisible = false;

    for (const section of sections) {
      const sectionInView = state.author === "all" || section.dataset.author === state.author;
      let sectionHasMatch = false;

      for (const card of section.querySelectorAll(".card")) {
        if (sectionInView) categoriesInView.add(card.dataset.category);
        const match =
          sectionInView &&
          (state.category === "all" || card.dataset.category === state.category) &&
          terms.every((t) => card.dataset.search.includes(t));
        card.hidden = !match;
        sectionHasMatch ||= match;
      }

      section.hidden = !sectionHasMatch;
      anyVisible ||= sectionHasMatch;
    }

    // Only offer categories that exist in the selected kitchen.
    for (const chip of chips) {
      chip.hidden = chip.dataset.category !== "all" && !categoriesInView.has(chip.dataset.category);
    }
    if (state.category !== "all" && !categoriesInView.has(state.category)) {
      state.category = "all";
      return apply();
    }

    setPressed(tabs, "author", state.author);
    setPressed(chips, "category", state.category);
    emptyState.hidden = anyVisible;
    showToolbar();
  }

  // Mobile: tuck the toolbar away while scrolling down, bring it back on scroll up.
  const toolbar = document.querySelector(".toolbar");
  const mobile = matchMedia("(max-width: 799px)"); // keep in sync with main.css
  const header = document.querySelector(".site-header");
  let lastY = null;
  let ticking = false;

  function showToolbar() {
    toolbar.classList.remove("is-hidden");
    lastY = null; // ignore any jump (e.g. scrolling to a kitchen) caused by this change
  }

  function onScroll() {
    ticking = false;
    const y = window.scrollY;
    // The toolbar is the first thing in its .wrap, so that's where it sits before it sticks.
    const stuckAt = toolbar.parentElement.getBoundingClientRect().top + y - header.offsetHeight;

    if (!mobile.matches || y <= stuckAt || document.activeElement === search) {
      toolbar.classList.remove("is-hidden");
      lastY = y;
      return;
    }
    if (lastY === null) {
      lastY = y;
      return;
    }
    const delta = y - lastY;
    if (Math.abs(delta) < 8) return;
    toolbar.classList.toggle("is-hidden", delta > 0);
    lastY = y;
  }

  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(onScroll);
      }
    },
    { passive: true }
  );
  mobile.addEventListener("change", showToolbar);
  search.addEventListener("focus", showToolbar);

  tabs.forEach((tab) =>
    tab.addEventListener("click", () => {
      state.author = tab.dataset.author;
      history.replaceState(null, "", state.author === "all" ? location.pathname : `#${state.author}`);
      apply();
    })
  );

  chips.forEach((chip) =>
    chip.addEventListener("click", () => {
      state.category = chip.dataset.category;
      apply();
    })
  );

  search.addEventListener("input", () => {
    state.query = search.value;
    apply();
  });

  document.getElementById("clear-filters").addEventListener("click", () => {
    Object.assign(state, { author: "all", category: "all", query: "" });
    search.value = "";
    history.replaceState(null, "", location.pathname);
    apply();
  });

  window.addEventListener("hashchange", () => {
    state.author = authorFromHash();
    apply();
  });

  state.author = authorFromHash();
  apply();
})();
