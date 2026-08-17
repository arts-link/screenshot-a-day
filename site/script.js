/* global document, navigator, window */

const button = document.querySelector("[data-copy]");
const command = document.querySelector("[data-command]");

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

button?.addEventListener("click", async () => {
  if (!command) return;

  try {
    await copyText(command.textContent.trim());
    button.textContent = "Copied ✓";
  } catch {
    button.textContent = "Select + copy";
  }

  window.setTimeout(() => {
    button.textContent = "Copy";
  }, 3500);
});
