// Modal that renders ask_user_question payloads from the agent. Returns a
// Promise that resolves with either { cancelled: true } or
// { cancelled: false, answers, notes }. Escape and the Cancel button both
// resolve cancelled:true. Multi-select returns comma-joined labels per
// question to match Claude Code's shape, so the model never branches on type.

interface AskOption {
  readonly label: string;
  readonly description: string;
  readonly preview?: string;
}

interface AskQuestion {
  readonly question: string;
  readonly header: string;
  readonly options: readonly AskOption[];
  readonly multiSelect?: boolean;
}

export interface AskUserInput {
  readonly questions: readonly AskQuestion[];
}

export interface AskUserResult {
  readonly cancelled: boolean;
  readonly answers?: Record<string, string>;
  readonly notes?: Record<string, string>;
}

const OTHER_LABEL = "Other";

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function showAskUserQuestion(input: AskUserInput): Promise<AskUserResult> {
  return new Promise<AskUserResult>((resolve) => {
    const overlay = el("div", "la-modal-overlay la-ask-overlay");
    const modal = el("div", "la-modal la-ask-modal");
    overlay.appendChild(modal);

    // Selection state per question. For single-select: stores a string. For
    // multi-select: stores a Set<string>. "Other" free-text stored alongside
    // in otherText[question].
    const selections = new Map<string, string | Set<string>>();
    const otherText = new Map<string, string>();
    const previewBoxes = new Map<string, HTMLElement>();

    const header = el("div", "la-ask-header");
    header.appendChild(el("div", "la-ask-title", "Pick an option"));
    const subtitle = el("div", "la-ask-subtitle", `The agent paused with ${input.questions.length} question${input.questions.length === 1 ? "" : "s"}.`);
    header.appendChild(subtitle);
    modal.appendChild(header);

    const body = el("div", "la-ask-body");
    modal.appendChild(body);

    for (const q of input.questions) {
      const card = el("div", "la-ask-question");
      const head = el("div", "la-ask-question-head");
      head.appendChild(el("span", "la-ask-chip", q.header));
      head.appendChild(el("span", "la-ask-question-text", q.question));
      if (q.multiSelect) head.appendChild(el("span", "la-ask-multi-badge", "multi-select"));
      card.appendChild(head);

      const optionsWrap = el("div", "la-ask-options" + (q.multiSelect ? " is-multi" : ""));
      const allOptions: AskOption[] = [
        ...q.options,
        { label: OTHER_LABEL, description: "Type a custom answer.", preview: "" },
      ];

      // Track radio inputs so we can sync UI when one is checked. Multi-select
      // uses checkboxes (independent state).
      const inputs: HTMLInputElement[] = [];
      const otherInput = el("textarea") as HTMLTextAreaElement;
      otherInput.className = "la-ask-other-input";
      otherInput.placeholder = "Type a custom answer...";
      otherInput.rows = 2;
      otherInput.style.display = "none";
      otherInput.addEventListener("input", () => {
        otherText.set(q.question, otherInput.value);
      });

      for (let i = 0; i < allOptions.length; i++) {
        const opt = allOptions[i]!;
        const row = el("label", "la-ask-option");
        const inputEl = document.createElement("input");
        inputEl.type = q.multiSelect ? "checkbox" : "radio";
        inputEl.name = `q-${input.questions.indexOf(q)}`;
        inputEl.value = opt.label;
        row.appendChild(inputEl);
        inputs.push(inputEl);

        const text = el("div", "la-ask-option-text");
        text.appendChild(el("div", "la-ask-option-label", opt.label));
        if (opt.description) text.appendChild(el("div", "la-ask-option-desc", opt.description));
        row.appendChild(text);

        inputEl.addEventListener("change", () => {
          if (q.multiSelect) {
            const set = (selections.get(q.question) as Set<string> | undefined) ?? new Set<string>();
            if (inputEl.checked) set.add(opt.label);
            else set.delete(opt.label);
            selections.set(q.question, set);
            // Show "Other" free-text input only when Other is checked.
            if (opt.label === OTHER_LABEL) otherInput.style.display = inputEl.checked ? "" : "none";
          } else {
            selections.set(q.question, opt.label);
            otherInput.style.display = opt.label === OTHER_LABEL ? "" : "none";
          }
          // Update preview pane to the focused option's preview content.
          const previewBox = previewBoxes.get(q.question);
          if (previewBox) {
            previewBox.textContent = opt.preview ?? "";
            previewBox.style.display = opt.preview ? "" : "none";
          }
        });
        row.addEventListener("mouseenter", () => {
          // Hover preview: non-binding visual update only.
          const previewBox = previewBoxes.get(q.question);
          if (!previewBox) return;
          if (opt.preview) {
            previewBox.textContent = opt.preview;
            previewBox.style.display = "";
          }
        });
        optionsWrap.appendChild(row);
      }
      card.appendChild(optionsWrap);
      card.appendChild(otherInput);

      // Preview pane (lives below options if any option supplied preview text).
      const hasPreview = q.options.some((o) => o.preview && o.preview.length > 0);
      if (hasPreview) {
        const previewBox = el("pre", "la-ask-preview");
        previewBox.style.display = "none";
        previewBoxes.set(q.question, previewBox);
        card.appendChild(previewBox);
      }

      body.appendChild(card);
    }

    const footer = el("div", "la-ask-footer");
    const cancelBtn = el("button", "la-btn la-btn-ghost", "Cancel") as HTMLButtonElement;
    const submitBtn = el("button", "la-btn la-btn-primary", "Submit") as HTMLButtonElement;
    cancelBtn.type = "button";
    submitBtn.type = "button";
    footer.append(cancelBtn, submitBtn);
    modal.appendChild(footer);

    const finish = (result: AskUserResult): void => {
      window.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(result);
    };

    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish({ cancelled: true });
      }
    };
    window.addEventListener("keydown", onKey);

    cancelBtn.addEventListener("click", () => finish({ cancelled: true }));
    submitBtn.addEventListener("click", () => {
      const answers: Record<string, string> = {};
      const notes: Record<string, string> = {};
      for (const q of input.questions) {
        const raw = selections.get(q.question);
        if (raw === undefined || (raw instanceof Set && raw.size === 0)) {
          // Treat missing answer as cancellation rather than submitting partials.
          finish({ cancelled: true });
          return;
        }
        let answer: string;
        if (raw instanceof Set) {
          // Multi-select: comma-join the labels, "Other" replaced by user text.
          const parts: string[] = [];
          for (const label of raw) {
            if (label === OTHER_LABEL) {
              const txt = (otherText.get(q.question) ?? "").trim();
              if (txt) parts.push(txt);
            } else {
              parts.push(label);
            }
          }
          if (parts.length === 0) { finish({ cancelled: true }); return; }
          answer = parts.join(", ");
        } else if (raw === OTHER_LABEL) {
          const txt = (otherText.get(q.question) ?? "").trim();
          if (!txt) { finish({ cancelled: true }); return; }
          answer = txt;
          notes[q.question] = "custom answer";
        } else {
          answer = raw;
        }
        answers[q.question] = answer;
      }
      finish({ cancelled: false, answers, notes });
    });

    // Close on overlay click (matches existing modal behavior in the drawer).
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) finish({ cancelled: true });
    });

    document.body.appendChild(overlay);
  });
}
