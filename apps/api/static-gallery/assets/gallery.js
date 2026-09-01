/* global document, sessionStorage */
const dialog = document.querySelector("#lightbox");
document.querySelectorAll("[data-lightbox]").forEach((button) =>
  button.addEventListener("click", () => {
    if (!dialog) return;
    dialog.querySelector("img").src = button.dataset.lightbox;
    dialog.querySelector("p").textContent = button.dataset.caption;
    dialog.showModal();
  }),
);
dialog?.querySelector("[data-close]")?.addEventListener("click", () => dialog.close());

const workspace = document.querySelector("[data-comparison-workspace]");
if (workspace) {
  const storageKey = `sad:comparison:${workspace.dataset.comparisonScope}`;
  let storage;
  try {
    sessionStorage.setItem(`${storageKey}:probe`, "1");
    sessionStorage.removeItem(`${storageKey}:probe`);
    storage = sessionStorage;
  } catch {
    storage = null;
  }

  const validCapture = (value) =>
    value &&
    typeof value.id === "string" &&
    typeof value.image === "string" &&
    typeof value.date === "string"
      ? value
      : null;
  let selection = { earlier: null, later: null, active: "earlier" };
  if (storage) {
    try {
      const stored = JSON.parse(storage.getItem(storageKey) || "null");
      if (stored) {
        selection.earlier = validCapture(stored.earlier);
        selection.later = validCapture(stored.later);
        selection.active =
          selection.earlier && selection.later ? null : selection.earlier ? "later" : "earlier";
      }
    } catch {
      storage.removeItem(storageKey);
    }
  }

  const sideBySide = workspace.querySelector("[data-side-by-side-result]");
  const split = workspace.querySelector("[data-split-result]");
  const empty = workspace.querySelector("[data-comparison-empty]");
  const modeButtons = workspace.querySelectorAll("[data-comparison-mode]");
  let comparisonMode = "side-by-side";
  const persist = () => {
    if (!storage) return;
    try {
      storage.setItem(
        storageKey,
        JSON.stringify({ earlier: selection.earlier, later: selection.later }),
      );
    } catch {
      storage = null;
    }
  };
  const normalize = () => {
    if (!selection.earlier || !selection.later) return;
    if (Date.parse(selection.earlier.date) > Date.parse(selection.later.date)) {
      [selection.earlier, selection.later] = [selection.later, selection.earlier];
    }
    selection.active = null;
  };
  const render = () => {
    ["earlier", "later"].forEach((slot) => {
      const node = workspace.querySelector(`[data-slot="${slot}"]`);
      const capture = selection[slot];
      node.classList.toggle("active", selection.active === slot);
      node.classList.toggle("filled", Boolean(capture));
      node.querySelector("[data-slot-value]").textContent = capture
        ? new Date(capture.date).toLocaleString()
        : `Choose the ${slot} frame`;
      node.querySelector(`[data-slot-change="${slot}"]`).hidden = !capture;
      node.querySelector(`[data-slot-remove="${slot}"]`).hidden = !capture;
    });
    document.querySelectorAll("[data-capture-card]").forEach((card) => {
      const id = card.dataset.captureId;
      const role =
        selection.earlier?.id === id ? "earlier" : selection.later?.id === id ? "later" : null;
      card.classList.toggle("selected-earlier", role === "earlier");
      card.classList.toggle("selected-later", role === "later");
      const button = card.querySelector("[data-compare-id]");
      button.textContent = role || "Select to compare";
      button.disabled = !role && !selection.active;
    });
    const complete = Boolean(selection.earlier && selection.later);
    sideBySide.hidden = !complete || comparisonMode !== "side-by-side";
    split.hidden = !complete || comparisonMode !== "split";
    empty.hidden = Boolean(complete);
    if (complete) {
      sideBySide.querySelector("[data-side-before]").src = selection.earlier.image;
      sideBySide.querySelector("[data-side-after]").src = selection.later.image;
      sideBySide.querySelector("[data-side-before-date]").textContent = new Date(
        selection.earlier.date,
      ).toLocaleString();
      sideBySide.querySelector("[data-side-after-date]").textContent = new Date(
        selection.later.date,
      ).toLocaleString();
      split.querySelector("[data-before]").src = selection.earlier.image;
      split.querySelector("[data-after]").src = selection.later.image;
    }
    modeButtons.forEach((button) => {
      const active = button.dataset.comparisonMode === comparisonMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    persist();
  };

  document.querySelectorAll("[data-compare-id]").forEach((button) =>
    button.addEventListener("click", () => {
      const role =
        selection.earlier?.id === button.dataset.compareId
          ? "earlier"
          : selection.later?.id === button.dataset.compareId
            ? "later"
            : null;
      if (role) {
        selection[role] = null;
        selection.active = role;
      } else if (selection.active) {
        selection[selection.active] = {
          id: button.dataset.compareId,
          image: button.dataset.compareImage,
          date: button.dataset.compareDate,
        };
        selection.active = selection.earlier ? "later" : "earlier";
        normalize();
      }
      render();
    }),
  );
  workspace.querySelectorAll("[data-slot-change]").forEach((button) =>
    button.addEventListener("click", () => {
      selection.active = button.dataset.slotChange;
      render();
    }),
  );
  workspace.querySelectorAll("[data-slot-remove]").forEach((button) =>
    button.addEventListener("click", () => {
      const slot = button.dataset.slotRemove;
      selection[slot] = null;
      selection.active = slot;
      render();
    }),
  );
  modeButtons.forEach((button) =>
    button.addEventListener("click", () => {
      comparisonMode = button.dataset.comparisonMode;
      render();
    }),
  );
  split?.querySelector("input[type=range]")?.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    split.querySelector("[data-split-later]").style.clipPath = `inset(0 ${100 - value}% 0 0)`;
    split.querySelector("[data-split-divider]").style.left = `${value}%`;
    split.querySelector("output").textContent = `${value}% later`;
  });
  render();
}
