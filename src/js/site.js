// Site-wide: the mobile hamburger menu in the header.
(() => {
  const header = document.querySelector(".site-header");
  if (!header) return;

  // Sticky bars below the header (e.g. the home toolbar) sit at --header-h. Keep it accurate
  // when the inline nav wraps onto extra lines in a narrow desktop window.
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`);
  }).observe(header);

  const toggle = header.querySelector(".nav-toggle");
  if (!toggle) return;
  const nav = document.getElementById(toggle.getAttribute("aria-controls"));
  // Keep in sync with the hamburger breakpoint in main.css.
  const mobile = matchMedia("(max-width: 719px) and (pointer: coarse)");

  function setOpen(open) {
    toggle.setAttribute("aria-expanded", String(open));
    header.classList.toggle("is-open", open);
  }

  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));

  // Same-page hash links (e.g. /#matty on the home page) don't reload, so close explicitly.
  nav.addEventListener("click", (e) => {
    if (e.target.closest("a")) setOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && header.classList.contains("is-open")) {
      setOpen(false);
      toggle.focus();
    }
  });

  document.addEventListener("click", (e) => {
    if (!header.contains(e.target)) setOpen(false);
  });

  mobile.addEventListener("change", (e) => {
    if (!e.matches) setOpen(false);
  });
})();
