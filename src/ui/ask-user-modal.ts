// Modal that renders ask_user_question payloads from the agent. Resolves with
// { cancelled: true } or { cancelled: false, answers, notes }. Only the Cancel
// button cancels: Escape, outside clicks and the Minimize button hide the
// modal behind a pill so a half-typed answer is never lost by accident.

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
  // Free text the user had typed when the modal went away without a submit.
  readonly draft?: string;
}

export interface AskUserOptions {
  // Backend-side cancellation (timeout, run stopped). The modal closes and
  // resolves cancelled with any draft text.
  readonly signal?: AbortSignal;
  // Called on user activity so the caller can keep the backend timeout alive.
  readonly onActivity?: () => void;
}

const OTHER_LABEL = "Other";
const OTHER_MAX_ROWS = 14;

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function autoGrow(area: HTMLTextAreaElement): void {
  const lines = area.value.split("\n").length;
  area.rows = Math.max(2, Math.min(OTHER_MAX_ROWS, lines + 1));
}

export function showAskUserQuestion(input: AskUserInput, opts: AskUserOptions = {}): Promise<AskUserResult> {
  return new Promise<AskUserResult>((resolve) => {
    const overlay = el("div", "la-modal-overlay la-ask-overlay");
    const modal = el("div", "la-modal la-ask-modal");
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-label", "Your input");
    overlay.appendChild(modal);

    const selections = new Map<string, string | Set<string>>();
    const otherText = new Map<string, string>();
    const previewBoxes = new Map<string, HTMLElement>();
    const otherInputs: HTMLTextAreaElement[] = [];

    const header = el("div", "la-ask-header");
    const titleRow = el("div", "la-ask-title-row");
    titleRow.appendChild(el("div", "la-ask-title", input.questions.length > 1 ? `Mousey has ${input.questions.length} questions` : "Mousey has a question"));
    const minimizeBtn = el("button", "la-btn la-btn-ghost la-ask-minimize", "Minimize") as HTMLButtonElement;
    minimizeBtn.type = "button";
    minimizeBtn.title = "Hide this for now. Your choices and typed text are kept.";
    titleRow.appendChild(minimizeBtn);
    header.appendChild(titleRow);
    header.appendChild(el("div", "la-ask-subtitle", "The assistant is waiting for your answer. Minimize to keep working; Cancel sends no answer."));
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

      const otherInput = el("textarea") as HTMLTextAreaElement;
      otherInput.className = "la-ask-other-input";
      otherInput.placeholder = "Type a custom answer...";
      otherInput.rows = 2;
      otherInput.style.display = "none";
      otherInput.addEventListener("input", () => {
        otherText.set(q.question, otherInput.value);
        autoGrow(otherInput);
        opts.onActivity?.();
      });
      otherInputs.push(otherInput);

      for (let i = 0; i < allOptions.length; i++) {
        const opt = allOptions[i]!;
        const row = el("label", "la-ask-option");
        const inputEl = document.createElement("input");
        inputEl.type = q.multiSelect ? "checkbox" : "radio";
        inputEl.name = `q-${input.questions.indexOf(q)}`;
        inputEl.value = opt.label;
        row.appendChild(inputEl);

        const text = el("div", "la-ask-option-text");
        text.appendChild(el("div", "la-ask-option-label", opt.label));
        if (opt.description) text.appendChild(el("div", "la-ask-option-desc", opt.description));
        row.appendChild(text);

        inputEl.addEventListener("change", () => {
          opts.onActivity?.();
          if (q.multiSelect) {
            const set = (selections.get(q.question) as Set<string> | undefined) ?? new Set<string>();
            if (inputEl.checked) set.add(opt.label);
            else set.delete(opt.label);
            selections.set(q.question, set);
            if (opt.label === OTHER_LABEL) otherInput.style.display = inputEl.checked ? "" : "none";
          } else {
            selections.set(q.question, opt.label);
            otherInput.style.display = opt.label === OTHER_LABEL ? "" : "none";
          }
          if (opt.label === OTHER_LABEL && inputEl.checked) otherInput.focus();
          const previewBox = previewBoxes.get(q.question);
          if (previewBox) {
            previewBox.textContent = opt.preview ?? "";
            previewBox.style.display = opt.preview ? "" : "none";
          }
        });
        row.addEventListener("mouseenter", () => {
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
    cancelBtn.title = "Dismiss without answering. The assistant will pick a default.";
    submitBtn.type = "button";
    footer.append(cancelBtn, submitBtn);
    const error = el("div", "la-form-error"); error.setAttribute("role", "alert"); modal.append(error);
    modal.appendChild(footer);

    // Minimized state: a fixed pill that restores the overlay. The promise and
    // every input stay alive underneath.
    const pill = el("button", "la-ask-pill") as HTMLButtonElement;
    pill.type = "button";
    pill.textContent = input.questions.length > 1 ? "Answer Mousey's questions" : "Answer Mousey's question";
    pill.title = "Reopen the question";
    pill.style.display = "none";
    let minimized = false;
    const setMinimized = (v: boolean): void => {
      minimized = v;
      overlay.style.display = v ? "none" : "";
      pill.style.display = v ? "" : "none";
      if (!v) (modal.querySelector<HTMLElement>("textarea:not([style*='display: none']),input,button"))?.focus();
    };
    pill.addEventListener("click", () => { opts.onActivity?.(); setMinimized(false); });
    minimizeBtn.addEventListener("click", () => setMinimized(true));

    const currentDraft = (): string => {
      const parts: string[] = [];
      for (const [question, txt] of otherText) if (txt.trim().length > 0) parts.push(input.questions.length > 1 ? `${question}\n${txt.trim()}` : txt.trim());
      return parts.join("\n\n");
    };

    const finish = (result: AskUserResult): void => {
      window.removeEventListener("keydown", onKey);
      opts.signal?.removeEventListener("abort", onAbort);
      overlay.remove();
      pill.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(result);
    };

    const onAbort = (): void => {
      const draft = currentDraft();
      finish(draft.length > 0 ? { cancelled: true, draft } : { cancelled: true });
    };
    if (opts.signal?.aborted) { onAbort(); return; }
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const onKey = (ev: KeyboardEvent): void => {
      if (minimized) return;
      opts.onActivity?.();
      if (ev.key === "Tab") {
        const controls = [...modal.querySelectorAll<HTMLElement>("button,input,textarea,select,[tabindex='0']")].filter(item => !item.hasAttribute("disabled") && item.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1);
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last?.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first?.focus(); }
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        setMinimized(true);
      }
    };
    window.addEventListener("keydown", onKey);

    cancelBtn.addEventListener("click", () => {
      const draft = currentDraft();
      finish(draft.length > 0 ? { cancelled: true, draft } : { cancelled: true });
    });
    submitBtn.addEventListener("click", () => {
      const answers: Record<string, string> = {};
      const notes: Record<string, string> = {};
      for (const q of input.questions) {
        const raw = selections.get(q.question);
        if (raw === undefined || (raw instanceof Set && raw.size === 0)) {
          error.textContent = "Choose an option for each question.";
          modal.querySelector<HTMLInputElement>(`input[name="q-${input.questions.indexOf(q)}"]`)?.focus();
          return;
        }
        let answer: string;
        if (raw instanceof Set) {
          const parts: string[] = [];
          for (const label of raw) {
            if (label === OTHER_LABEL) {
              const txt = (otherText.get(q.question) ?? "").trim();
              if (txt) parts.push(txt);
            } else {
              parts.push(label);
            }
          }
          if (parts.length === 0) { error.textContent = "Enter your answer."; return; }
          answer = parts.join(", ");
        } else if (raw === OTHER_LABEL) {
          const txt = (otherText.get(q.question) ?? "").trim();
          if (!txt) { error.textContent = "Enter your answer."; return; }
          answer = txt;
          notes[q.question] = "custom answer";
        } else {
          answer = raw;
        }
        answers[q.question] = answer;
      }
      finish({ cancelled: false, answers, notes });
    });

    // Outside click minimizes instead of cancelling: cancelling by accident
    // threw away typed answers.
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) setMinimized(true);
    });
    overlay.addEventListener("pointerdown", () => opts.onActivity?.());

    document.body.appendChild(overlay);
    document.body.appendChild(pill);
    modal.querySelector<HTMLElement>("input,button")?.focus();
  });
}
