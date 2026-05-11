export interface ComboItem {
  readonly id: string;
  readonly label: string;
  readonly sublabel?: string;
}

export interface ComboHandle {
  setItems(items: readonly ComboItem[]): void;
  setValue(id: string | null, silent?: boolean): void;
  getValue(): string | null;
  onChange(handler: (id: string | null) => void): () => void;
  setPlaceholder(text: string): void;
  setDisabled(disabled: boolean): void;
  destroy(): void;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fuzzyScore(needle: string, hay: string): number {
  if (needle.length === 0) return 1;
  const n = needle.toLowerCase();
  const h = hay.toLowerCase();
  if (h.startsWith(n)) return 100;
  if (h.includes(n)) return 50;
  // Sequence match.
  let hi = 0;
  for (let ni = 0; ni < n.length; ni++) {
    const idx = h.indexOf(n[ni]!, hi);
    if (idx < 0) return 0;
    hi = idx + 1;
  }
  return 10;
}

export function mountCombo(root: HTMLElement): ComboHandle {
  root.classList.add("la-combo");
  let items: readonly ComboItem[] = [];
  let value: string | null = null;
  let placeholder = "—";
  let disabled = false;
  let isOpen = false;
  let activeIndex = -1;
  let listeners: Array<(id: string | null) => void> = [];

  const trigger = el("button", "la-combo-trigger") as HTMLButtonElement;
  trigger.type = "button";
  const triggerLabel = el("span", "la-combo-trigger-label", placeholder);
  const caret = el("span", "la-combo-caret", "▾");
  trigger.append(triggerLabel, caret);

  const pop = el("div", "la-combo-pop");
  pop.style.display = "none";
  const search = document.createElement("input");
  search.className = "la-combo-search";
  search.type = "text";
  search.placeholder = "Search...";
  const list = el("div", "la-combo-list");
  pop.append(search, list);

  root.append(trigger, pop);

  let filtered: ComboItem[] = [];

  const renderList = (): void => {
    const q = search.value.trim();
    if (q.length === 0) {
      filtered = [...items];
    } else {
      filtered = items
        .map((it) => ({ it, score: Math.max(fuzzyScore(q, it.label), it.sublabel ? fuzzyScore(q, it.sublabel) / 2 : 0) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.it);
    }
    list.innerHTML = "";
    if (filtered.length === 0) {
      list.appendChild(el("div", "la-combo-empty", q ? "No matches" : "No items"));
      activeIndex = -1;
      return;
    }
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i]!;
      const row = el("button", `la-combo-item ${item.id === value ? "is-selected" : ""} ${i === activeIndex ? "is-active" : ""}`) as HTMLButtonElement;
      row.type = "button";
      row.dataset["id"] = item.id;
      const label = el("div", "la-combo-item-label", item.label);
      row.appendChild(label);
      if (item.sublabel) {
        const sub = el("div", "la-combo-item-sub", item.sublabel);
        row.appendChild(sub);
      }
      row.addEventListener("mousedown", (ev) => { ev.preventDefault(); select(item.id); });
      row.addEventListener("mouseenter", () => { activeIndex = i; updateActive(); });
      list.appendChild(row);
    }
  };

  const updateActive = (): void => {
    for (let i = 0; i < list.children.length; i++) {
      const child = list.children[i] as HTMLElement;
      child.classList.toggle("is-active", i === activeIndex);
    }
    const activeEl = list.children[activeIndex] as HTMLElement | undefined;
    if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
  };

  const updateTrigger = (): void => {
    const item = value ? items.find((it) => it.id === value) : null;
    triggerLabel.textContent = item ? item.label : placeholder;
    trigger.classList.toggle("is-placeholder", !item);
  };

  const open = (): void => {
    if (disabled || isOpen) return;
    isOpen = true;
    pop.style.display = "";
    root.classList.add("is-open");
    search.value = "";
    activeIndex = Math.max(0, filtered.findIndex((it) => it.id === value));
    renderList();
    queueMicrotask(() => search.focus());
  };

  const close = (): void => {
    if (!isOpen) return;
    isOpen = false;
    pop.style.display = "none";
    root.classList.remove("is-open");
  };

  const select = (id: string | null): void => {
    value = id;
    updateTrigger();
    close();
    for (const fn of listeners) fn(value);
  };

  trigger.addEventListener("click", () => { isOpen ? close() : open(); });
  search.addEventListener("input", () => { activeIndex = filtered.length > 0 ? 0 : -1; renderList(); });
  search.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); if (filtered.length > 0) { activeIndex = Math.min(filtered.length - 1, activeIndex + 1); updateActive(); } }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); if (filtered.length > 0) { activeIndex = Math.max(0, activeIndex - 1); updateActive(); } }
    else if (ev.key === "Enter") { ev.preventDefault(); if (activeIndex >= 0 && filtered[activeIndex]) select(filtered[activeIndex]!.id); }
    else if (ev.key === "Escape") { ev.preventDefault(); close(); trigger.focus(); }
  });

  const onDocClick = (ev: MouseEvent): void => {
    if (!isOpen) return;
    if (!root.contains(ev.target as Node)) close();
  };
  document.addEventListener("mousedown", onDocClick);

  updateTrigger();

  return {
    setItems(next) { items = [...next]; if (isOpen) renderList(); updateTrigger(); },
    setValue(id, silent) {
      const next = id && items.some((it) => it.id === id) ? id : null;
      if (next === value) return;
      value = next;
      updateTrigger();
      if (!silent) for (const fn of listeners) fn(value);
    },
    getValue() { return value; },
    onChange(handler) { listeners.push(handler); return () => { listeners = listeners.filter((h) => h !== handler); }; },
    setPlaceholder(text) { placeholder = text; updateTrigger(); },
    setDisabled(d) { disabled = d; trigger.disabled = d; root.classList.toggle("is-disabled", d); if (d) close(); },
    destroy() {
      document.removeEventListener("mousedown", onDocClick);
      root.innerHTML = "";
      listeners = [];
    },
  };
}
