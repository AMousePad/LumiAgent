export function organizeSettings(root: HTMLElement): void {
  let section: HTMLElement | null = null;
  for (const child of [...root.children]) {
    if (child.matches(".la-settings-divider")) { child.remove(); continue; }
    const heading = child.matches(".la-settings-label") ? child : child.querySelector(".la-settings-label");
    if (heading) {
      section = document.createElement("section"); section.className = "la-settings-section";
      const title = document.createElement("h3"); title.textContent = heading.textContent;
      section.append(title); child.replaceWith(section);
      continue;
    }
    if (child.matches(".la-composer-status")) continue;
    section?.append(child);
  }
  for (const input of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select")) {
    if (input.getAttribute("aria-label") || input.closest("label")) continue;
    const label = input.closest(".la-settings-row,.la-sampler-row")?.querySelector("label,.la-sampler-label")?.textContent ?? input.closest(".la-settings-section")?.querySelector("h3")?.textContent;
    if (label) input.setAttribute("aria-label", label);
  }
}
