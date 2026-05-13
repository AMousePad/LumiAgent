export interface PhonelineConsentInput {
  readonly identifier: string;
  readonly displayName: string;
  readonly version?: string;
  readonly kind?: "initial" | "revalidate";
}

export interface PhonelineConsentResult {
  readonly allowed: boolean;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function showPhonelineConsent(input: PhonelineConsentInput): Promise<PhonelineConsentResult> {
  return new Promise<PhonelineConsentResult>((resolve) => {
    const overlay = el("div", "la-modal-overlay la-phoneline-overlay");
    const modal = el("div", "la-modal la-phoneline-modal");
    overlay.appendChild(modal);

    const isRevalidate = input.kind === "revalidate";
    const header = el("div", "la-phoneline-header");
    header.appendChild(el("div", "la-phoneline-title",
      isRevalidate ? `Revalidate "${input.displayName}"?` : `Connect to "${input.displayName}"?`));
    modal.appendChild(header);

    const body = el("div", "la-phoneline-body");

    const meta = el("div", "la-phoneline-meta");
    const addRow = (label: string, value: string): void => {
      const row = el("div", "la-phoneline-meta-row");
      row.appendChild(el("div", "la-phoneline-meta-label", label));
      row.appendChild(el("div", "la-phoneline-meta-value", value));
      meta.appendChild(row);
    };
    addRow("Display name:", input.displayName);
    addRow("Namespace:", input.identifier);
    if (input.version) addRow("Version:", input.version);
    body.appendChild(meta);

    body.appendChild(el("div", "la-phoneline-notice",
      isRevalidate
        ? `Tool descriptions changed on extension update. Revalidate "${input.displayName}"?`
        : `This will allow LumiAgent and "${input.displayName}" to communicate freely.`));
    const quote = el("label", "la-phoneline-quote");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "la-phoneline-cb";
    quote.appendChild(cb);
    quote.appendChild(el("span", "la-phoneline-quote-text",
      "These two extensions inherit each other's permissions. Allow?"));
    body.appendChild(quote);
    body.appendChild(el("div", "la-phoneline-foot", "You can access this in the LumiAgent settings."));
    modal.appendChild(body);

    const actions = el("div", "la-phoneline-actions");
    const denyBtn = el("button", "la-btn la-btn-secondary", "Deny") as HTMLButtonElement;
    const allowBtn = el("button", "la-btn la-btn-primary", "Allow") as HTMLButtonElement;
    allowBtn.disabled = true;
    actions.appendChild(denyBtn);
    actions.appendChild(allowBtn);
    modal.appendChild(actions);

    cb.addEventListener("change", () => { allowBtn.disabled = !cb.checked; });

    let resolved = false;
    const settle = (r: PhonelineConsentResult): void => {
      if (resolved) return;
      resolved = true;
      overlay.remove();
      resolve(r);
    };

    denyBtn.addEventListener("click", () => settle({ allowed: false }));
    allowBtn.addEventListener("click", () => { if (cb.checked) settle({ allowed: true }); });

    document.body.appendChild(overlay);
  });
}
