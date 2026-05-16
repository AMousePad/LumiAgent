import type { SpindleFrontendContext, SpindleModalHandle } from "lumiverse-spindle-types";
import type {
  BackendToFrontend,
  ChatAssistantMessage,
  ChatMessage,
  ChatSummary,
  ChatUserMessage,
  CharacterSummary,
  ConnectionSummary,
  CharacterStorageEntry,
  EditLogEntry,
  FrontendToBackend,
  RevertOutcomeWire,
  ScopeRef,
  SessionSummaryWire,
} from "../types";
import { characterScope, scopeKeyString } from "../types";
import { STYLES } from "./styles";
import {
  type AssistantHandle,
  buildEditIndex,
  createStreamingAssistant,
  renderMessage,
} from "./chat-thread";
import { ChatVirtualizer } from "./chat-virtualizer";
import { openDiffModal, type DiffModalHandle } from "./diff-modal";
import { mountWorkspacePanel, type WorkspacePanelHandle } from "./workspace-panel";
import { mountCombo, type ComboHandle } from "./combo";
import { handleAgentEvent, type AgentEventCtx } from "./agent-event-handler";
import { ICON_TRASH, ICON_DOWNLOAD, ICON_PIN, ICON_PIN_OFF, ICON_NEW, ICON_SESSIONS, ICON_SETTINGS, ICON_TICK, ICON_WORKSHOP, ICON_EXPAND, ICON_COLLAPSE } from "./icons";
import { DEFAULT_ICON_DATA_URL } from "../generated/default-icon";
import { MOUSEY_SITTING_DATA_URL } from "../generated/mousey";

// Combobox sentinel for the "(No character)" entry. The dropdown stores it as
// a string id; everywhere else (state.characterId, wire messages, persisted
// sessions) carries the null directly.
const NO_CHARACTER_SENTINEL = "__none__";
const ICON_STORAGE_KEY = "lumiagent.customIcon.v1";
const MOUSEY_STORAGE_KEY = "lumiagent.customMousey.v1";
const DISPLAY_NAME_STORAGE_KEY = "lumiagent.displayName.v1";
const DEFAULT_DISPLAY_NAME = "LumiAgent";
const DEFAULT_DISPLAY_SHORT = "Agent";

function resolveDrawerIconUrl(): string {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(ICON_STORAGE_KEY) : null;
    if (v && v.startsWith("data:image/")) return v;
  } catch { /* localStorage unavailable */ }
  return DEFAULT_ICON_DATA_URL;
}

function resolveMouseyImageUrl(): string {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(MOUSEY_STORAGE_KEY) : null;
    if (v && v.startsWith("data:image/")) return v;
  } catch { /* localStorage unavailable */ }
  return MOUSEY_SITTING_DATA_URL;
}

function resolveDisplayName(): { full: string; short: string } {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(DISPLAY_NAME_STORAGE_KEY) : null;
    if (v && v.trim().length > 0) {
      const trimmed = v.trim();
      return { full: trimmed, short: trimmed.length > 8 ? trimmed.slice(0, 8) : trimmed };
    }
  } catch { /* localStorage unavailable */ }
  return { full: DEFAULT_DISPLAY_NAME, short: DEFAULT_DISPLAY_SHORT };
}


