document.querySelectorAll("[data-view-target]").forEach((control) => {
  control.addEventListener("click", () => {
    const view = control.dataset.viewTarget;
    document.querySelectorAll("[data-view]").forEach((panel) => {
      panel.hidden = panel.dataset.view !== view;
    });
    document.querySelectorAll("[data-view-target]").forEach((button) => {
      button.classList.toggle("active", button.dataset.viewTarget === view);
      button.setAttribute("aria-current", button.dataset.viewTarget === view ? "page" : "false");
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

document.querySelectorAll("[data-dialog-open]").forEach((control) => {
  control.addEventListener("click", () => {
    const dialog = document.getElementById(control.dataset.dialogOpen);
    if (dialog instanceof HTMLDialogElement) dialog.showModal();
  });
});

document.querySelectorAll("[data-dialog-close]").forEach((control) => {
  control.addEventListener("click", () => {
    const dialog = control.closest("dialog");
    if (dialog instanceof HTMLDialogElement) dialog.close();
  });
});
