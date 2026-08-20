/* global document */
const dialog = document.querySelector("#lightbox");
document.querySelectorAll("[data-lightbox]").forEach((button) =>
  button.addEventListener("click", () => {
    dialog.querySelector("img").src = button.dataset.lightbox;
    dialog.querySelector("p").textContent = button.dataset.caption;
    dialog.showModal();
  }),
);
dialog?.querySelector("[data-close]")?.addEventListener("click", () => dialog.close());
const choices = [];
const comparison = document.querySelector(".browser-compare");
document.querySelectorAll("[data-compare]").forEach((input) =>
  input.addEventListener("change", () => {
    if (input.checked) {
      choices.push(input);
      while (choices.length > 2) {
        choices.shift().checked = false;
      }
    } else {
      const i = choices.indexOf(input);
      if (i >= 0) choices.splice(i, 1);
    }
    if (choices.length === 2 && comparison) {
      comparison.hidden = false;
      comparison.querySelector("[data-before]").src = choices[0].dataset.compare;
      comparison.querySelector("[data-after]").src = choices[1].dataset.compare;
    } else if (comparison) comparison.hidden = true;
  }),
);
comparison?.querySelector("input[type=range]")?.addEventListener("input", (event) => {
  comparison.querySelector("span").style.width = `${event.target.value}%`;
});