interface UiState {
  characters: CharacterSummary[];
  connections: ConnectionSummary[];
  sessions: SessionSummaryWire[];
  sessionId: string | null;
  characterId: string | null;
  characterName: string | null;
  connectionId: string | null;
  messages: ChatMessage[];
  edits: EditLogEntry[];
  // Authoritative per-scope ledger snapshots, keyed by scopeKeyString. The
  // backend is the only writer of truth: every scope_edits_pushed replaces
  // one slot. The header badge and the workshop modal both read from here,
  // so there is no second cache to reconcile.
  scopeLedgers: Map<string, readonly EditLogEntry[]>;
  chatsForCharacter: ChatSummary[];
  pinnedChatId: string | null;
  settings: { persona: string; systemPromptOverride: string | null; defaultPersona: string; defaultSystemPromptBody?: string; samplers?: Readonly<Record<string, number | null>>; jailbreak?: string; jailbreakPlacement?: "system_suffix" | "user_suffix" | "assistant_prefill"; workspaceCapBytes?: number | null; workspaceCapDefaultBytes?: number; workspaceFileCapBytes?: number; toolOutputCapTokens?: number | null; toolOutputCapDefaultTokens?: number; cacheMode?: "off" | "system_only" | "full"; parallelToolCalls?: boolean } | null;
  pendingPinChatId: string | null;
  // Single-shot, reset after consume so a later list_chats won't re-pin after the user explicitly unpinned.
  autoPinNeeded: boolean;
  isGenerating: boolean;
  startingSession: boolean;
  compacting: boolean;
  contextPromptTokens: number;
  contextTokens: number;
  pendingMessage: string | null;
  pendingMessageId: string | null;
  startSessionTimeout: ReturnType<typeof setTimeout> | null;
  streamingAssistant: AssistantHandle | null;
  currentAssistantMessage: ChatAssistantMessage | null;
  diffModal: DiffModalHandle | null;
  workspacePanel: WorkspacePanelHandle | null;
  scopeStorage: readonly CharacterStorageEntry[];
  // View-only: which scope the workshop combo is focused on. Null = follow
  // the active session's scope. Never an authority for the header badge.
  workshopFocusScope: ScopeRef | null;
  // Whether the streaming bubble currently shows the cycling thinking
  // indicator. The indicator itself lives inside the bubble; this flag just
  // gates re-toggles so we don't churn DOM nodes on every event.
  loading: boolean;
  // Message id whose bubble currently hosts an inline edit textarea.
  // rerenderThread preserves that bubble while this is set.
  editingMessageId: string | null;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountDrawer(ctx: SpindleFrontendContext): () => void {
  const removeStyle = ctx.dom.addStyle(STYLES);
  // Namespaced diagnostic logger. Cheap enough to leave on; filterable via the
  // browser console's text filter ("[lumiagent]").
  const dlog = (...args: unknown[]): void => { console.log("[lumiagent]", ...args); };
  const displayName = resolveDisplayName();
  const tab = ctx.ui.registerDrawerTab({
    id: "lumiagent",
    title: displayName.full,
    shortName: displayName.short,
    description: "Agentic editor for character cards",
    keywords: ["agent", "edit", "translate", "lorebook", "regex"],
    iconUrl: resolveDrawerIconUrl(),
  });

  const root = tab.root;
  root.classList.add("la-drawer");

  const state: UiState = {
    characters: [],
    connections: [],
    sessions: [],
    sessionId: null,
    characterId: null,
    characterName: null,
    connectionId: null,
    messages: [],
    edits: [],
    scopeLedgers: new Map(),
    chatsForCharacter: [],
    pinnedChatId: null,
    settings: null,
    pendingPinChatId: null,
    autoPinNeeded: false,
    isGenerating: false,
    startingSession: false,
    compacting: false,
    contextPromptTokens: 0,
    contextTokens: 128_000,
    pendingMessage: null,
    pendingMessageId: null,
    startSessionTimeout: null,
    streamingAssistant: null,
    currentAssistantMessage: null,
    diffModal: null,
    workspacePanel: null,
    scopeStorage: [],
    workshopFocusScope: null,
    loading: false,
    editingMessageId: null,
  };

  const header = el("header", "la-header");

  const makeIconBtn = (cls: string, svg: string, label: string, hint: string): HTMLButtonElement => {
    const b = el("button", `la-btn la-icon-btn ${cls}`) as HTMLButtonElement;
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = hint;
    b.innerHTML = svg;
    return b;
  };

  const rowChar = el("div", "la-header-row la-header-row-char");
  const charComboRoot = el("div", "la-combo-host la-combo-host-char");
  charComboRoot.setAttribute("aria-label", "Character");
  const charCombo: ComboHandle = mountCombo(charComboRoot);
  charCombo.setPlaceholder("Pick character");
  const chatPinBtn = makeIconBtn("la-chat-pin-btn", ICON_PIN_OFF, "Pin a chat to share with the agent",
    "Pin a chat (gives the agent message-history access)");
  // Swap both the class (drives the active-tint CSS) and the icon SVG.
  const setChatPinned = (pinned: boolean): void => {
    chatPinBtn.classList.toggle("has-pinned", pinned);
    chatPinBtn.innerHTML = pinned ? ICON_PIN : ICON_PIN_OFF;
  };
  const switchSessionBtn = makeIconBtn("", ICON_SESSIONS, "Switch session", "Switch session");
  const newSessionBtn = makeIconBtn("", ICON_NEW, "Start a new chat session", "New session");
  const expandBtn = makeIconBtn("la-expand-btn", ICON_EXPAND, "Expand to fullscreen", "Expand to fullscreen");
  const settingsBtn = makeIconBtn("", ICON_SETTINGS, "Agent settings", "Agent settings (persona & prompt)");
  const menuBtn = el("button", "la-btn la-icon-btn") as HTMLButtonElement;
  menuBtn.setAttribute("aria-label", "More");
  menuBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
  const connComboRoot = el("div", "la-combo-host la-combo-host-conn");
  connComboRoot.setAttribute("aria-label", "Connection");
  const connCombo: ComboHandle = mountCombo(connComboRoot);
  connCombo.setPlaceholder("Default connection");
  rowChar.append(charComboRoot, chatPinBtn, switchSessionBtn, newSessionBtn);

  const rowMeta = el("div", "la-header-row la-header-row-meta");
  const editsBadge = makeIconBtn("la-changes-btn", ICON_WORKSHOP, "Open diff viewer", "Workshop");
  const editsCount = el("span", "la-changes-count", "0");
  editsBadge.appendChild(editsCount);
  rowMeta.append(connComboRoot, editsBadge, expandBtn, settingsBtn, menuBtn);

  let isExpanded = false;
  let originalParent: Node | null = null;
  let originalNextSibling: Node | null = null;
  const setExpanded = (next: boolean): void => {
    if (isExpanded === next) return;
    isExpanded = next;
    if (next) {
      originalParent = root.parentNode;
      originalNextSibling = root.nextSibling;
      document.body.appendChild(root);
    } else if (originalParent) {
      if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
        originalParent.insertBefore(root, originalNextSibling);
      } else {
        originalParent.appendChild(root);
      }
      originalParent = null;
      originalNextSibling = null;
    }
    root.classList.toggle("la-drawer-expanded", next);
    expandBtn.innerHTML = next ? ICON_COLLAPSE : ICON_EXPAND;
    expandBtn.title = next ? "Collapse to drawer" : "Expand to fullscreen";
    expandBtn.setAttribute("aria-label", expandBtn.title);
  };
  expandBtn.addEventListener("click", () => setExpanded(!isExpanded));
  // Esc collapses while focus is anywhere inside the drawer. Doesn't fight the
  // composer textarea because the composer doesn't capture Esc.
  root.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && isExpanded) {
      ev.preventDefault();
      setExpanded(false);
    }
  });

  header.append(rowChar, rowMeta);

  // Thread
  const thread = el("div", "la-thread");
  const emptyState = el("div", "la-empty");
  emptyState.append(
    Object.assign(el("h3"), { textContent: "What can I do?" }),
    Object.assign(el("p"), { textContent: "Pick a character and ask me to translate, refactor, audit, add lorebook entries, or anything else. Every edit shows as a diff you can review and revert. Here are some examples:" }),
  );

  const SUGGESTIONS: ReadonlyArray<{ label: string; send: string }> = [
    {
      label: "Translate this card",
      send: "Translate this card to English (or another target if I name one). Run `survey_cjk` first to see where the source-language content lives; plan from what it reports, not memory. Cover greetings (first_mes + alternate_greetings) and UI surfaces (regex replace_string, trigger displays/values, bg-html, scriptstate_defaults). Skip find_regex patterns, anything already bilingual, and internal identifiers. For greetings, `rewrite` the whole message and keep tags / markers / capture groups byte-identical. Summarise findings and ask which surfaces to touch before writing.",
    },
    {
      label: "Add/update a lorebook entry",
      send: "Help me add or update a lorebook entry for a character in this card. First ask which character and what to cover. Use `grep` / `list({path:'wb'})` to check for an existing entry; if one exists, summarise it and ask whether to update or replace. Apply via tool after I confirm, don't paste the entry's prose into chat.",
    },
    {
      label: "Explain this card",
      send: "Audit this card and explain it in plain English: what it's about (setting, premise, characters), what mechanics it runs (status panels, command syntax, regex outputs, time/weather/location systems, mode toggles, dice — name the actual fields), and how the user interacts with it. Skim metadata + world book + regex; if a chat is pinned, glance at a few recent messages for tone. Read-only, no edits.",
    },
    {
      label: "Change a character's gender",
      send: "Help me change the gender of one or more characters. First ask which character(s) and what new gender for each. Then `grep` for every reference: name, pronouns, honorifics, gendered nouns. Map out the surfaces that need to change and show me the plan as (surface, what changes) before applying. Pronouns, possessives, and gendered nouns all need to flip together.",
    },

  ];
  const suggestions = el("div", "la-empty-suggestions");
  for (const item of SUGGESTIONS) {
    const s = el("button", "la-empty-suggestion", item.label);
    s.title = item.send;
    s.addEventListener("click", () => {
      textarea.value = item.send;
      autosizeTextarea();
      doSend();
    });
    suggestions.appendChild(s);
  }
  emptyState.appendChild(suggestions);

  // Composer
  const composer = el("div", "la-composer");
  const mouseyImg = document.createElement("img");
  mouseyImg.className = "la-mousey";
  mouseyImg.src = resolveMouseyImageUrl();
  mouseyImg.alt = "";
  mouseyImg.setAttribute("aria-hidden", "true");
  composer.appendChild(mouseyImg);
  const composerInner = el("div", "la-composer-inner");
  const composerArea = el("div", "la-composer-area");
  const textarea = document.createElement("textarea");
  textarea.className = "la-textarea";
  textarea.rows = 1;
  textarea.placeholder = "Ask anything";
  const composerActions = el("div", "la-composer-actions");
  const sendBtn = el("button", "la-send-btn") as HTMLButtonElement;
  sendBtn.setAttribute("aria-label", "Send");
  sendBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
  const cancelBtn = el("button", "la-cancel-btn") as HTMLButtonElement;
  cancelBtn.setAttribute("aria-label", "Stop");
  cancelBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';
  cancelBtn.style.display = "none";

  // Compaction indicator: a small circular ring whose fill grows with prompt-
  // token usage. Click (when idle) to compact early; the runtime auto-compacts
  // when usage crosses ~84% of the configured context size.
  const compactBtn = el("button", "la-compact-btn") as HTMLButtonElement;
  compactBtn.type = "button";
  compactBtn.setAttribute("aria-label", "Compact context");
  const compactRing = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  compactRing.setAttribute("viewBox", "0 0 36 36");
  compactRing.classList.add("la-compact-ring");
  compactRing.innerHTML = `
    <circle class="la-compact-track" cx="18" cy="18" r="15" fill="none" stroke-width="3"/>
    <circle class="la-compact-fill" cx="18" cy="18" r="15" fill="none" stroke-width="3" stroke-dasharray="94.2 94.2" stroke-dashoffset="94.2" transform="rotate(-90 18 18)" stroke-linecap="round"/>
  `;
  compactBtn.appendChild(compactRing);
  const compactTip = el("div", "la-compact-tooltip");
  const compactTipMain = el("div", "la-compact-tooltip-main", "Context fully available.");
  const compactTipSub = el("div", "la-compact-tooltip-sub", "Click to compact now.");
  compactTip.append(compactTipMain, compactTipSub);
  compactBtn.appendChild(compactTip);

  composerActions.append(compactBtn, sendBtn, cancelBtn);
  composerArea.append(textarea, composerActions);
  const composerStatus = el("div", "la-composer-status");
  composerInner.append(composerArea, composerStatus);
  composer.appendChild(composerInner);

  // ───── debug snapshot ─────
  // Call __laGeom() from devtools to dump every layout number relevant to
  // the mousey / message / composer overlap. Paste the output back here.
  // Cheap, attached once, never wired into hot paths.
  const dumpGeometry = (): Record<string, unknown> => {
    const threadRect = thread.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const mouseyRect = mouseyImg.getBoundingClientRect();
    const threadCS = getComputedStyle(thread);
    const composerCS = getComputedStyle(composer);
    const mouseyCS = getComputedStyle(mouseyImg);
    const drawerCS = thread.parentElement ? getComputedStyle(thread.parentElement) : null;
    // Last rendered message in the virtualizer's inner block.
    const innerEl = thread.querySelector(".la-virt-inner") as HTMLElement | null;
    const messages = innerEl ? Array.from(innerEl.children) as HTMLElement[] : [];
    const lastMsg = messages[messages.length - 1] ?? null;
    const lastMsgRect = lastMsg?.getBoundingClientRect() ?? null;
    const lastMsgActions = lastMsg?.querySelector(".la-msg-actions") as HTMLElement | null;
    const lastActionsRect = lastMsgActions?.getBoundingClientRect() ?? null;
    const spacerEl = thread.querySelector(".la-virt-spacer") as HTMLElement | null;
    const spacerRect = spacerEl?.getBoundingClientRect() ?? null;

    return {
      viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
      drawer: {
        containerType: drawerCS?.containerType,
        containerName: drawerCS?.containerName,
        width: thread.parentElement?.getBoundingClientRect().width ?? null,
      },
      thread: {
        rect: { top: threadRect.top, bottom: threadRect.bottom, height: threadRect.height, width: threadRect.width },
        paddingTop: threadCS.paddingTop,
        paddingBottom: threadCS.paddingBottom,
        scrollTop: thread.scrollTop,
        scrollHeight: thread.scrollHeight,
        clientHeight: thread.clientHeight,
        overflowAnchor: threadCS.overflowAnchor,
        contain: threadCS.contain,
      },
      composer: {
        rect: { top: composerRect.top, bottom: composerRect.bottom, height: composerRect.height },
        paddingTop: composerCS.paddingTop,
      },
      mousey: {
        rect: { top: mouseyRect.top, bottom: mouseyRect.bottom, height: mouseyRect.height, width: mouseyRect.width },
        cssHeight: mouseyCS.height,
        transform: mouseyCS.transform,
        bottom: mouseyCS.bottom,
        position: mouseyCS.position,
        // How far does mousey extend ABOVE composer top?
        extentAboveComposer: composerRect.top - mouseyRect.top,
        // Where does mousey's TOP sit relative to thread bottom?
        topRelativeToThreadBottom: mouseyRect.top - threadRect.bottom,
      },
      spacer: spacerRect ? {
        rect: { top: spacerRect.top, bottom: spacerRect.bottom, height: spacerRect.height },
        cssHeight: spacerEl ? getComputedStyle(spacerEl).height : null,
      } : null,
      lastMessage: lastMsgRect ? {
        rect: { top: lastMsgRect.top, bottom: lastMsgRect.bottom, height: lastMsgRect.height },
        // The number that matters: distance between message bottom and composer top.
        clearanceToComposerTop: composerRect.top - lastMsgRect.bottom,
        // And from the visible mousey top (the actual overlap hazard).
        clearanceToMouseyTop: mouseyRect.top - lastMsgRect.bottom,
      } : null,
      lastActions: lastActionsRect ? {
        rect: { top: lastActionsRect.top, bottom: lastActionsRect.bottom, height: lastActionsRect.height },
        clearanceToComposerTop: composerRect.top - lastActionsRect.bottom,
        clearanceToMouseyTop: mouseyRect.top - lastActionsRect.bottom,
      } : null,
      messageCount: messages.length,
    };
  };
  type DebugGlobal = { __laGeom?: () => Record<string, unknown> };
  (globalThis as DebugGlobal).__laGeom = dumpGeometry;
  // Log once after first paint so the user has a baseline without typing in
  // devtools. Run again with __laGeom() any time the layout looks wrong.
  queueMicrotask(() => {
    // eslint-disable-next-line no-console
    console.log("[la-geom] initial layout snapshot", dumpGeometry());
  });

  // Auto-grow textarea
  const TEXTAREA_MAX_PX = 84;
  const autosizeTextarea = (): void => {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, TEXTAREA_MAX_PX) + "px";
  };
  textarea.addEventListener("input", autosizeTextarea);
  // Refresh send-button enabled state as the user types (text vs empty
  // changes whether send is allowed depending on last-message role).
  textarea.addEventListener("input", () => updateComposer());

  // Toggle the mousey image's bottom-edge alpha falloff ONLY when there is text
  // that would otherwise hard-edge through the figure. Idle drawer (no typed
  // input, empty / scrolled-away thread) keeps the figure fully opaque.
  let mouseyOverlapRaf: number | null = null;
  const detectMouseyOverlap = (): void => {
    if (mouseyOverlapRaf !== null) return;
    mouseyOverlapRaf = requestAnimationFrame(() => {
      mouseyOverlapRaf = null;
      const m = mouseyImg.getBoundingClientRect();
      if (m.width === 0 || m.height === 0) {
        mouseyImg.classList.remove("la-mousey-overlap");
        return;
      }
      // Only fade against the chat-bar textarea. Thread messages were also
      // being checked, which fired the fade whenever the user scrolled up
      // far enough for a message to pass under the figure.
      const t = textarea.getBoundingClientRect();
      const overlap =
        textarea.value.length > 0 &&
        t.right > m.left && t.left < m.right &&
        t.bottom > m.top && t.top < m.bottom;
      mouseyImg.classList.toggle("la-mousey-overlap", overlap);
    });
  };
  textarea.addEventListener("input", detectMouseyOverlap);
  window.addEventListener("resize", detectMouseyOverlap);

  root.append(header, thread, composer);

  const sendBackend = (msg: FrontendToBackend) => ctx.sendToBackend(msg);

  // Splice the currently-selected connection id into a wire message when set.
  // Backend heals s.connectionId from this on every entry path; sites that
  // skip the spread would silently use whatever was last persisted.
  const withConnection = <T extends object>(msg: T): T =>
    state.connectionId ? { ...msg, connectionId: state.connectionId } : msg;

  const refreshLists = () => {
    sendBackend({ type: "list_characters" });
    sendBackend({ type: "list_connections" });
    sendBackend({ type: "list_sessions" });
    sendBackend({ type: "get_ui_prefs" });
    sendBackend({ type: "get_phoneline_pairings" });
  };

  const renderCharOptions = () => {
    charCombo.setDisabled(false);
    charCombo.setPlaceholder("Pick character");
    // Top entry: general-purpose chat with no character context. Tools that
    // need a character are filtered out of the schema in this mode.
    const noneItem = { id: NO_CHARACTER_SENTINEL, label: "(No character)", sublabel: "general chat + workspace only" };
    if (state.characters.length === 0) {
      charCombo.setItems([noneItem]);
    } else {
      charCombo.setItems([
        noneItem,
        ...state.characters.map((c) => ({
          id: c.id,
          label: c.name,
          sublabel: `${c.world_book_ids.length} WB · ${c.regex_script_count} regex`,
        })),
      ]);
    }
    charCombo.setValue(state.characterId ?? NO_CHARACTER_SENTINEL, true);
  };

  const renderConnOptions = () => {
    const cur = connCombo.getValue();
    if (state.connections.length === 0) {
      connCombo.setItems([]);
      connCombo.setPlaceholder("No connections");
      connCombo.setDisabled(true);
      return;
    }
    connCombo.setDisabled(false);
    connCombo.setPlaceholder("Default connection");
    connCombo.setItems(state.connections.map((c) => ({
      id: c.id,
      label: `${c.name}${c.is_default ? " *" : ""}`,
      sublabel: `${c.provider}${c.model ? ` · ${c.model}` : ""}`,
    })));
    // Resolution: persisted -> current value -> default. connections_pushed
    // often arrives BEFORE ui_prefs_pushed; without this ordering the initial
    // render picks the default and pins it as the "current" value, then the
    // persisted choice that arrives moments later would lose the tiebreak.
    if (state.connectionId && state.connections.some((c) => c.id === state.connectionId)) {
      connCombo.setValue(state.connectionId, true);
    } else if (cur && state.connections.some((c) => c.id === cur)) {
      connCombo.setValue(cur, true);
    } else {
      const def = state.connections.find((c) => c.is_default);
      if (def) connCombo.setValue(def.id, true);
    }
  };

  // The scope the active session points at. A no-character chat has no
  // active scope, so its header badge is always 0 (Lumiverse-scope edits
  // surface in the workshop, not the header).
  const activeScope = (): ScopeRef | null =>
    state.characterId !== null ? characterScope(state.characterId) : null;

  // Pure projection of one authoritative snapshot. Never reconciles.
  const scopeEntries = (scope: ScopeRef | null): readonly EditLogEntry[] =>
    scope ? state.scopeLedgers.get(scopeKeyString(scope)) ?? [] : [];

  // What the workshop modal shows: the combo-focused scope if the user
  // picked one, otherwise the active session's scope.
  const workshopScope = (): ScopeRef | null => state.workshopFocusScope ?? activeScope();

  // Combo options for the workshop. scopeStorage only lists scopes that
  // already have a ledger, so a freshly-selected diffless character would be
  // absent and the combo would fall through to the first character that does
  // have edits. Always surface the active character so opening the workshop
  // lands on it (empty diff is the correct, ephemeral view).
  const buildScopeOptions = (): ReadonlyArray<{ scope: ScopeRef; label: string; liveCount: number; totalCount: number }> => {
    const opts = state.scopeStorage.map((e) => ({
      scope: e.scope ?? characterScope(e.characterId),
      label: e.label ?? e.characterName,
      liveCount: e.liveEditCount,
      totalCount: e.editCount,
    }));
    const active = activeScope();
    if (active && !opts.some((o) => scopeKeyString(o.scope) === scopeKeyString(active))) {
      opts.unshift({ scope: active, label: state.characterName ?? "Current character", liveCount: 0, totalCount: 0 });
    }
    return opts;
  };

  const updateSessionBar = () => {
    const source = scopeEntries(activeScope());
    const liveEdits = source.filter((e) => !e.reverted).length;
    editsCount.textContent = String(liveEdits);
    editsBadge.classList.toggle("has-edits", source.length > 0);
  };

  const COMPACT_RING_CIRC = 94.2;
  const COMPACT_AUTO_THRESHOLD = 0.84;
  const updateCompactButton = (): void => {
    const ctxTokens = Math.max(1, state.contextTokens);
    const used = state.contextPromptTokens / ctxTokens;
    const clamped = Math.max(0, Math.min(1, used));
    const fill = compactRing.querySelector(".la-compact-fill") as SVGCircleElement | null;
    if (fill) {
      fill.style.strokeDashoffset = String(COMPACT_RING_CIRC * (1 - clamped));
    }
    compactBtn.classList.toggle("is-near-limit", clamped >= 0.6 && clamped < COMPACT_AUTO_THRESHOLD);
    compactBtn.classList.toggle("is-at-limit", clamped >= COMPACT_AUTO_THRESHOLD);
    compactBtn.classList.toggle("is-busy", state.compacting);
    const remaining = Math.max(0, 1 - clamped);
    const remainingPct = Math.round(remaining * 100);
    if (state.compacting) {
      compactTipMain.textContent = "Compacting...";
      compactTipSub.textContent = "Replacing history with a handoff primer.";
    } else if (state.contextPromptTokens === 0) {
      compactTipMain.textContent = "Context fully available.";
      compactTipSub.textContent = "Click to compact now.";
    } else {
      compactTipMain.textContent = `${remainingPct}% context remaining until auto-compact.`;
      compactTipSub.textContent = "Click to compact now.";
    }
    const canClick = !!state.sessionId && !state.isGenerating && !state.startingSession && !state.compacting;
    compactBtn.disabled = !canClick;
  };

  compactBtn.addEventListener("click", () => {
    if (!state.sessionId || state.isGenerating || state.startingSession || state.compacting) return;
    state.compacting = true;
    updateCompactButton();
    sendBackend({ type: "compact_session", sessionId: state.sessionId });
  });

  const updateComposer = () => {
    if (state.isGenerating || state.startingSession) {
      sendBtn.style.display = "none";
      cancelBtn.style.display = "";
      textarea.disabled = false;
      composerStatus.textContent = state.startingSession ? "starting session..." : "agent is working...";
      composerStatus.classList.remove("is-error");
    } else {
      sendBtn.style.display = "";
      cancelBtn.style.display = "none";
      textarea.disabled = false;
      if (state.sessionId) {
        composerStatus.textContent = "";
      } else {
        composerStatus.textContent = "Type a message and press Send. A new session will start automatically.";
      }
    }
    // Empty textarea behaviour:
    //   - last message was a user message → button enabled, click resumes that turn
    //   - last message was an assistant message (or empty thread) → button greyed
    const hasText = textarea.value.trim().length > 0;
    const last = state.messages[state.messages.length - 1];
    const canContinue = !hasText && !!last && last.role === "user";
    const sendDisabled = state.startingSession || (!hasText && !canContinue);
    sendBtn.disabled = sendDisabled;
    updateCompactButton();
  };

  // Optimistic prune so the UI doesn't flash the reverted row before the
  // backend's authoritative scope_edits_pushed arrives. The session mirror
  // and every scope slot drop the id; the push then re-syncs the one scope.
  const spliceEntries = (ids: ReadonlySet<string>): void => {
    if (ids.size === 0) return;
    state.edits = state.edits.filter((e) => !ids.has(e.id));
    for (const [key, entries] of state.scopeLedgers) {
      state.scopeLedgers.set(key, entries.filter((e) => !ids.has(e.id)));
    }
  };

  const handleRevertOutcome = async (editId: string, outcome: RevertOutcomeWire): Promise<void> => {
    if (outcome.kind === "clean" || outcome.kind === "noop_already_reverted") {
      const removed = new Set<string>([editId]);
      if (outcome.kind === "clean" && outcome.cascadedEditIds && outcome.cascadedEditIds.length > 0) {
        for (const id of outcome.cascadedEditIds) removed.add(id);
        const n = outcome.cascadedEditIds.length;
        composerStatus.textContent = `Reverted, along with ${n} dependent edit${n === 1 ? "" : "s"} that built on it.`;
        composerStatus.classList.remove("is-error");
      }
      spliceEntries(removed);
      rerenderThread();
      updateSessionBar();
      if (state.diffModal) state.diffModal.setEdits(scopeEntries(workshopScope()));
      return;
    }
    if (outcome.kind === "failed") {
      composerStatus.textContent = `Revert failed: ${outcome.error}`;
      composerStatus.classList.add("is-error");
      return;
    }
    // External-divergence path: spindle value drifted outside the agent.
    // (superseded is now a defensive case; cascade-by-default in the backend
    // means we shouldn't normally land here for chained edits.)
    const message = outcome.kind === "superseded"
      ? `${outcome.laterEditIds.length} later edit(s) couldn't be re-applied without this one. Force-revert anyway? Affected later edits will also be marked reverted.`
      : `The field has been changed outside the agent since this edit.\n\nCurrent value starts with:\n${outcome.currentSample.slice(0, 200)}\n\nForce-revert anyway (this overwrites the external change)?`;
    const c = await ctx.ui.showConfirm({
      title: outcome.kind === "superseded" ? "Dependent edits exist" : "External change detected",
      message,
      variant: "warning",
      confirmLabel: "Force revert",
    });
    if (c.confirmed && state.characterId) {
      sendBackend({ type: "revert_edit", characterId: state.characterId, editId, force: true });
    }
  };

  // Open the workshop on the Files tab and focus a specific file. Used by
  // the Settings → Open agent notes shortcut. Mounts the panels lazily if
  // the modal has never been opened.
  const openWorkshopOnFile = (path: string): void => {
    openDiffs();
    state.diffModal?.focusTab("files");
    state.workspacePanel?.focusFile(path);
  };

  const openDiffs = (initialEditId?: string) => {
    if (state.diffModal && state.diffModal.isOpen()) {
      state.diffModal.setEdits(scopeEntries(workshopScope()));
      if (initialEditId) state.diffModal.focusEdit(initialEditId);
      return;
    }
    state.diffModal = null;
    // Build (or reuse) the workspace panel so its tree survives modal reopens
    // and its in-flight requests don't get re-fired every time.
    if (!state.workspacePanel) {
      state.workspacePanel = mountWorkspacePanel({ ctx, sendBackend });
    }
    state.diffModal = openDiffModal(ctx, {
      getEdits: () => scopeEntries(workshopScope()),
      getScopes: () => buildScopeOptions(),
      getSelectedScope: () => workshopScope(),
      onSelectScope: (scope) => {
        state.workshopFocusScope = scope;
        sendBackend({ type: "load_character_workshop", characterId: scope.id, scope });
      },
      onRevert: async (editId) => {
        const scope = workshopScope();
        if (!scope) return;
        sendBackend({ type: "revert_edit", characterId: scope.id, editId, scope });
      },
      onRevertAll: async (scope) => {
        const c = await ctx.ui.showConfirm({
          title: "Revert all edits",
          message: "Revert every live edit in this scope? Cascade-aware. The ledger keeps history so reverts can be undone individually.",
          variant: "danger",
          confirmLabel: "Revert all",
        });
        if (c.confirmed) sendBackend({ type: "revert_character_all", characterId: scope.id, scope });
      },
      onForget: async (scope) => {
        const c = await ctx.ui.showConfirm({
          title: "Forget changes",
          message: "Permanently clear this scope's edit ledger? The underlying data is NOT touched, but you won't be able to revert any of these edits afterwards.",
          variant: "danger",
          confirmLabel: "Forget",
        });
        if (c.confirmed) sendBackend({ type: "squash_character", characterId: scope.id, scope });
      },
      onScopesNeeded: () => sendBackend({ type: "list_characters_storage" }),
      onClose: () => {
        state.diffModal = null;
        // Drop the combo focus so reopening follows the active session's
        // scope again. No refetch: the active scope's slot is already cached
        // and the badge reads it directly.
        state.workshopFocusScope = null;
      },
      filesPanel: state.workspacePanel.root,
    }, {
      ...(initialEditId !== undefined ? { initialEditId } : {}),
      // No character in this chat: open straight to the Lumiverse tab,
      // since the Characters tab would have nothing to show.
      ...(state.characterId === null ? { initialTab: "lumiverse" as const } : {}),
    });
  };

  // ChatVirtualizer renders only the messages currently in the viewport
  // (plus an overscan window). For long sessions this drops per-rerender
  // cost from O(messages) to O(visible), and the per-message edit-id
  // lookup becomes O(1) via the indexed map.
  let renderEditIndex = buildEditIndex(state.edits);
  const virtualizer = new ChatVirtualizer({
    scrollContainer: thread,
    getMessages: () => state.messages,
    renderMessage: (msg) => {
      // Streaming message → hand back the live AssistantHandle's root so
      // tokens / tool events continue to mutate the same DOM node.
      if (state.streamingAssistant && msg.id === state.currentAssistantMessage?.id) {
        return state.streamingAssistant.root;
      }
      const deps = makeThreadDeps();
      const anchorId = rollingAnchorId();
      const node = renderMessage(msg, deps, renderEditIndex);
      if (anchorId !== null && msg.id === anchorId) {
        const wrap = document.createElement("div");
        wrap.appendChild(node);
        const divider = el("div", "la-cache-divider");
        divider.appendChild(el("span", "la-cache-divider-label", "messages above this line are cached"));
        wrap.appendChild(divider);
        return wrap;
      }
      return node;
    },
    // Rough first-paint estimates by role; ResizeObserver corrects after
    // mount. User bubbles are short; assistant turns with tool cards are
    // taller.
    estimateSize: (msg) => msg.role === "user" ? 80 : 280,
  });

  const rerenderThread = () => {
    // Loading lives inside the streaming bubble now; flipping the flag is
    // sufficient. The bubble's own setLoading handler clears the DOM node.
    state.loading = false;
    if (!state.sessionId || state.messages.length === 0) {
      virtualizer.clear();
      if (!thread.contains(emptyState)) thread.appendChild(emptyState);
      virtualizer.setCount();
      return;
    }
    if (thread.contains(emptyState)) thread.removeChild(emptyState);
    renderEditIndex = buildEditIndex(state.edits);
    // Evict every cached message so revert / edit-id splices propagate to
    // the per-message "Edits" cards. Preserve a bubble in inline-edit mode
    // so its live textarea's focus and cursor survive the re-sync.
    if (state.editingMessageId) virtualizer.clearExcept(state.editingMessageId);
    else virtualizer.clear();
    virtualizer.setCount();
  };

  // Error banners are appended directly to the scroll container (outside the
  // virtualizer), so they survive rerenderThread by design. Call this on
  // session change and on the next generation start so they don't accumulate.
  const clearErrorBanners = (): void => {
    for (const node of Array.from(thread.querySelectorAll(".la-error-banner"))) {
      node.remove();
    }
  };

  // Single render pass: thread + session bar + composer in one call. Handlers
  // that change "shape of conversation" state (session switch, message
  // add/edit/delete, edit revert, generation lifecycle) call this so no one
  // forgets one of the three. Hot-path streaming events still update parts
  // surgically; this is for state transitions, not per-token churn.
  const render = (): void => {
    rerenderThread();
    updateSessionBar();
    updateComposer();
  };

  // Per-message banners count edits this session attributed to a message,
  // across every scope, so the session mirror is the right source.
  const liveEditsForAssistantMessage = (assistantMessageId: string): number => {
    return state.edits.filter((e) => e.assistantMessageId === assistantMessageId && !e.reverted).length;
  };
  const liveEditsAfterUserMessage = (userMessageId: string): number => {
    const idx = state.messages.findIndex((m) => m.id === userMessageId && m.role === "user");
    if (idx < 0) return 0;
    const tailAssistantIds = new Set(state.messages.slice(idx + 1).filter((m) => m.role === "assistant").map((m) => m.id));
    return state.edits.filter((e) => e.assistantMessageId !== undefined && tailAssistantIds.has(e.assistantMessageId) && !e.reverted).length;
  };
  const promptEditsAction = async (opts: { liveEditCount: number; action: "edit" | "regenerate" | "delete" }): Promise<"keep" | "revert" | "cancel"> => {
    const verb = opts.action === "edit"
      ? "editing this message"
      : opts.action === "regenerate"
        ? "regenerating this response"
        : "deleting this message";
    const tail = opts.action === "delete"
      ? `${opts.liveEditCount} edit${opts.liveEditCount === 1 ? " was" : "s were"} made by this response. Revert ${opts.liveEditCount === 1 ? "it" : "them"} on the character now, or leave ${opts.liveEditCount === 1 ? "it" : "them"} applied?`
      : `${verb} will discard the AI turns after this point. ${opts.liveEditCount} edit${opts.liveEditCount === 1 ? "" : "s"} the agent made are tracked in the ledger.\n\nRevert those edits to the character now, or leave them applied?`;
    const c = await ctx.ui.showConfirm({
      title: `${opts.liveEditCount} character edit${opts.liveEditCount === 1 ? "" : "s"} in this thread`,
      message: tail,
      variant: "warning",
      confirmLabel: "Revert edits",
      cancelLabel: "Keep edits",
    });
    return c.confirmed ? "revert" : "keep";
  };

  function makeThreadDeps() {
    return {
      onRevertEdit: async (editId: string) => {
        if (!state.characterId) return;
        sendBackend({ type: "revert_edit", characterId: state.characterId, editId });
      },
      onRevertManyEdits: async (editIds: readonly string[]) => {
        if (!state.characterId || editIds.length === 0) return;
        const c = await ctx.ui.showConfirm({
          title: `Revert ${editIds.length} edit${editIds.length === 1 ? "" : "s"}?`,
          message: "Reverts every live edit in this card. Cascade-affected siblings revert too. Workshop history keeps the records (use Undo revert to restore individual ones).",
          variant: "danger",
          confirmLabel: "Revert all",
        });
        if (!c.confirmed) return;
        sendBackend({ type: "revert_edits_bulk", characterId: state.characterId, editIds: [...editIds], ...(state.sessionId ? { sessionId: state.sessionId } : {}) });
      },
      onOpenDiffModal: (initialEditId?: string) => openDiffs(initialEditId),
      onEditUserMessage: async (messageId: string, newContent: string, editsAction: "keep" | "revert") => {
        if (!state.sessionId) return;
        if (isCacheInvalidating(messageId)) {
          const c = await ctx.ui.showConfirm({
            title: "Editing this message will invalidate the prompt cache",
            message: "This message sits at or before the rolling cache anchor (2 user-turns back). Editing it forces the provider to rebuild ~the entire conversation prefix on the next send. Continue?",
            variant: "danger",
            confirmLabel: "Edit anyway",
          });
          if (!c.confirmed) return;
        }
        sendBackend(withConnection({ type: "edit_user_message", sessionId: state.sessionId, messageId, newContent, editsAction }));
      },
      onRegenerateAssistant: async (assistantMessageId: string, editsAction: "keep" | "revert") => {
        if (!state.sessionId) return;
        sendBackend(withConnection({ type: "regenerate_assistant_message", sessionId: state.sessionId, assistantMessageId, editsAction }));
      },
      onEditingChange: (messageId: string | null) => {
        state.editingMessageId = messageId;
      },
      onDeleteMessage: async (messageId: string, editsAction: "keep" | "revert") => {
        if (!state.sessionId) return;
        const cacheWarn = isCacheInvalidating(messageId);
        const c = await ctx.ui.showConfirm({
          title: "Delete message",
          message: cacheWarn
            ? "Permanently remove this message. It sits at or before the rolling cache anchor, so deleting it will invalidate the prompt cache and the provider rebuilds the prefix on the next send."
            : "Permanently remove this message from the conversation? Other messages stay in place.",
          variant: "danger",
          confirmLabel: "Delete",
        });
        if (!c.confirmed) return;
        sendBackend({ type: "delete_message", sessionId: state.sessionId, messageId, editsAction });
      },
      onFreeToolResult: async (callId: string) => {
        if (!state.sessionId) return;
        const ownerId = findAssistantMessageIdForCallId(callId);
        const willInvalidate = ownerId ? isCacheInvalidating(ownerId) : false;
        if (willInvalidate) {
          const c = await ctx.ui.showConfirm({
            title: "Free this tool result",
            message: "This tool result sits at or before the rolling cache anchor, so freeing it invalidates the prompt cache and the provider rebuilds the entire prefix on the next send. Free anyway?",
            variant: "danger",
            confirmLabel: "Free and rebuild cache",
          });
          if (!c.confirmed) return;
        }
        // Below the cache anchor (or caching off): the chat-thread free button
        // already did inline two-click confirmation, so just send.
        sendBackend({ type: "free_tool_result", sessionId: state.sessionId, callId });
      },
      isToolResultInCache: (callId: string) => {
        const ownerId = findAssistantMessageIdForCallId(callId);
        return ownerId ? isCacheInvalidating(ownerId) : false;
      },
      promptEditsAction,
      liveEditsForAssistantMessage,
      liveEditsAfterUserMessage,
    };
  }

  charCombo.onChange((rawId) => {
    // The "(No character)" entry in the dropdown carries a sentinel id; the
    // rest of the UI/backend models the no-character state as null.
    const id = rawId === NO_CHARACTER_SENTINEL ? null : rawId;
    const switchingAway = state.sessionId !== null && id !== state.characterId;
    dlog("charCombo change", { newCharacterId: id, prevCharacterId: state.characterId, sessionId: state.sessionId, switchingAway });
    if (switchingAway) {
      // The active session belongs to a different character. Drop it from the
      // UI so state.characterId stays the source of truth. The session file is
      // safe on the backend, reloadable via Sessions modal.
      state.sessionId = null;
      state.messages = [];
      state.edits = [];
      state.streamingAssistant = null;
      state.currentAssistantMessage = null;
      persistUiPrefs();
    }
    state.characterId = id;
    state.chatsForCharacter = [];
    state.pinnedChatId = null;
    state.autoPinNeeded = !!id;
    setChatPinned(false);
    if (switchingAway) rerenderThread();
    updateComposer();
    updateSessionBar();
    if (id) {
      // Mirror the New chat button: spin up a fresh session for the picked
      // character so the queued autopin from chats_pushed actually lands.
      // Without this the user would see "no pin" until they manually click New.
      startNewSession();
      sendBackend({ type: "list_character_edits", characterId: id });
      sendBackend({ type: "list_chats", characterId: id, ...(state.sessionId ? { sessionId: state.sessionId } : {}) });
    } else {
      // No-character mode: still spin up a fresh session so the user can talk
      // to the agent. Ledger/chat data stay empty; tool filtering and the
      // one-sentence system-prompt directive handle the rest.
      startNewSession();
    }
  });
  // Sends the full ui-prefs blob to the backend. Cheap enough to call on every
  // change to either field; the alternative (separate connection / session
  // endpoints) duplicates plumbing without buying anything.
  const persistUiPrefs = (): void => {
    sendBackend({
      type: "update_ui_prefs",
      connectionId: state.connectionId,
      lastSessionId: state.sessionId,
    });
  };

  connCombo.onChange((id) => {
    state.connectionId = id;
    persistUiPrefs();
  });

  // Spins up a fresh session for the active character. Shared by the
  // New-session button and the char-selector autopin flow (selecting a
  // character implicitly "moves us to a new chat" the same way).
  function startNewSession(): void {
    if (state.isGenerating || state.startingSession) {
      composerStatus.textContent = "Wait for the current generation to finish.";
      composerStatus.classList.add("is-error");
      return;
    }
    composerStatus.classList.remove("is-error");
    state.sessionId = makeId("sess");
    state.messages = [];
    state.edits = [];
    state.currentAssistantMessage = null;
    state.streamingAssistant = null;
    state.pendingMessage = null;
    state.pendingMessageId = null;
    state.startingSession = true;
    render();
    sendBackend(withConnection({
      type: "start_session",
      sessionId: state.sessionId,
      characterId: state.characterId,
    }));
    clearStartTimeout();
    state.startSessionTimeout = setTimeout(() => {
      if (!state.startingSession) return;
      state.startingSession = false;
      state.startSessionTimeout = null;
      composerStatus.textContent = "Backend did not respond to start_session. Restart Lumiverse (start.ps1 -b) and hard-refresh.";
      composerStatus.classList.add("is-error");
      updateComposer();
    }, 8000);
  }

  newSessionBtn.addEventListener("click", startNewSession);

  // Pins the chat to the active session, or queues the pin if no session exists yet.
  const pinChatOrQueue = (chatId: string | null): void => {
    dlog("pinChatOrQueue", { chatId, sessionId: state.sessionId, characterId: state.characterId, startingSession: state.startingSession, pendingMessage: state.pendingMessage });
    if (state.sessionId) {
      dlog("pinChatOrQueue: pinning to existing session", { sessionId: state.sessionId, chatId });
      sendBackend({ type: "set_pinned_chat", sessionId: state.sessionId, chatId });
      return;
    }
    if (!state.characterId) {
      composerStatus.textContent = "Pick a character first.";
      composerStatus.classList.add("is-error");
      return;
    }
    if (state.startingSession) {
      state.pendingPinChatId = chatId;
      return;
    }
    composerStatus.classList.remove("is-error");
    const sessionId = makeId("sess");
    state.sessionId = sessionId;
    state.messages = [];
    state.edits = [];
    state.startingSession = true;
    state.pendingPinChatId = chatId;
    dlog("pinChatOrQueue: auto-starting session for pin", { sessionId, characterId: state.characterId, chatId });
    render();
    sendBackend(withConnection({
      type: "start_session",
      sessionId,
      characterId: state.characterId,
    }));
    clearStartTimeout();
    state.startSessionTimeout = setTimeout(() => {
      if (!state.startingSession) return;
      state.startingSession = false;
      state.pendingPinChatId = null;
      state.startSessionTimeout = null;
      composerStatus.textContent = "Backend did not respond to start_session. Restart Lumiverse and hard-refresh.";
      composerStatus.classList.add("is-error");
      updateComposer();
    }, 8000);
  };

  const openChatPickerModal = (): void => {
    if (!state.characterId) {
      composerStatus.textContent = "Pick a character first.";
      composerStatus.classList.add("is-error");
      return;
    }
    sendBackend({ type: "list_chats", characterId: state.characterId, ...(state.sessionId ? { sessionId: state.sessionId } : {}) });
    const handle: SpindleModalHandle = ctx.ui.showModal({ title: "Pin a chat", width: 520, maxHeight: 560 });
    const note = el("p", "la-modal-note", "Pick a chat to give the agent read access to its message history. The agent uses the pinned chat when you reference 'this chat', 'the conversation', etc. Pin nothing to keep the agent isolated from your chat data.");
    const list = el("div", "la-sessions-modal-list");
    const render = (): void => {
      list.innerHTML = "";
      const unpin = el("button", `la-session-item ${state.pinnedChatId === null ? "is-active" : ""}`);
      unpin.append(
        Object.assign(el("div"), { textContent: "(No chat pinned)" }),
        el("div", "la-session-item-meta", "Agent has no message-history access."),
      );
      unpin.addEventListener("click", () => {
        pinChatOrQueue(null);
        handle.dismiss();
      });
      list.appendChild(unpin);
      if (state.chatsForCharacter.length === 0) {
        list.appendChild(el("div", "la-diff-pane-empty", "No chats yet for this character."));
        return;
      }
      for (const c of state.chatsForCharacter) {
        const row = el("div", `la-session-item ${c.isPinned ? "is-active" : ""}`);
        const main = el("div", "la-session-item-main");
        main.append(Object.assign(el("div"), { textContent: c.name + (c.isActive ? "  (currently open)" : "") }));
        main.append(el("div", "la-session-item-meta", `updated ${new Date(c.updatedAt).toLocaleString()}`));
        row.appendChild(main);
        if (c.isPinned) {
          // The chat this session is pinned to. Marker mirrors the Sessions
          // modal's "currently loaded" tick — both flag the manually-chosen
          // state. Colour stays the row's; tick adds redundant clarity.
          const tick = el("span", "la-session-item-tick");
          tick.title = "Currently pinned";
          tick.setAttribute("aria-label", "Currently pinned");
          tick.innerHTML = ICON_TICK;
          row.appendChild(tick);
        }
        row.addEventListener("click", () => {
          pinChatOrQueue(c.id);
          handle.dismiss();
        });
        list.appendChild(row);
      }
    };
    handle.root.append(note, list);
    render();
    // Re-render when chats_pushed arrives (e.g. after a pin click).
    const detach = pushChatsListeners.push(render);
    handle.onDismiss(() => detach());
  };

  const pushChatsListeners: { handlers: Array<() => void>; push(h: () => void): () => void } = {
    handlers: [],
    push(h) { this.handlers.push(h); return () => { this.handlers = this.handlers.filter((x) => x !== h); }; },
  };

  // Same shape as pushChatsListeners — re-renders the open sessions modal when
  // a fresh sessions_pushed lands, so e.g. deletes drop their row immediately.
  const pushSessionsListeners: { handlers: Array<() => void>; push(h: () => void): () => void } = {
    handlers: [],
    push(h) { this.handlers.push(h); return () => { this.handlers = this.handlers.filter((x) => x !== h); }; },
  };

  chatPinBtn.addEventListener("click", () => openChatPickerModal());

  const openSessionsModal = (): void => {
    const handle: SpindleModalHandle = ctx.ui.showModal({ title: "Sessions", width: 520 });
    const list = el("div", "la-sessions-modal-list");
    handle.root.appendChild(list);

    const render = (): void => {
      list.innerHTML = "";
      if (state.sessions.length === 0) {
        list.appendChild(el("div", "la-diff-pane-empty", "No sessions yet."));
        return;
      }
      for (const s of state.sessions) {
        const isCurrent = s.sessionId === state.sessionId;
        const row = el("div", `la-session-item ${isCurrent ? "is-active" : ""}`);
        const main = el("div", "la-session-item-main");
        main.append(el("div", undefined, s.characterId === null ? "(No character)" : s.characterName));
        main.append(el("div", "la-session-item-meta", `${s.messageCount} msg . ${s.editCount} edits${s.revertedEditCount ? ` (${s.revertedEditCount} reverted)` : ""} . ${new Date(s.lastActivityAt).toLocaleString()}`));
        const exportBtn = el("button", "la-session-item-delete") as HTMLButtonElement;
        exportBtn.type = "button";
        exportBtn.title = "Export session as Markdown";
        exportBtn.setAttribute("aria-label", "Export session as Markdown");
        exportBtn.innerHTML = ICON_DOWNLOAD;
        exportBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          sendBackend({ type: "export_session_markdown", sessionId: s.sessionId });
        });
        const delBtn = el("button", "la-session-item-delete") as HTMLButtonElement;
        delBtn.type = "button";
        delBtn.title = "Delete session";
        delBtn.setAttribute("aria-label", "Delete session");
        delBtn.innerHTML = ICON_TRASH;
        delBtn.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          const r = await ctx.ui.showConfirm({ title: "Delete session", message: "Permanently delete this session? Edits already committed to the card will NOT be reverted; use 'Revert session' first if you want those undone.", variant: "danger", confirmLabel: "Delete" });
          if (r.confirmed) {
            delBtn.disabled = true;
            sendBackend({ type: "delete_session", sessionId: s.sessionId });
          }
        });
        row.append(main);
        if (isCurrent) {
          // Marker only, no colouring beyond what is-active already provides.
          const tick = el("span", "la-session-item-tick");
          tick.title = "Active session";
          tick.setAttribute("aria-label", "Active session");
          tick.innerHTML = ICON_TICK;
          row.appendChild(tick);
        }
        row.append(exportBtn, delBtn);
        row.addEventListener("click", () => {
          sendBackend({ type: "load_session", sessionId: s.sessionId });
          handle.dismiss();
        });
        list.appendChild(row);
      }
    };

    render();
    // Refresh the list whenever sessions_pushed comes in (e.g. after a delete).
    // Also re-request immediately in case state.sessions is stale.
    sendBackend({ type: "list_sessions" });
    const detach = pushSessionsListeners.push(render);
    handle.onDismiss(() => detach());
  };

  editsBadge.addEventListener("click", () => openDiffs());

  switchSessionBtn.addEventListener("click", () => openSessionsModal());
  settingsBtn.addEventListener("click", () => openAgentSettingsModal());

  menuBtn.addEventListener("click", async () => {
    const rect = menuBtn.getBoundingClientRect();
    const res = await ctx.ui.showContextMenu({
      position: { x: rect.left, y: rect.bottom + 4 },
      items: [
        { key: "icon", label: "Visuals & display name..." },
        { key: "revert_active", label: "Revert all edits in this session", disabled: !state.sessionId, danger: true },
        { key: "delete_active", label: "Delete current session", disabled: !state.sessionId, danger: true },
      ],
    });
    if (res.selectedKey === "icon") openIconSettingsModal();
    else if (res.selectedKey === "revert_active" && state.sessionId) {
      const liveCount = state.edits.filter((e) => !e.reverted).length;
      if (liveCount === 0) {
        composerStatus.textContent = "No live edits in this session to revert.";
        return;
      }
      const c = await ctx.ui.showConfirm({
        title: "Revert all session edits",
        message: `Revert every live edit made during this session (${liveCount} edit${liveCount === 1 ? "" : "s"})? This restores the character to what it was before the conversation started. Cascade-aware. Cannot be undone in one click.`,
        variant: "danger",
        confirmLabel: "Revert all",
      });
      if (c.confirmed) sendBackend({ type: "revert_session", sessionId: state.sessionId });
    }
    else if (res.selectedKey === "delete_active" && state.sessionId) {
      const c = await ctx.ui.showConfirm({
        title: "Delete session",
        message: "Delete this conversation? Edits already applied to the character are NOT reverted; use the Changes panel to revert individual edits first if needed.",
        variant: "danger",
        confirmLabel: "Delete",
      });
      if (c.confirmed) sendBackend({ type: "delete_session", sessionId: state.sessionId });
    }
  });

  const MAX_ICON_BYTES = 2 * 1024 * 1024; // 2 MB

  const readImageAsDataUrl = (bytes: Uint8Array, mimeType: string): string => {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    return `data:${mimeType};base64,${btoa(binary)}`;
  };

  const openAgentSettingsModal = (): void => {
    sendBackend({ type: "get_settings" });
    // Width = 90vw clamped to [560, 1360] at open time. Host clamps to
    // viewport anyway, this just spends the slack on narrow screens
    // (laptops, side-by-side windows) instead of always hitting the cap.
    const viewportW = typeof window !== "undefined" ? window.innerWidth : 1360;
    const modalWidth = Math.max(560, Math.min(Math.floor(viewportW * 0.9), 1360));
    const handle = ctx.ui.showModal({ title: "Agent settings", width: modalWidth, maxHeight: 1080 });
    const wrap = el("div", "la-agent-settings");
    wrap.appendChild(el("p", "la-modal-note", "Customize how LumiAgent behaves. Changes save automatically on blur and on close, and apply to your next message."));

    // --- Persona ---
    wrap.appendChild(el("label", "la-settings-label", "Persona"));
    wrap.appendChild(el("div", "la-settings-hint", "Defines who the agent is. Prepended above the technical instructions. Default = the LumiAgent mousegirl persona."));
    const personaArea = document.createElement("textarea");
    personaArea.className = "la-settings-textarea";
    personaArea.rows = 8;
    wrap.appendChild(personaArea);
    const personaResetRow = el("div", "la-settings-reset-row");
    const personaResetBtn = el("button", "la-btn la-btn-mini la-btn-ghost", "Reset to default") as HTMLButtonElement;
    personaResetRow.appendChild(personaResetBtn);
    wrap.appendChild(personaResetRow);

    // --- System prompt body ---
    wrap.appendChild(el("label", "la-settings-label", "System prompt body"));
    wrap.appendChild(el("div", "la-settings-hint", "The technical body. Tool guidance, working principles, edit discipline. The persona, LumiRealm, pinned-chat, and external-provider sections are appended automatically; you only own this body."));
    const promptArea = document.createElement("textarea");
    promptArea.className = "la-settings-textarea la-settings-textarea-tall";
    promptArea.rows = 12;
    wrap.appendChild(promptArea);
    const promptResetRow = el("div", "la-settings-reset-row");
    const promptResetBtn = el("button", "la-btn la-btn-mini la-btn-ghost", "Reset to default") as HTMLButtonElement;
    promptResetRow.appendChild(promptResetBtn);
    wrap.appendChild(promptResetRow);

    // --- Samplers ---
    wrap.appendChild(el("label", "la-settings-label", "Samplers"));
    wrap.appendChild(el("div", "la-settings-hint", "Drag a slider to set, double-click to reset that sampler, empty number = inherit from the connection's preset."));
    const samplersList = el("div", "la-samplers-list");
    wrap.appendChild(samplersList);
    const samplersResetRow = el("div", "la-settings-reset-row");
    const samplersResetBtn = el("button", "la-btn la-btn-mini la-btn-ghost", "Reset all") as HTMLButtonElement;
    samplersResetRow.appendChild(samplersResetBtn);
    wrap.appendChild(samplersResetRow);

    // --- Jailbreak ---
    const jbHead = el("div", "la-settings-section-head");
    jbHead.append(el("label", "la-settings-label", "Jailbreak / prefill"));
    wrap.appendChild(jbHead);
    wrap.appendChild(el("div", "la-settings-hint", "Optional text injected per message. Leave empty to disable."));
    const jbArea = document.createElement("textarea");
    jbArea.className = "la-settings-textarea";
    jbArea.rows = 4;
    wrap.appendChild(jbArea);
    const jbPlacementRow = el("div", "la-settings-row");
    jbPlacementRow.append(el("label", "la-settings-row-label", "Placement"));
    const jbPlacement = document.createElement("select");
    jbPlacement.className = "la-select";
    for (const [val, lbl] of [
      ["system_suffix", "End of system prompt"],
      ["user_suffix", "End of message list as user"],
      ["assistant_prefill", "End of message list as agent (prefill)"],
    ] as const) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = lbl;
      jbPlacement.appendChild(opt);
    }
    jbPlacementRow.appendChild(jbPlacement);
    wrap.appendChild(jbPlacementRow);

    wrap.appendChild(el("hr", "la-settings-divider"));

    // --- Agent notes shortcut ---
    wrap.appendChild(el("label", "la-settings-label", "Agent notes"));
    wrap.appendChild(el("div", "la-settings-hint", "Long-term memory file the agent reads at the start of every session. Anything you put there is preloaded into context."));
    const notesRow = el("div", "la-settings-row");
    const notesBtn = el("button", "la-btn la-btn-mini", "Open agent notes") as HTMLButtonElement;
    notesBtn.addEventListener("click", () => {
      handle.dismiss();
      openWorkshopOnFile("agent/agent.md");
    });
    notesRow.appendChild(notesBtn);
    wrap.appendChild(notesRow);

    wrap.appendChild(el("hr", "la-settings-divider"));

    // --- Storage caps ---
    wrap.appendChild(el("label", "la-settings-label", "Storage limits"));
    wrap.appendChild(el("div", "la-settings-hint", "Per-user storage cap for the workspace."));
    const wsCapRow = el("div", "la-settings-row");
    wsCapRow.append(el("label", "la-settings-row-label", "Workspace cap (MB)"));
    const wsCapInput = document.createElement("input");
    wsCapInput.type = "number";
    wsCapInput.className = "la-slider-input";
    wsCapInput.min = "1";
    wsCapInput.step = "1";
    wsCapRow.appendChild(wsCapInput);
    wrap.appendChild(wsCapRow);

    wrap.appendChild(el("label", "la-settings-label", "Tool output cap"));
    wrap.appendChild(el("div", "la-settings-hint", "Set to dump any single tool result over that many tokens to a tmp file the agent can grep/read to avoid blowing up context."));
    const toolCapRow = el("div", "la-settings-row");
    toolCapRow.append(el("label", "la-settings-row-label", "Tool output cap (tk)"));
    const toolCapInput = document.createElement("input");
    toolCapInput.type = "number";
    toolCapInput.className = "la-slider-input";
    toolCapInput.min = "1";
    toolCapInput.step = "1";
    toolCapRow.appendChild(toolCapInput);
    wrap.appendChild(toolCapRow);

    wrap.appendChild(el("hr", "la-settings-divider"));

    wrap.appendChild(el("label", "la-settings-label", "Prompt caching"));
    wrap.appendChild(el("div", "la-settings-hint", "Anthropic-only. OpenAI, Gemini, DeepSeek, and other providers cache the prompt prefix automatically upstream regardless of this setting."));
    const cacheModeRow = el("div", "la-settings-row");
    cacheModeRow.append(el("label", "la-settings-row-label", "Cache mode"));
    const cacheModeSelect = document.createElement("select");
    cacheModeSelect.className = "la-select";
    for (const [val, label] of [["full", "Full"], ["system_only", "System only"], ["off", "Off"]] as const) {
      const o = document.createElement("option");
      o.value = val;
      o.textContent = label;
      cacheModeSelect.appendChild(o);
    }
    cacheModeRow.appendChild(cacheModeSelect);
    wrap.appendChild(cacheModeRow);

    const parallelToolsRow = el("div", "la-settings-row");
    parallelToolsRow.append(el("label", "la-settings-row-label", "Parallel tool calls"));
    const parallelToolsInput = document.createElement("input");
    parallelToolsInput.type = "checkbox";
    parallelToolsInput.className = "la-checkbox";
    parallelToolsRow.appendChild(parallelToolsInput);
    wrap.appendChild(parallelToolsRow);
    wrap.appendChild(el("div", "la-settings-hint", "Leave ON for Anthropic, OpenAI, Google, most OpenRouter routes. Turn OFF for providers that error on parallel tool emission."));

    wrap.appendChild(el("hr", "la-settings-divider"));

    wrap.appendChild(el("label", "la-settings-label", "Extension pairings"));
    wrap.appendChild(el("div", "la-settings-hint", "Other extensions that can communicate with LumiAgent."));
    const pairingsPanel = el("div", "la-pairings-panel");
    pairingsPanel.appendChild(el("div", "la-pairings-empty", "Loading..."));
    wrap.appendChild(pairingsPanel);
    const renderPairings = (pairings: readonly PairingWire[]): void => {
      while (pairingsPanel.firstChild) pairingsPanel.removeChild(pairingsPanel.firstChild);
      if (pairings.length === 0) {
        pairingsPanel.appendChild(el("div", "la-pairings-empty", "No pairings yet."));
        return;
      }
      for (const p of pairings) {
        const row = el("div", "la-pairing-row");
        const nameCol = el("div", "la-pairing-name-col");
        nameCol.appendChild(el("div", "la-pairing-name", p.displayName));
        nameCol.appendChild(el("div", "la-pairing-id", p.identifier));
        row.appendChild(nameCol);
        const toggleLabel = el("label", "la-pairing-toggle");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "la-checkbox";
        cb.checked = p.allowed;
        // Pairing state is read into the External Providers section of the
        // system message, so toggling it busts the prompt cache. Confirm.
        cb.addEventListener("click", async (ev) => {
          ev.preventDefault();
          const nextAllowed = !p.allowed;
          const c = await ctx.ui.showConfirm({
            title: nextAllowed ? "Allow this pairing?" : "Block this pairing?",
            message: `Pairing state is part of the system prompt's External Providers section. Toggling it invalidates the prompt cache on your next message in every active chat. ${nextAllowed ? "Allow" : "Block"} "${p.displayName}"?`,
            variant: "danger",
            confirmLabel: nextAllowed ? "Allow" : "Block",
          });
          if (!c.confirmed) return;
          cb.checked = nextAllowed;
          sendBackend({ type: "set_phoneline_pairing", identifier: p.identifier, allowed: nextAllowed });
        });
        toggleLabel.appendChild(cb);
        toggleLabel.appendChild(el("span", "la-pairing-toggle-label", "Allowed"));
        row.appendChild(toggleLabel);
        const revokeBtn = el("button", "la-btn la-btn-mini la-btn-ghost", "Forget") as HTMLButtonElement;
        revokeBtn.addEventListener("click", async () => {
          const c = await ctx.ui.showConfirm({
            title: "Forget this pairing?",
            message: `Removing "${p.displayName}" wipes its stored consent and invalidates the system prompt cache on the next message. You will be re-prompted for consent if the extension dials again.`,
            variant: "danger",
            confirmLabel: "Forget",
          });
          if (!c.confirmed) return;
          sendBackend({ type: "revoke_phoneline_pairing", identifier: p.identifier });
        });
        row.appendChild(revokeBtn);
        pairingsPanel.appendChild(row);
      }
    };
    const unregisterPairings = pairingsListeners.push((p) => renderPairings(p));
    handle.onDismiss(unregisterPairings);
    sendBackend({ type: "get_phoneline_pairings" });

    const status = el("div", "la-composer-status");
    wrap.appendChild(status);

    // Forward-declared so the sampler slider closures can call it. Real impl
    // installs below once all inputs are in scope.
    let commit: () => void = () => {};

    let samplerBag: Record<string, number | null> = {
      temperature: null, maxTokens: null, contextSize: null,
      topP: null, minP: null, topK: null,
      frequencyPenalty: null, presencePenalty: null, repetitionPenalty: null,
    };

    const populate = (): void => {
      const s = state.settings;
      if (!s) {
        personaArea.value = "";
        personaArea.placeholder = "Loading...";
        promptArea.value = "";
        return;
      }
      personaArea.value = s.persona;
      personaArea.placeholder = "(empty: agent has no persona)";
      // Show the default body when override is null so the user can see what's
      // active. We track an "isDefault" flag implicitly via the textarea value;
      // saving sets override to null only when it exactly matches the default.
      promptArea.value = s.systemPromptOverride ?? (s.defaultSystemPromptBody ?? "");
      if (s.samplers) samplerBag = { ...s.samplers };
      jbArea.value = s.jailbreak ?? "";
      jbPlacement.value = s.jailbreakPlacement ?? "system_suffix";
      const wsDefault = s.workspaceCapDefaultBytes ?? (5 * 1024 * 1024 * 1024);
      wsCapInput.placeholder = `${Math.round(wsDefault / 1024 / 1024)}`;
      wsCapInput.value = s.workspaceCapBytes ? String(Math.round(s.workspaceCapBytes / 1024 / 1024)) : "";
      const toolDefault = s.toolOutputCapDefaultTokens ?? 8000;
      toolCapInput.placeholder = `${toolDefault}`;
      toolCapInput.value = s.toolOutputCapTokens ? String(s.toolOutputCapTokens) : "";
      cacheModeSelect.value = s.cacheMode ?? "full";
      parallelToolsInput.checked = s.parallelToolCalls ?? true;
      renderSamplers();
    };

    const resetAllSamplers = (): void => {
      for (const k of Object.keys(samplerBag)) samplerBag[k] = null;
      renderSamplers();
    };

    // Mirror of state/samplers.ts SAMPLER_DEFS. Keep in sync.
    const SAMPLER_DEFS: ReadonlyArray<{ key: string; label: string; type: "int" | "float"; min: number; max: number; step: number; defaultHint: number }> = [
      { key: "temperature",       label: "Temperature",  type: "float", min: 0, max: 2,       step: 0.01, defaultHint: 1.0 },
      { key: "maxTokens",         label: "Max Response", type: "int",   min: 1, max: 128000,  step: 1,    defaultHint: 65536 },
      { key: "contextSize",       label: "Context Size", type: "int",   min: 1, max: 2000000, step: 1,    defaultHint: 400000 },
      { key: "topP",              label: "Top P",        type: "float", min: 0, max: 1,       step: 0.01, defaultHint: 0.95 },
      { key: "minP",              label: "Min P",        type: "float", min: 0, max: 1,       step: 0.01, defaultHint: 0 },
      { key: "topK",              label: "Top K",        type: "int",   min: 0, max: 500,     step: 1,    defaultHint: 0 },
      { key: "frequencyPenalty",  label: "Freq Penalty", type: "float", min: 0, max: 2,       step: 0.01, defaultHint: 0 },
      { key: "presencePenalty",   label: "Pres Penalty", type: "float", min: 0, max: 2,       step: 0.01, defaultHint: 0 },
      { key: "repetitionPenalty", label: "Rep Penalty",  type: "float", min: 0, max: 2,       step: 0.01, defaultHint: 0 },
    ];

    const buildSamplerSlider = (def: typeof SAMPLER_DEFS[number]): HTMLElement => {
      const row = el("div", "la-slider-row");
      const header = el("div", "la-slider-header");
      const label = el("span", "la-slider-label", def.label);
      const numInput = document.createElement("input");
      numInput.type = "number";
      numInput.className = "la-slider-input";
      numInput.min = String(def.min);
      numInput.max = String(def.max);
      numInput.step = String(def.step);
      numInput.placeholder = String(def.defaultHint);
      header.append(label, numInput);
      const track = el("div", "la-slider-track");
      track.title = "Drag to set, double-click to reset";
      const fill = el("div", "la-slider-fill");
      const thumb = el("div", "la-slider-thumb");
      track.append(fill, thumb);
      row.append(header, track);

      const decimals = (String(def.step).split(".")[1] || "").length;
      const snap = (raw: number): number => {
        const clamped = Math.min(def.max, Math.max(def.min, raw));
        const stepped = Math.round((clamped - def.min) / def.step) * def.step + def.min;
        return def.type === "int" ? Math.round(stepped) : parseFloat(stepped.toFixed(decimals));
      };
      const posToValue = (clientX: number): number => {
        const rect = track.getBoundingClientRect();
        if (!rect || rect.width === 0) return def.defaultHint;
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        return snap(def.min + ratio * (def.max - def.min));
      };
      const applyVisual = (displayValue: number, isSet: boolean): void => {
        const range = def.max - def.min;
        const pct = range > 0 ? Math.max(0, Math.min(100, ((displayValue - def.min) / range) * 100)) : 0;
        fill.style.width = `${pct}%`;
        thumb.style.left = `${pct}%`;
        track.classList.toggle("la-slider-track-set", isSet);
        label.classList.toggle("la-slider-label-set", isSet);
        numInput.classList.toggle("la-slider-input-set", isSet);
      };
      const sync = (): void => {
        const v = samplerBag[def.key] ?? null;
        const isSet = v !== null;
        const display = isSet ? v! : def.defaultHint;
        if (document.activeElement !== numInput) numInput.value = isSet ? String(v) : "";
        applyVisual(display, isSet);
      };

      let dragging = false;
      let dragValue: number | null = null;
      track.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        dragging = true;
        try { track.setPointerCapture(e.pointerId); } catch { /* */ }
        dragValue = posToValue(e.clientX);
        applyVisual(dragValue, true);
      });
      track.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        dragValue = posToValue(e.clientX);
        applyVisual(dragValue, true);
      });
      track.addEventListener("pointerup", (e) => {
        if (!dragging) return;
        dragging = false;
        try { track.releasePointerCapture(e.pointerId); } catch { /* */ }
        if (dragValue !== null) { samplerBag[def.key] = dragValue; sync(); commit(); }
        dragValue = null;
      });
      track.addEventListener("dblclick", () => { samplerBag[def.key] = null; sync(); commit(); });
      const commitFromInput = (raw: string): void => {
        if (raw === "") { samplerBag[def.key] = null; sync(); commit(); return; }
        const num = def.type === "int" ? parseInt(raw, 10) : parseFloat(raw);
        if (Number.isFinite(num)) { samplerBag[def.key] = snap(num); sync(); commit(); }
      };
      numInput.addEventListener("change", () => commitFromInput(numInput.value));
      numInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") numInput.blur();
        else if (e.key === "Escape") { numInput.blur(); sync(); }
      });
      sync();
      return row;
    };

    const renderSamplers = (): void => {
      samplersList.innerHTML = "";
      for (const def of SAMPLER_DEFS) samplersList.appendChild(buildSamplerSlider(def));
    };

    const parseCapMb = (raw: string): number | null => {
      const n = parseInt(raw.trim(), 10);
      return Number.isFinite(n) && n > 0 ? n * 1024 * 1024 : null;
    };
    const parsePosInt = (raw: string): number | null => {
      const n = parseInt(raw.trim(), 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    let lastCommitted = "";
    commit = (): void => {
      const persona = personaArea.value.trim();
      const promptValue = promptArea.value.trim();
      const defaultBody = state.settings?.defaultSystemPromptBody?.trim() ?? "";
      // Body matching default verbatim becomes "no override" so future tweaks
      // to the default flow through automatically.
      const systemPromptOverride = promptValue.length === 0 || promptValue === defaultBody ? null : promptValue;
      const placement = (jbPlacement.value as "system_suffix" | "user_suffix" | "assistant_prefill");
      const newCacheMode = (cacheModeSelect.value as "off" | "system_only" | "full");
      const payload = {
        type: "update_settings" as const,
        persona,
        systemPromptOverride,
        samplers: samplerBag,
        jailbreak: jbArea.value,
        jailbreakPlacement: placement,
        workspaceCapBytes: parseCapMb(wsCapInput.value),
        toolOutputCapTokens: parsePosInt(toolCapInput.value),
        cacheMode: newCacheMode,
        parallelToolCalls: parallelToolsInput.checked,
      };
      const key = JSON.stringify(payload);
      if (key === lastCommitted) return;
      lastCommitted = key;
      const before = state.settings;
      const promptCacheBroken = !!before && (
        before.persona !== persona
        || (before.systemPromptOverride ?? null) !== systemPromptOverride
        || (before.jailbreak ?? "") !== jbArea.value
        || (before.jailbreakPlacement ?? "system_suffix") !== placement
        || (before.cacheMode ?? "full") !== newCacheMode
      );
      sendBackend(payload);
      status.textContent = promptCacheBroken ? "Saved. Prompt cache invalidates on next message." : "Saved.";
      status.classList.remove("is-error");
    };

    populate();
    const detach = settingsListeners.push(populate);
    handle.onDismiss(() => { commit(); detach(); });

    personaResetBtn.addEventListener("click", () => { if (state.settings) { personaArea.value = state.settings.defaultPersona; commit(); } });
    promptResetBtn.addEventListener("click", () => { if (state.settings?.defaultSystemPromptBody) { promptArea.value = state.settings.defaultSystemPromptBody; commit(); } });
    samplersResetBtn.addEventListener("click", () => { resetAllSamplers(); commit(); });

    for (const inp of [personaArea, promptArea, jbArea, wsCapInput, toolCapInput]) {
      inp.addEventListener("blur", () => commit());
    }
    for (const inp of [jbPlacement, cacheModeSelect, parallelToolsInput]) {
      inp.addEventListener("change", () => commit());
    }

    handle.root.appendChild(wrap);
  };

  type PairingWire = { identifier: string; displayName: string; allowed: boolean; decidedAt: number };
  const pairingsListeners: { handlers: Array<(p: readonly PairingWire[]) => void>; push(h: (p: readonly PairingWire[]) => void): () => void } = {
    handlers: [],
    push(h) { this.handlers.push(h); return () => { this.handlers = this.handlers.filter((x) => x !== h); }; },
  };

  const settingsListeners: { handlers: Array<() => void>; push(h: () => void): () => void } = {
    handlers: [],
    push(h) { this.handlers.push(h); return () => { this.handlers = this.handlers.filter((x) => x !== h); }; },
  };

  const MAX_MOUSEY_BYTES = 4 * 1024 * 1024;

  const openIconSettingsModal = (): void => {
    const handle = ctx.ui.showModal({ title: "Visuals & display name", width: 520, maxHeight: 720 });
    const wrap = el("div", "la-icon-settings");
    const note = el("p", "la-modal-note", "Customise the drawer icon, the sitting character image, and the display name. Stored in your browser. Reload the tab to apply.");
    wrap.appendChild(note);
    const status = el("div", "la-composer-status");

    // --- Display name section ---
    const nameHead = el("div", "la-settings-section-head");
    nameHead.append(el("label", "la-settings-label", "Display name"));
    wrap.appendChild(nameHead);
    wrap.appendChild(el("div", "la-settings-hint", "What this extension calls itself in the drawer tab + sidebar. Default: LumiAgent."));
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "la-input";
    const currentName = resolveDisplayName();
    nameInput.value = currentName.full === DEFAULT_DISPLAY_NAME ? "" : currentName.full;
    nameInput.placeholder = DEFAULT_DISPLAY_NAME;
    nameInput.maxLength = 40;
    wrap.appendChild(nameInput);
    const nameActions = el("div", "la-icon-settings-actions");
    const nameSaveBtn = el("button", "la-btn la-btn-primary", "Save name") as HTMLButtonElement;
    const nameResetBtn = el("button", "la-btn", "Reset") as HTMLButtonElement;
    nameActions.append(nameSaveBtn, nameResetBtn);
    wrap.appendChild(nameActions);
    nameSaveBtn.addEventListener("click", () => {
      const v = nameInput.value.trim();
      try {
        if (v.length > 0) localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, v);
        else localStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
      } catch { /* localStorage unavailable */ }
      status.textContent = "Display name saved. Reload to apply.";
      status.classList.remove("is-error");
    });
    nameResetBtn.addEventListener("click", () => {
      try { localStorage.removeItem(DISPLAY_NAME_STORAGE_KEY); } catch { /* localStorage unavailable */ }
      nameInput.value = "";
      status.textContent = "Display name reset. Reload to apply.";
      status.classList.remove("is-error");
    });

    // --- Drawer icon section ---
    const iconHead = el("div", "la-settings-section-head");
    iconHead.append(el("label", "la-settings-label", "Drawer icon"));
    wrap.appendChild(iconHead);
    wrap.appendChild(el("div", "la-settings-hint", "Replaces the icon shown in the Lumiverse sidebar."));
    const iconPreview = el("div", "la-icon-settings-preview");
    const iconImg = document.createElement("img");
    iconImg.src = resolveDrawerIconUrl();
    iconImg.alt = "current icon";
    iconImg.className = "la-icon-settings-image";
    const iconCaption = el("div", "la-icon-settings-caption", "Current");
    iconPreview.append(iconCaption, iconImg);
    wrap.appendChild(iconPreview);
    const iconActions = el("div", "la-icon-settings-actions");
    const iconPickBtn = el("button", "la-btn la-btn-primary", "Choose image...") as HTMLButtonElement;
    const iconResetBtn = el("button", "la-btn la-btn-danger", "Reset to default") as HTMLButtonElement;
    iconActions.append(iconPickBtn, iconResetBtn);
    wrap.appendChild(iconActions);

    iconPickBtn.addEventListener("click", async () => {
      status.textContent = "";
      status.classList.remove("is-error");
      try {
        const files = await ctx.uploads.pickFile({
          accept: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"],
          multiple: false,
          maxSizeBytes: MAX_ICON_BYTES,
        });
        if (files.length === 0) return;
        const file = files[0]!;
        if (file.sizeBytes > MAX_ICON_BYTES) {
          status.textContent = `Image too large (${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB). Max 2 MB.`;
          status.classList.add("is-error");
          return;
        }
        const dataUrl = readImageAsDataUrl(file.bytes, file.mimeType || "image/png");
        try { localStorage.setItem(ICON_STORAGE_KEY, dataUrl); } catch { /* localStorage unavailable */ }
        iconImg.src = dataUrl;
        iconCaption.textContent = "Selected (reload to apply)";
        status.textContent = "Icon saved. Reload to apply.";
      } catch (err) {
        status.textContent = `Failed: ${(err as Error).message}`;
        status.classList.add("is-error");
      }
    });
    iconResetBtn.addEventListener("click", () => {
      try { localStorage.removeItem(ICON_STORAGE_KEY); } catch { /* localStorage unavailable */ }
      iconImg.src = DEFAULT_ICON_DATA_URL;
      iconCaption.textContent = "Default (reload to apply)";
      status.textContent = "Icon reset. Reload to apply.";
      status.classList.remove("is-error");
    });

    // --- Mousey image section ---
    const mouseyHead = el("div", "la-settings-section-head");
    mouseyHead.append(el("label", "la-settings-label", "Sitting character image"));
    wrap.appendChild(mouseyHead);
    wrap.appendChild(el("div", "la-settings-hint", "The image perched on the composer ledge. Transparent PNG works best. For correct positioning the figure should be sitting around 2/3 of the way down the image."));
    const mouseyPreview = el("div", "la-icon-settings-preview");
    const mouseyImgPreview = document.createElement("img");
    mouseyImgPreview.src = resolveMouseyImageUrl();
    mouseyImgPreview.alt = "current sitting image";
    mouseyImgPreview.className = "la-icon-settings-image la-icon-settings-image-tall";
    const mouseyCaption = el("div", "la-icon-settings-caption", "Current");
    mouseyPreview.append(mouseyCaption, mouseyImgPreview);
    wrap.appendChild(mouseyPreview);
    const mouseyActions = el("div", "la-icon-settings-actions");
    const mouseyPickBtn = el("button", "la-btn la-btn-primary", "Choose image...") as HTMLButtonElement;
    const mouseyResetBtn = el("button", "la-btn la-btn-danger", "Reset to default") as HTMLButtonElement;
    mouseyActions.append(mouseyPickBtn, mouseyResetBtn);
    wrap.appendChild(mouseyActions);

    mouseyPickBtn.addEventListener("click", async () => {
      status.textContent = "";
      status.classList.remove("is-error");
      try {
        const files = await ctx.uploads.pickFile({
          accept: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"],
          multiple: false,
          maxSizeBytes: MAX_MOUSEY_BYTES,
        });
        if (files.length === 0) return;
        const file = files[0]!;
        if (file.sizeBytes > MAX_MOUSEY_BYTES) {
          status.textContent = `Image too large (${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB). Max 4 MB.`;
          status.classList.add("is-error");
          return;
        }
        const dataUrl = readImageAsDataUrl(file.bytes, file.mimeType || "image/png");
        try { localStorage.setItem(MOUSEY_STORAGE_KEY, dataUrl); } catch { /* localStorage unavailable */ }
        mouseyImgPreview.src = dataUrl;
        mouseyCaption.textContent = "Selected (reload to apply)";
        // Live-update the actual sitting image on the composer for instant gratification.
        mouseyImg.src = dataUrl;
        status.textContent = "Sitting image saved. Reload to apply across the rest of the drawer.";
      } catch (err) {
        status.textContent = `Failed: ${(err as Error).message}`;
        status.classList.add("is-error");
      }
    });
    mouseyResetBtn.addEventListener("click", () => {
      try { localStorage.removeItem(MOUSEY_STORAGE_KEY); } catch { /* localStorage unavailable */ }
      mouseyImgPreview.src = MOUSEY_SITTING_DATA_URL;
      mouseyCaption.textContent = "Default (reload to apply)";
      mouseyImg.src = MOUSEY_SITTING_DATA_URL;
      status.textContent = "Sitting image reset. Reload to apply.";
      status.classList.remove("is-error");
    });

    wrap.appendChild(status);
    handle.root.appendChild(wrap);
  };

  const appendUserMessage = (text: string): ChatUserMessage => {
    const msg: ChatUserMessage = {
      id: makeId("msg"),
      role: "user",
      ts: Date.now(),
      content: text,
    };
    state.messages.push(msg);
    if (state.messages.length === 1 && thread.contains(emptyState)) thread.removeChild(emptyState);
    virtualizer.setCount();
    virtualizer.scrollToBottom();
    return msg;
  };

  const dispatchSendForExisting = (sessionId: string, messageId: string, text: string): void => {
    dlog("dispatchSendForExisting (LLM call)", { sessionId, messageId, textLen: text.length });
    sendBackend(withConnection({
      type: "send_message",
      sessionId,
      userMessageId: messageId,
      content: text,
    }));
    state.isGenerating = true;
    updateComposer();
  };

  const clearStartTimeout = (): void => {
    if (state.startSessionTimeout !== null) {
      clearTimeout(state.startSessionTimeout);
      state.startSessionTimeout = null;
    }
  };

  const doSend = (): void => {
    const text = textarea.value.trim();
    if (state.isGenerating || state.startingSession) return;

    // Empty send: resume the existing turn if the last message is the user's
    // own (the agent hasn't replied yet). Bail silently otherwise — the
    // button should already be greyed out via updateComposer in that case.
    if (text.length === 0) {
      const last = state.messages[state.messages.length - 1];
      const canContinue = !!last && last.role === "user" && !!state.sessionId;
      if (!canContinue) return;
      composerStatus.classList.remove("is-error");
      sendBackend(withConnection({
        type: "continue_session",
        sessionId: state.sessionId!,
      }));
      state.isGenerating = true;
      updateComposer();
      return;
    }

    textarea.value = "";
    composerStatus.classList.remove("is-error");

    if (state.sessionId) {
      const msg = appendUserMessage(text);
      dispatchSendForExisting(state.sessionId, msg.id, text);
      return;
    }

    const sessionId = makeId("sess");
    state.sessionId = sessionId;
    state.messages = [];
    state.edits = [];
    state.startingSession = true;
    rerenderThread();
    const userMsg = appendUserMessage(text);
    state.pendingMessage = text;
    state.pendingMessageId = userMsg.id;
    updateSessionBar();
    updateComposer();
    sendBackend(withConnection({
      type: "start_session",
      sessionId,
      characterId: state.characterId,
    }));
    clearStartTimeout();
    state.startSessionTimeout = setTimeout(() => {
      if (!state.startingSession) return;
      state.startingSession = false;
      state.pendingMessage = null;
      state.pendingMessageId = null;
      state.startSessionTimeout = null;
      composerStatus.textContent = "Backend did not respond to start_session. Restart Lumiverse (start.ps1 -b) to pick up the new backend, then hard-refresh.";
      composerStatus.classList.add("is-error");
      updateComposer();
    }, 8000);
  };

  sendBtn.addEventListener("click", doSend);
  cancelBtn.addEventListener("click", () => {
    if (!state.sessionId) return;
    sendBackend({ type: "cancel_generation", sessionId: state.sessionId });
  });
  textarea.addEventListener("keydown", (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
      ev.preventDefault();
      doSend();
    }
  });

  // Returns the id of the user message that's currently the rolling cache
  // anchor (2 user-turns behind the latest). Anthropic-only gate on
  // cacheMode, because that setting only governs cache_control marker
  // stamping. Other providers (OpenAI, DeepSeek, Gemini, OpenRouter routes
  // to them) auto-cache the prompt prefix upstream regardless, so the
  // visual cue should still appear.
  const rollingAnchorId = (): string | null => {
    const conn = state.connections.find((c) => c.id === state.connectionId);
    const isAnthropic = (conn?.provider ?? "").toLowerCase().startsWith("anthropic");
    if (isAnthropic && (state.settings?.cacheMode ?? "full") !== "full") return null;
    const userMsgs = state.messages.filter((m) => m.role === "user");
    if (userMsgs.length <= 2) return null;
    return userMsgs[userMsgs.length - 1 - 2]?.id ?? null;
  };

  const isCacheInvalidating = (targetMessageId: string): boolean => {
    const anchorId = rollingAnchorId();
    if (!anchorId) return false;
    const anchorIdx = state.messages.findIndex((m) => m.id === anchorId);
    const targetIdx = state.messages.findIndex((m) => m.id === targetMessageId);
    if (anchorIdx < 0 || targetIdx < 0) return false;
    return targetIdx <= anchorIdx;
  };

  const findAssistantMessageIdForCallId = (callId: string): string | null => {
    for (const m of state.messages) {
      if (m.role !== "assistant") continue;
      for (const b of m.blocks) {
        if (b.type === "tool" && b.call_id === callId) return m.id;
      }
    }
    return null;
  };

  // Loading is rendered inside the streaming bubble. The bubble's own
  // setLoading mounts the indicator at the bubble's tail and re-appends it
  // after every content event, so visual position always tracks the
  // current end-of-stream rather than floating outside the virtualizer.
  const hideLoading = (): void => {
    if (!state.loading) return;
    state.loading = false;
    state.streamingAssistant?.setLoading(false);
  };

  // Build a fresh streaming bubble + handle keyed by `id`. Caller owns the
  // decision of whether `id` is backend-provided (turn_started) or local
  // (token/reasoning/tool fired before turn_started arrived).
  const createStreamingTurn = (id: string): AssistantHandle => {
    const assistant: ChatAssistantMessage = {
      id,
      role: "assistant",
      ts: Date.now(),
      turn: 0,
      blocks: [],
      status: "streaming",
    };
    state.messages.push(assistant);
    state.currentAssistantMessage = assistant;
    const handle = createStreamingAssistant({
      onRevertEdit: async (editId: string) => {
        if (!state.characterId) return;
        sendBackend({ type: "revert_edit", characterId: state.characterId, editId });
      },
      onOpenDiffModal: (eid?: string) => openDiffs(eid),
    });
    state.streamingAssistant = handle;
    virtualizer.setCount();
    virtualizer.scrollToBottom();
    handle.setLoading(true);
    state.loading = true;
    return handle;
  };

  // Re-attach currentAssistantMessage when the streaming handle is still live
  // but the message pointer was cleared, so block-mutation events don't
  // silently no-op into a missing reference and desync from the live bubble.
  const rebindCurrentAssistantMessage = (): void => {
    if (state.currentAssistantMessage || !state.streamingAssistant) return;
    // A live handle proves a turn is in flight, so the message it backs is
    // the last assistant message regardless of its status field. Binding
    // only to status==="streaming" left token/tool events writing to the
    // DOM handle but not the message model when the status had already been
    // flipped, so the post-finalize static rerender drew an empty bubble.
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const m = state.messages[i];
      if (m && m.role === "assistant") {
        state.currentAssistantMessage = m;
        return;
      }
    }
  };

  // turn_started entry point. Adopts the backend's assistantMessageId so
  // regenerate / edit lookups match server-side records.
  const adoptStreamingTurn = (assistantMessageId: string): AssistantHandle => {
    if (state.streamingAssistant) { rebindCurrentAssistantMessage(); return state.streamingAssistant; }
    return createStreamingTurn(assistantMessageId);
  };

  // Token / reasoning / tool entry point. Gets the existing handle, or
  // synthesizes one with a local id when an event raced ahead of turn_started.
  const ensureStreamingTurn = (): AssistantHandle => {
    if (state.streamingAssistant) { rebindCurrentAssistantMessage(); return state.streamingAssistant; }
    return createStreamingTurn(makeId("msg"));
  };

  const finalizeAssistantTurn = (status: ChatAssistantMessage["status"]) => {
    hideLoading();
    const handle = state.streamingAssistant;
    if (!handle) return;
    // Recover the message pointer if it was cleared mid-stream. Bailing here
    // used to leave the turn half-finalized: the handle's DOM had the streamed
    // content but the message stayed status="streaming" with whatever blocks
    // it had, and the next rerenderThread drew it from the (possibly empty)
    // model instead of the live DOM, so the whole response vanished until a
    // reload rebuilt it from the backend-persisted session.
    rebindCurrentAssistantMessage();
    const msg = state.currentAssistantMessage;
    handle.setStatus(status);
    if (msg) msg.status = status;
    state.streamingAssistant = null;
    state.currentAssistantMessage = null;
  };

  const agentEventCtx: AgentEventCtx = {
    state,
    adoptStreamingTurn,
    ensureStreamingTurn,
    rebindCurrentAssistantMessage,
    finalizeAssistantTurn,
    rerenderThread,
    updateSessionBar,
    clearErrorBanners,
  };

  ctx.onBackendMessage((raw) => {
    const msg = raw as BackendToFrontend;
    switch (msg.type) {
      case "characters_pushed":
        state.characters = [...msg.characters];
        renderCharOptions();
        break;
      case "connections_pushed":
        state.connections = [...msg.connections];
        renderConnOptions();
        break;
      case "sessions_pushed":
        state.sessions = [...msg.sessions];
        for (const h of pushSessionsListeners.handlers) h();
        break;
      case "session_started":
        clearStartTimeout();
        dlog("session_started received", { sessionId: msg.sessionId, characterId: msg.characterId, pendingPinChatId: state.pendingPinChatId, pendingMessage: state.pendingMessage, pendingMessageId: state.pendingMessageId });
        state.sessionId = msg.sessionId;
        state.characterId = msg.characterId;
        state.characterName = msg.characterName;
        state.startingSession = false;
        persistUiPrefs();
        if (msg.characterId !== null) sendBackend({ type: "list_character_edits", characterId: msg.characterId });
        // Flush a queued pin (from the chat picker auto-start flow).
        if (state.pendingPinChatId !== undefined && state.pendingPinChatId !== null) {
          dlog("session_started: flushing queued pin", { sessionId: msg.sessionId, chatId: state.pendingPinChatId });
          sendBackend({ type: "set_pinned_chat", sessionId: msg.sessionId, chatId: state.pendingPinChatId });
          state.pendingPinChatId = null;
        } else if (state.pendingPinChatId === null) {
          // Was explicitly "unpin" — clear pending flag.
          state.pendingPinChatId = null;
        }
        // If we got here from the auto-start flow, the user message is already
        // in state.messages and the thread. Keep them and just send the queued
        // message. Otherwise (manual + New chat with no pending), reset thread.
        if (state.pendingMessage !== null && state.pendingMessageId !== null) {
          const text = state.pendingMessage;
          const id = state.pendingMessageId;
          state.pendingMessage = null;
          state.pendingMessageId = null;
          dlog("session_started: dispatching queued message (this triggers an LLM call)", { sessionId: msg.sessionId, messageId: id, textLen: text.length });
          updateSessionBar();
          dispatchSendForExisting(msg.sessionId, id, text);
        } else {
          state.messages = [];
          state.edits = [];
          render();
        }
        break;
      case "session_loaded":
        clearErrorBanners();
        state.sessionId = msg.sessionId;
        state.characterId = msg.characterId;
        state.characterName = msg.characterName;
        state.messages = [...msg.messages];
        state.edits = [...msg.edits];
        if (msg.characterId === null) charCombo.setValue(NO_CHARACTER_SENTINEL, true);
        else if (state.characters.some((c) => c.id === msg.characterId)) charCombo.setValue(msg.characterId, true);
        render();
        // Default to the latest message on every session open. The
        // virtualizer's sticky-bottom check would otherwise compare against
        // the prior session's scrollTop.
        virtualizer.scrollToBottom();
        persistUiPrefs();
        if (msg.characterId !== null) {
          sendBackend({ type: "list_character_edits", characterId: msg.characterId });
          sendBackend({ type: "list_chats", characterId: msg.characterId, sessionId: msg.sessionId });
        }
        break;
      case "session_deleted":
        if (state.sessionId === msg.sessionId) {
          state.sessionId = null;
          state.messages = [];
          state.edits = [];
          render();
          persistUiPrefs();
        }
        sendBackend({ type: "list_sessions" });
        break;
      case "session_markdown_ready": {
        const blob = new Blob([msg.content], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = msg.filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoke after a tick so the browser's save dialog has time to start.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        break;
      }
      case "session_markdown_error":
        composerStatus.textContent = `Export failed: ${msg.error}`;
        break;
      case "session_reverted":
        composerStatus.textContent = `Session reverted: ${msg.entriesRestored} entries, ${msg.scriptsRestored} scripts. ${msg.entriesFailed + msg.scriptsFailed} failed.`;
        for (const e of state.edits) (e as { reverted: boolean }).reverted = true;
        rerenderThread();
        updateSessionBar();
        if (state.diffModal) state.diffModal.setEdits(state.edits);
        break;
      case "chat_event":
        handleAgentEvent(msg.event, agentEventCtx);
        break;
      case "generation_done":
        state.isGenerating = false;
        finalizeAssistantTurn("complete");
        rerenderThread();
        updateComposer();
        break;
      case "generation_cancelled":
        state.isGenerating = false;
        finalizeAssistantTurn("cancelled");
        rerenderThread();
        updateComposer();
        break;
      case "generation_error":
        clearStartTimeout();
        state.isGenerating = false;
        state.startingSession = false;
        state.pendingMessage = null;
        state.pendingMessageId = null;
        finalizeAssistantTurn("errored");
        // Rerender so the errored assistant message gets the Regenerate
        // button via renderAssistantBubble (status === "errored" qualifies).
        rerenderThread();
        // Loud inline error block in the thread so the user can't miss it.
        // Cleared on the next turn_started, on session switch, or manually
        // via the dismiss button.
        const errBlock = el("div", "la-error-banner");
        const errHeader = el("div", "la-error-banner-header");
        const errTitle = el("div", "la-error-banner-title", "Generation failed");
        const errDismiss = el("button", "la-error-banner-dismiss", "✕") as HTMLButtonElement;
        errDismiss.setAttribute("aria-label", "Dismiss error");
        errDismiss.title = "Dismiss";
        errDismiss.addEventListener("click", () => { errBlock.remove(); });
        errHeader.append(errTitle, errDismiss);
        const errBody = el("pre", "la-error-banner-body", msg.error);
        errBlock.append(errHeader, errBody);
        // Banners sit below the virtualizer's spacer at the end of the
        // scroll container, outside the virtualized list.
        thread.appendChild(errBlock);
        virtualizer.scrollToBottom();
        composerStatus.textContent = "";
        composerStatus.classList.remove("is-error");
        updateComposer();
        break;
      case "edit_reverted":
        handleRevertOutcome(msg.editId, msg.outcome);
        break;
      case "edits_reverted_bulk": {
        const removed = new Set<string>();
        let okCount = 0; let cascadeCount = 0; let failed = 0;
        for (const { editId, outcome } of msg.outcomes) {
          if (outcome.kind === "clean" || outcome.kind === "noop_already_reverted") {
            removed.add(editId);
            okCount++;
            if (outcome.kind === "clean" && outcome.cascadedEditIds) {
              for (const id of outcome.cascadedEditIds) removed.add(id);
              cascadeCount += outcome.cascadedEditIds.length;
            }
          } else if (outcome.kind === "failed") {
            failed++;
          }
        }
        spliceEntries(removed);
        rerenderThread();
        updateSessionBar();
        if (state.diffModal) state.diffModal.setEdits(scopeEntries(workshopScope()));
        const parts: string[] = [];
        if (okCount > 0) parts.push(`Reverted ${okCount} edit${okCount === 1 ? "" : "s"}`);
        if (cascadeCount > 0) parts.push(`+${cascadeCount} cascaded`);
        if (failed > 0) parts.push(`${failed} failed`);
        composerStatus.textContent = parts.join(", ");
        composerStatus.classList.toggle("is-error", failed > 0);
        break;
      }
      case "scope_edits_pushed": {
        // Authoritative snapshot for exactly one scope. Replace its slot,
        // refresh the badge, and only re-render the modal if it is currently
        // showing this scope (a background push for another scope must not
        // yank the view the user is looking at).
        state.scopeLedgers.set(scopeKeyString(msg.scope), [...msg.entries]);
        updateSessionBar();
        const shown = workshopScope();
        if (state.diffModal && shown && scopeKeyString(shown) === scopeKeyString(msg.scope)) {
          state.diffModal.setEdits(msg.entries);
        }
        break;
      }
      case "session_truncated":
        state.messages = [...msg.messages];
        state.edits = [...msg.edits];
        rerenderThread();
        virtualizer.scrollToBottom();
        updateSessionBar();
        updateComposer();
        if (state.characterId) sendBackend({ type: "list_character_edits", characterId: state.characterId });
        break;
      case "chats_pushed":
        dlog("chats_pushed received", { msgCharacterId: msg.characterId, stateCharacterId: state.characterId, pinnedChatId: msg.pinnedChatId, chatCount: msg.chats.length, applies: state.characterId === msg.characterId });
        if (state.characterId === msg.characterId) {
          state.chatsForCharacter = [...msg.chats];
          state.pinnedChatId = msg.pinnedChatId;
          setChatPinned(msg.pinnedChatId !== null);
          if (state.autoPinNeeded && msg.pinnedChatId === null && msg.chats.length > 0) {
            state.autoPinNeeded = false;
            const newestId = msg.chats[0]!.id;
            if (state.sessionId) sendBackend({ type: "set_pinned_chat", sessionId: state.sessionId, chatId: newestId });
            else state.pendingPinChatId = newestId;
          }
          for (const h of pushChatsListeners.handlers) h();
        }
        break;
      case "pinned_chat_set":
        dlog("pinned_chat_set received", { sessionId: msg.sessionId, chatId: msg.chatId, stateSessionId: state.sessionId, stateCharacterId: state.characterId });
        // Gate on session match, a stale message from another session would otherwise light the pin icon falsely.
        if (msg.sessionId === state.sessionId) {
          state.pinnedChatId = msg.chatId;
          setChatPinned(msg.chatId !== null);
        }
        if (state.characterId) sendBackend({ type: "list_chats", characterId: state.characterId, sessionId: msg.sessionId });
        break;
      case "settings_pushed":
        state.settings = {
          persona: msg.persona,
          systemPromptOverride: msg.systemPromptOverride,
          defaultPersona: msg.defaultPersona,
          defaultSystemPromptBody: msg.defaultSystemPromptBody,
          samplers: msg.samplers,
          jailbreak: msg.jailbreak,
          jailbreakPlacement: msg.jailbreakPlacement,
          workspaceCapBytes: msg.workspaceCapBytes,
          workspaceCapDefaultBytes: msg.workspaceCapDefaultBytes,
          workspaceFileCapBytes: msg.workspaceFileCapBytes,
          toolOutputCapTokens: msg.toolOutputCapTokens,
          toolOutputCapDefaultTokens: msg.toolOutputCapDefaultTokens,
          cacheMode: msg.cacheMode,
          parallelToolCalls: msg.parallelToolCalls,
        };
        for (const h of settingsListeners.handlers) h();
        break;
      case "phoneline_pairings_pushed":
        for (const h of pairingsListeners.handlers) h(msg.pairings);
        break;
      case "ui_prefs_pushed":
        // Apply the stored selection once it arrives from the backend.
        // renderConnOptions has its own current-value / default fallback,
        // so if connections were already pushed we just re-render to pick up
        // the resolved id without churning the dropdown.
        state.connectionId = msg.connectionId;
        if (state.connections.length > 0) renderConnOptions();
        // Restore the last-open session if the user doesn't already have one
        // mounted. If the session file is gone the backend will log a warning
        // and we stay in fresh state.
        if (msg.lastSessionId && !state.sessionId && !state.startingSession) {
          sendBackend({ type: "load_session", sessionId: msg.lastSessionId });
        }
        break;
      case "ws_listed":
        state.workspacePanel?.onListed(msg.path, msg.entries);
        break;
      case "ws_text_pushed":
        state.workspacePanel?.onTextPushed(msg.path, msg.content, msg.sizeBytes);
        break;
      case "ws_changed":
        state.workspacePanel?.onChanged();
        break;
      case "ws_download_ready":
        state.workspacePanel?.onDownloadReady(msg.path, msg.dataBase64, msg.mimeType);
        break;
      case "ws_zip_ready":
        state.workspacePanel?.onZipReady(msg.dataBase64, msg.filename);
        break;
      case "ws_error":
        state.workspacePanel?.onError(msg.error);
        break;
      case "context_usage":
        if (msg.sessionId === state.sessionId) {
          state.contextPromptTokens = msg.promptTokens;
          state.contextTokens = msg.contextTokens;
          updateCompactButton();
        }
        break;
      case "compaction_started":
        if (msg.sessionId === state.sessionId) {
          state.compacting = true;
          updateCompactButton();
        }
        break;
      case "compaction_completed":
        if (msg.sessionId === state.sessionId) {
          state.compacting = false;
          state.contextPromptTokens = msg.promptTokens;
          state.contextTokens = msg.contextTokens;
          updateCompactButton();
          // Reload the session so the user sees the inline compaction marker
          // that the backend appended.
          sendBackend({ type: "load_session", sessionId: msg.sessionId });
        }
        break;
      case "characters_storage_pushed": {
        // Scope list for the workshop combo only. The badge is NOT touched
        // here: it is a pure projection of scopeLedgers, refreshed by the
        // authoritative scope_edits_pushed the backend sends alongside this.
        state.scopeStorage = msg.entries;
        state.diffModal?.setScopes(buildScopeOptions());
        break;
      }
      case "frontend_rpc_request": {
        // Backend asked us to do something only the browser can (currently:
        // run Chrome's on-device Translator API). Dispatch by op, post the
        // result (or error) back via frontend_rpc_response.
        void (async () => {
          try {
            let result: unknown;
            if (msg.op === "translate_batch") {
              const { handleTranslateBatch } = await import("./translator-bridge");
              result = await handleTranslateBatch(msg.args);
            } else if (msg.op === "ask_user_question") {
              const { showAskUserQuestion } = await import("./ask-user-modal");
              result = await showAskUserQuestion(msg.args as Parameters<typeof showAskUserQuestion>[0]);
            } else {
              sendBackend({ type: "frontend_rpc_response", rpcId: msg.rpcId, error: `unknown rpc op '${msg.op}'` });
              return;
            }
            sendBackend({ type: "frontend_rpc_response", rpcId: msg.rpcId, result });
          } catch (err) {
            sendBackend({ type: "frontend_rpc_response", rpcId: msg.rpcId, error: (err as Error).message });
          }
        })();
        break;
      }
      case "scope_squashed": {
        // The scope's ledger was cleared. Drop its cached slot; if the combo
        // was focused on it, fall back to the active scope.
        const key = scopeKeyString(msg.scope);
        state.scopeLedgers.set(key, []);
        if (state.workshopFocusScope && scopeKeyString(state.workshopFocusScope) === key) {
          state.workshopFocusScope = null;
        }
        if (activeScope() && scopeKeyString(activeScope()!) === key) {
          state.edits = state.edits.map((e) => ({ ...e, reverted: true }));
          rerenderThread();
        }
        updateSessionBar();
        if (state.diffModal) state.diffModal.setEdits(scopeEntries(workshopScope()));
        break;
      }
    }
  });

  render();
  refreshLists();

  const adoptActiveChat = (): void => {
    // Don't fight a restored / loaded session: if the user has one open, its
    // character is the source of truth even when the host navigates to a chat
    // for a different character.
    if (state.sessionId || state.startingSession) return;
    const active = ctx.getActiveChat();
    if (!active.characterId) return;
    if (state.characterId === active.characterId) return;
    state.characterId = active.characterId;
    charCombo.setValue(active.characterId, true);
    updateSessionBar();
    updateComposer();
    sendBackend({ type: "list_character_edits", characterId: active.characterId });
  };
  adoptActiveChat();
  const offChatSwitched = ctx.events.on("CHAT_SWITCHED", () => adoptActiveChat());

  const off = tab.onActivate(() => {
    refreshLists();
    adoptActiveChat();
    if (state.sessionId) sendBackend({ type: "load_session", sessionId: state.sessionId });
    else if (state.characterId) sendBackend({ type: "list_character_edits", characterId: state.characterId });
  });

  return () => {
    off();
    offChatSwitched();
    charCombo.destroy();
    removeStyle();
    tab.destroy();
  };
}
