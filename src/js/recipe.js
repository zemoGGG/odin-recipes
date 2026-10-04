// Recipe page: print button, and tap a step to mark it done.
(() => {
  const print = document.querySelector(".print-button");
  if (print) {
    print.hidden = false;
    print.addEventListener("click", () => window.print());
  }

  document.querySelectorAll(".steps li").forEach((step) => {
    step.addEventListener("click", () => step.classList.toggle("done"));
  });
})();
