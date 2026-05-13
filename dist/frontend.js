var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// src/ui/translator-bridge.ts
var exports_translator_bridge = {};
__export(exports_translator_bridge, {
  handleTranslateBatch: () => handleTranslateBatch
});
function pickTranslatorFactory() {
  const w = globalThis;
  if (w.Translator?.create)
    return w.Translator;
  if (w.ai?.translator?.create)
    return w.ai.translator;
  if (w.translation?.createTranslator) {
    return {
      create: async (opts) => {
        const t = await w.translation.createTranslator(opts);
        return t;
      }
    };
  }
  return null;
}
function getTranslator(factory, source, target) {
  const key = `${source}->${target}`;
  let p = translatorCache.get(key);
  if (!p) {
    p = factory.create({ sourceLanguage: source, targetLanguage: target });
    translatorCache.set(key, p);
  }
  return p;
}
async function translateHtml(html, t) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let cur = walker.nextNode();
  while (cur) {
    nodes.push(cur);
    cur = walker.nextNode();
  }
  for (const n of nodes) {
    const raw = n.nodeValue ?? "";
    if (raw.trim().length === 0)
      continue;
    try {
      const tr = await t.translate(raw);
      n.nodeValue = tr;
    } catch {}
  }
  return doc.body.innerHTML;
}
async function translateLua(code, t) {
  const matches = [];
  for (const m of code.matchAll(LUA_STRING_RX)) {
    const start = m.index ?? 0;
    const raw = m[0];
    const inner = m[1] ?? m[2] ?? "";
    matches.push({ start, end: start + raw.length, raw, quote: raw.charAt(0), inner });
  }
  if (matches.length === 0)
    return code;
  const translatedInners = new Map;
  for (const m of matches) {
    if (translatedInners.has(m.inner))
      continue;
    if (m.inner.trim().length === 0) {
      translatedInners.set(m.inner, m.inner);
      continue;
    }
    try {
      translatedInners.set(m.inner, await t.translate(m.inner));
    } catch {
      translatedInners.set(m.inner, m.inner);
    }
  }
  let out = "";
  let cursor = 0;
  for (const m of matches) {
    out += code.slice(cursor, m.start);
    const translated = translatedInners.get(m.inner) ?? m.inner;
    out += `${m.quote}${translated.replace(/\\/g, "\\\\").replace(m.quote === '"' ? /"/g : /'/g, "\\" + m.quote)}${m.quote}`;
    cursor = m.end;
  }
  out += code.slice(cursor);
  return out;
}
async function handleTranslateBatch(args) {
  const { items, source_lang, target_lang } = args;
  const factory = pickTranslatorFactory();
  if (!factory)
    return { translated: [], capabilityError: "Translator API not exposed by this browser (needs Chrome desktop with on-device translator)." };
  let translator;
  try {
    translator = await getTranslator(factory, source_lang, target_lang);
  } catch (err) {
    return { translated: [], capabilityError: `Translator init failed (${source_lang}→${target_lang}): ${err.message}` };
  }
  const out = [];
  for (const it of items) {
    try {
      if (it.kind === "plain") {
        out.push({ id: it.id, text: await translator.translate(it.text) });
      } else if (it.kind === "html") {
        out.push({ id: it.id, text: await translateHtml(it.text, translator) });
      } else if (it.kind === "lua") {
        out.push({ id: it.id, text: await translateLua(it.text, translator) });
      } else {
        out.push({ id: it.id, error: `unknown kind '${it.kind}'` });
      }
    } catch (err) {
      out.push({ id: it.id, error: err.message });
    }
  }
  return { translated: out };
}
var translatorCache, LUA_STRING_RX;
var init_translator_bridge = __esm(() => {
  translatorCache = new Map;
  LUA_STRING_RX = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/g;
});

// src/ui/ask-user-modal.ts
var exports_ask_user_modal = {};
__export(exports_ask_user_modal, {
  showAskUserQuestion: () => showAskUserQuestion
});
function el7(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls)
    e.className = cls;
  if (text !== undefined)
    e.textContent = text;
  return e;
}
function showAskUserQuestion(input) {
  return new Promise((resolve) => {
    const overlay = el7("div", "la-modal-overlay la-ask-overlay");
    const modal = el7("div", "la-modal la-ask-modal");
    overlay.appendChild(modal);
    const selections = new Map;
    const otherText = new Map;
    const previewBoxes = new Map;
    const header = el7("div", "la-ask-header");
    header.appendChild(el7("div", "la-ask-title", "Pick an option"));
    const subtitle = el7("div", "la-ask-subtitle", `The agent paused with ${input.questions.length} question${input.questions.length === 1 ? "" : "s"}.`);
    header.appendChild(subtitle);
    modal.appendChild(header);
    const body = el7("div", "la-ask-body");
    modal.appendChild(body);
    for (const q of input.questions) {
      const card = el7("div", "la-ask-question");
      const head = el7("div", "la-ask-question-head");
      head.appendChild(el7("span", "la-ask-chip", q.header));
      head.appendChild(el7("span", "la-ask-question-text", q.question));
      if (q.multiSelect)
        head.appendChild(el7("span", "la-ask-multi-badge", "multi-select"));
      card.appendChild(head);
      const optionsWrap = el7("div", "la-ask-options" + (q.multiSelect ? " is-multi" : ""));
      const allOptions = [
        ...q.options,
        { label: OTHER_LABEL, description: "Type a custom answer.", preview: "" }
      ];
      const inputs = [];
      const otherInput = el7("textarea");
      otherInput.className = "la-ask-other-input";
      otherInput.placeholder = "Type a custom answer...";
      otherInput.rows = 2;
      otherInput.style.display = "none";
      otherInput.addEventListener("input", () => {
        otherText.set(q.question, otherInput.value);
      });
      for (let i = 0;i < allOptions.length; i++) {
        const opt = allOptions[i];
        const row = el7("label", "la-ask-option");
        const inputEl = document.createElement("input");
        inputEl.type = q.multiSelect ? "checkbox" : "radio";
        inputEl.name = `q-${input.questions.indexOf(q)}`;
        inputEl.value = opt.label;
        row.appendChild(inputEl);
        inputs.push(inputEl);
        const text = el7("div", "la-ask-option-text");
        text.appendChild(el7("div", "la-ask-option-label", opt.label));
        if (opt.description)
          text.appendChild(el7("div", "la-ask-option-desc", opt.description));
        row.appendChild(text);
        inputEl.addEventListener("change", () => {
          if (q.multiSelect) {
            const set = selections.get(q.question) ?? new Set;
            if (inputEl.checked)
              set.add(opt.label);
            else
              set.delete(opt.label);
            selections.set(q.question, set);
            if (opt.label === OTHER_LABEL)
              otherInput.style.display = inputEl.checked ? "" : "none";
          } else {
            selections.set(q.question, opt.label);
            otherInput.style.display = opt.label === OTHER_LABEL ? "" : "none";
          }
          const previewBox = previewBoxes.get(q.question);
          if (previewBox) {
            previewBox.textContent = opt.preview ?? "";
            previewBox.style.display = opt.preview ? "" : "none";
          }
        });
        row.addEventListener("mouseenter", () => {
          const previewBox = previewBoxes.get(q.question);
          if (!previewBox)
            return;
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
        const previewBox = el7("pre", "la-ask-preview");
        previewBox.style.display = "none";
        previewBoxes.set(q.question, previewBox);
        card.appendChild(previewBox);
      }
      body.appendChild(card);
    }
    const footer = el7("div", "la-ask-footer");
    const cancelBtn = el7("button", "la-btn la-btn-ghost", "Cancel");
    const submitBtn = el7("button", "la-btn la-btn-primary", "Submit");
    cancelBtn.type = "button";
    submitBtn.type = "button";
    footer.append(cancelBtn, submitBtn);
    modal.appendChild(footer);
    const finish = (result) => {
      window.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(result);
    };
    const onKey = (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish({ cancelled: true });
      }
    };
    window.addEventListener("keydown", onKey);
    cancelBtn.addEventListener("click", () => finish({ cancelled: true }));
    submitBtn.addEventListener("click", () => {
      const answers = {};
      const notes = {};
      for (const q of input.questions) {
        const raw = selections.get(q.question);
        if (raw === undefined || raw instanceof Set && raw.size === 0) {
          finish({ cancelled: true });
          return;
        }
        let answer;
        if (raw instanceof Set) {
          const parts = [];
          for (const label of raw) {
            if (label === OTHER_LABEL) {
              const txt = (otherText.get(q.question) ?? "").trim();
              if (txt)
                parts.push(txt);
            } else {
              parts.push(label);
            }
          }
          if (parts.length === 0) {
            finish({ cancelled: true });
            return;
          }
          answer = parts.join(", ");
        } else if (raw === OTHER_LABEL) {
          const txt = (otherText.get(q.question) ?? "").trim();
          if (!txt) {
            finish({ cancelled: true });
            return;
          }
          answer = txt;
          notes[q.question] = "custom answer";
        } else {
          answer = raw;
        }
        answers[q.question] = answer;
      }
      finish({ cancelled: false, answers, notes });
    });
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay)
        finish({ cancelled: true });
    });
    document.body.appendChild(overlay);
  });
}
var OTHER_LABEL = "Other";

// src/ui/loaders.ts
var LOADER_VARIANTS = [
  "la-ld-1",
  "la-ld-2",
  "la-ld-4",
  "la-ld-5",
  "la-ld-6",
  "la-ld-7",
  "la-ld-8",
  "la-ld-9",
  "la-ld-10",
  "la-ld-11",
  "la-ld-12",
  "la-ld-13",
  "la-ld-14",
  "la-ld-15"
];
function pickLoaderVariant() {
  return LOADER_VARIANTS[Math.floor(Math.random() * LOADER_VARIANTS.length)];
}
var LOADERS_CSS = `
.la-ld {
  display: inline-block;
  vertical-align: middle;
  margin-right: 8px;
  flex-shrink: 0;
}

/* L1 — kiln bricks (35x80, tall) */
.la-ld-1 {
  zoom: 0.18;
  width: 35px;
  height: 80px;
  position: relative;
}
.la-ld-1:before {
  content: "";
  position: absolute;
  inset: 0 0 20px;
  padding: 1px;
  background:
    conic-gradient(from -90deg at calc(100% - 3px) 3px, var(--lumiverse-primary) 135deg, var(--lumiverse-primary-muted) 0 270deg, #0000 0),
    conic-gradient(from   0deg at 3px calc(100% - 3px), #0000 90deg, var(--lumiverse-primary-muted) 0 225deg, var(--lumiverse-primary) 0),
    var(--lumiverse-bg-deep);
  background-size: 17px 17px;
  background-clip: content-box;
  --c:no-repeat linear-gradient(#000 0 0);
  -webkit-mask:
      var(--c) 0    0,
      var(--c) 17px 0,
      var(--c) 0    17px,
      var(--c) 17px 17px,
      var(--c) 0    34px,
      var(--c) 17px 34px,
      linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;
          mask-composite:exclude;
  animation: la-ldk-1 3s infinite;
}
.la-ld-1:after {
  content: "";
  position: absolute;
  inset: 60% 0 0;
  background: var(--lumiverse-primary-text);
  border-top: 5px solid var(--lumiverse-border);
}
@keyframes la-ldk-1 {
  0%,14%  {-webkit-mask-size: 0 0,0 0,0 0,0 0,0 0,0 0,auto}
  15%,29% {-webkit-mask-size: 17px 17px,0 0,0 0,0 0,0 0,0 0,auto}
  30%,44% {-webkit-mask-size: 17px 17px,17px 17px,0 0,0 0,0 0,0 0,auto}
  45%,59% {-webkit-mask-size: 17px 17px,17px 17px,17px 17px,0 0,0 0,0 0,auto}
  60%,74% {-webkit-mask-size: 17px 17px,17px 17px,17px 17px,17px 17px,0 0,0 0,auto}
  75%,89% {-webkit-mask-size: 17px 17px,17px 17px,17px 17px,17px 17px,17px 17px,0 0,auto}
  90%,100% {-webkit-mask-size: 17px 17px,17px 17px,17px 17px,17px 17px,17px 17px,17px 17px,auto}
}

/* L2 — rotating ellipse loops */
.la-ld-2 {
  zoom: 0.30;
  width: 25px;
  height: 50px;
  display: grid;
  color: var(--lumiverse-primary);
  background:
    linear-gradient(currentColor 0 0) top/100% 2px,
    radial-gradient(farthest-side at top, #0000 calc(100% - 2px),currentColor calc(100% - 1px) ,#0000) top,
    linear-gradient(currentColor 0 0) bottom/100% 2px,
    radial-gradient(farthest-side at bottom, #0000 calc(100% - 2px),currentColor calc(100% - 1px) ,#0000) bottom;
  background-size: 100% 1px,100% 50%;
  background-repeat: no-repeat;
  animation: la-ldk-2 4s infinite linear;
}
.la-ld-2::before, .la-ld-2::after {
  content: ""; grid-area: 1/1; background: inherit; border: inherit; animation: inherit;
}
.la-ld-2::after { animation-duration: 2s; }
@keyframes la-ldk-2 { 100% {transform: rotate(1turn)} }

/* L4 — chasing corner dots */
.la-ld-4 {
  zoom: 0.30;
  height: 40px;
  aspect-ratio: 1.5;
  --c: var(--lumiverse-primary) 96%,#0000;
  background:
    radial-gradient(farthest-side at 100% 100%,var(--c)),
    radial-gradient(farthest-side at 0    100%,var(--c)),
    radial-gradient(farthest-side at 100% 0   ,var(--c)),
    radial-gradient(farthest-side at 0    0   ,var(--c));
  background-size: 33.4% 50%;
  background-repeat: no-repeat;
  animation: la-ldk-4 2s infinite linear;
}
@keyframes la-ldk-4 {
  0%    {background-position:0 0,50% 0,0 100%,50% 100%}
  12.5% {background-position:0 0,100% 0,0 100%,50% 100%}
  25%   {background-position:50% 0,100% 0,0 100%,50% 100%}
  37.5% {background-position:50% 0,100% 0,0 100%,100% 100%}
  50%   {background-position:50% 0,100% 0,50% 100%,100% 100%}
  62.5% {background-position:0 0,100% 0,50% 100%,100% 100%}
  75%   {background-position:0 0,50% 0,50% 100%,100% 100%}
  87.5% {background-position:0 0,50% 0,0 100%,100% 100%}
  100%  {background-position:0 0,50% 0,0 100%,50% 100%}
}

/* L5 — yin-yang style sweep */
.la-ld-5 {
  zoom: 0.25;
  --r1: 154%;
  --r2: 68.5%;
  width: 60px;
  aspect-ratio: 1;
  border-radius: 50%;
  background:
    radial-gradient(var(--r1) var(--r2) at top   ,#0000 79.5%,var(--lumiverse-primary) 80%),
    radial-gradient(var(--r1) var(--r2) at bottom,var(--lumiverse-primary) 79.5%,#0000 80%),
    radial-gradient(var(--r1) var(--r2) at top   ,#0000 79.5%,var(--lumiverse-primary) 80%),
    var(--lumiverse-primary-muted);
  background-size: 50.5% 220%;
  background-position: -100% 0%,0% 0%,100% 0%;
  background-repeat:no-repeat;
  animation: la-ldk-5 2s infinite linear;
}
@keyframes la-ldk-5 {
  33%  {background-position:    0% 33% ,100% 33% ,200% 33% }
  66%  {background-position: -100%  66%,0%   66% ,100% 66% }
  100% {background-position:    0% 100%,100% 100%,200% 100%}
}

/* L6 — rotating plus */
.la-ld-6 {
  zoom: 0.30;
  width: 50px;
  aspect-ratio: 1;
  display: grid;
  color: var(--lumiverse-primary);
  background:
    linear-gradient(90deg,currentColor 2px,#0000 0 calc(100% - 2px),currentColor 0) center/100% 14px,
    linear-gradient(0deg, currentColor 2px,#0000 0 calc(100% - 2px),currentColor 0) center/14px 100%,
    linear-gradient(currentColor 0 0) center/100% 2px,
    linear-gradient(currentColor 0 0) center/2px 100%;
  background-repeat: no-repeat;
  animation: la-ldk-6 4s infinite linear;
}
.la-ld-6::before, .la-ld-6::after {
  content: ""; grid-area: 1/1; background: inherit; transform-origin: inherit; animation: inherit;
}
.la-ld-6::after { animation-duration: 2s; }
@keyframes la-ldk-6 { 100% {transform:rotate(1turn)} }

/* L7 — square+circle dual orbit */
.la-ld-7 {
  zoom: 0.22;
  width: 65px;
  aspect-ratio: 1;
  position: relative;
}
.la-ld-7:before, .la-ld-7:after {
  content: ""; position: absolute;
  border-radius: 50px;
  box-shadow: 0 0 0 3px inset var(--lumiverse-primary);
  animation: la-ldk-7 2.5s infinite;
}
.la-ld-7:after { animation-delay: -1.25s; border-radius: 0; }
@keyframes la-ldk-7 {
  0%    {inset:0    35px 35px 0   }
  12.5% {inset:0    35px 0    0   }
  25%   {inset:35px 35px 0    0   }
  37.5% {inset:35px 0    0    0   }
  50%   {inset:35px 0    0    35px}
  62.5% {inset:0    0    0    35px}
  75%   {inset:0    0    35px 35px}
  87.5% {inset:0    0    35px 0   }
  100%  {inset:0    35px 35px 0   }
}

/* L8 — wobbling face */
.la-ld-8 {
  zoom: 0.22;
  width: 50px;
  aspect-ratio: 1;
  color: var(--lumiverse-primary);
  border: 7px solid;
  box-sizing: border-box;
  border-radius: 50%;
  background:
    radial-gradient(circle 3px, var(--lumiverse-primary-text) 95%,#0000),
    linear-gradient(180deg,var(--lumiverse-primary-text) 50%,#0000 0) center/3px 70%,
    linear-gradient(90deg ,var(--lumiverse-primary-text) 50%,#0000 0) center/50% 3px;
  background-repeat: no-repeat;
  position: relative;
  animation: la-ldk-8 1s infinite;
}
.la-ld-8:before, .la-ld-8:after {
  content: ""; position: absolute;
  border-radius: 20px 20px 0 0;
  inset: -20px calc(50% - 10px);
  transform: rotate(40deg);
  background:
    linear-gradient(currentColor 0 0) top   /100% 10px,
    linear-gradient(currentColor 0 0) bottom/3px  10px;
  background-repeat: no-repeat;
}
.la-ld-8:after { transform: rotate(-40deg); }
@keyframes la-ldk-8 {
  0%,70%,100% {transform: translateY(0)    rotate(0)}
  75%,85%,95% {transform: translateY(-3px) rotate(10deg)}
  80%,90%     {transform: translateY(-3px) rotate(-10deg)}
}

/* L9 — four bouncing dots */
.la-ld-9 {
  zoom: 0.30;
  width: 60px;
  aspect-ratio: 2;
  --_g: no-repeat radial-gradient(farthest-side,var(--lumiverse-primary) 90%,#0000);
  background:
    var(--_g) 0    50%,
    var(--_g) 50%  50%,
    var(--_g) 50%  50%,
    var(--_g) 100% 50%;
  background-size: 25% 50%;
  animation: la-ldk-9 1s infinite linear;
}
@keyframes la-ldk-9 {
  33%  {background-position:0   0  ,50% 100%,50%  100%,100% 0}
  66%  {background-position:50% 0  ,0   100%,100% 100%,50%  0}
  100% {background-position:50% 50%,0   50% ,100% 50% ,50%  50%}
}

/* L10 — twin spinning eyes */
.la-ld-10 {
  zoom: 0.55;
  display: inline-flex;
  gap: 10px;
}
.la-ld-10:before, .la-ld-10:after {
  content: "";
  height: 20px;
  aspect-ratio: 1;
  border-radius: 50%;
  background:
    radial-gradient(farthest-side,var(--lumiverse-primary-contrast) 95%,#0000) 35% 35%/6px 6px no-repeat
    var(--lumiverse-primary);
  transform: scaleX(var(--s,1)) rotate(0deg);
  animation: la-ldk-10 1s infinite linear;
}
.la-ld-10:after { --s: -1; animation-delay:-0.1s; }
@keyframes la-ldk-10 { 100% {transform:scaleX(var(--s,1)) rotate(360deg);} }

/* L11 — ball bouncing across bars */
.la-ld-11 {
  zoom: 0.40;
  width: 40px;
  height: 30px;
  --c:no-repeat linear-gradient(var(--lumiverse-primary) 0 0);
  background:
    var(--c) 0    100%/8px 30px,
    var(--c) 50%  100%/8px 20px,
    var(--c) 100% 100%/8px 10px;
  position: relative;
  clip-path: inset(-100% 0);
}
.la-ld-11:before {
  content: "";
  position: absolute;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--lumiverse-primary);
  left: -16px;
  top: 0;
  animation:
    la-ldk-11a 2s   linear infinite,
    la-ldk-11b 0.5s cubic-bezier(0,200,.8,200) infinite;
}
@keyframes la-ldk-11a {
  0%   {left:-16px;transform:translateY(-8px)}
  100% {left:calc(100% + 8px);transform:translateY(22px)}
}
@keyframes la-ldk-11b { 100% {top:-0.1px} }

/* L12 — counting numbers */
.la-ld-12 {
  zoom: 0.18;
  display: inline-flex;
  border: 10px solid var(--lumiverse-primary);
  border-radius: 5px;
}
.la-ld-12::before, .la-ld-12::after {
  content: "0 1 2 3 4 5 6 7 8 9 0";
  font-size: 30px;
  font-family: monospace;
  font-weight: bold;
  line-height: 1em;
  height: 1em;
  width: 1.2ch;
  text-align: center;
  outline:1px solid var(--lumiverse-primary);
  color: #0000;
  text-shadow:0 0 0 var(--lumiverse-primary);
  overflow: hidden;
  animation: la-ldk-12 2s infinite linear;
}
.la-ld-12::before { animation-duration: 4s; }
@keyframes la-ldk-12 { 100% {text-shadow:0 var(--t,-10em) 0 var(--lumiverse-primary)} }

/* L13 — gooey morphing dots */
.la-ld-13 {
  zoom: 0.22;
  width: 80px;
  aspect-ratio: 1;
  border: 10px solid #0000;
  box-sizing: border-box;
  background:
    radial-gradient(farthest-side,var(--lumiverse-primary) 98%,#0000) 0    0/20px 20px,
    radial-gradient(farthest-side,var(--lumiverse-primary) 98%,#0000) 100% 0/20px 20px,
    radial-gradient(farthest-side,var(--lumiverse-primary) 98%,#0000) 100% 100%/20px 20px,
    radial-gradient(farthest-side,var(--lumiverse-primary) 98%,#0000) 0 100%/20px 20px,
    linear-gradient(var(--lumiverse-primary) 0 0) 50%/40px 40px,
    var(--lumiverse-bg-deep);
  background-repeat:no-repeat;
  filter: blur(4px) contrast(10);
  animation: la-ldk-13 0.8s infinite;
}
@keyframes la-ldk-13 { 100%  {background-position:100% 0,100% 100%,0 100%,0 0,center} }

/* L14 — figure-eight */
.la-ld-14 {
  zoom: 0.30;
  width: 60px;
  height: 30px;
  display: flex;
  --c:#0000 calc(100% - 5px),var(--lumiverse-primary) calc(100% - 4px) 96%,#0000;
  background:
    radial-gradient(farthest-side at bottom,var(--c)) 0 0,
    radial-gradient(farthest-side at top   ,var(--c)) 100% 100%;
  background-size:calc(50% + 2px) 50%;
  background-repeat: no-repeat;
  animation: la-ldk-14 2s infinite linear;
}
.la-ld-14:before { content: ""; flex: 1; background: inherit; transform: rotate(90deg); }
@keyframes la-ldk-14 { 100% {transform:rotate(1turn)} }

/* L15 — quadrant tile swap */
.la-ld-15 {
  zoom: 0.25;
  width: 60px;
  aspect-ratio: 1;
  background:
    linear-gradient(45deg,var(--lumiverse-primary) 50%,#0000 0),
    linear-gradient(45deg,#0000 50%,var(--lumiverse-primary) 0),
    linear-gradient(-45deg,var(--lumiverse-primary-text) 50%,#0000 0),
    linear-gradient(-45deg,#0000 50%,var(--lumiverse-primary-text) 0),
    linear-gradient(var(--lumiverse-bg-deep) 0 0);
  background-size: 50% 50%;
  background-repeat: no-repeat;
  animation: la-ldk-15 1.5s infinite;
}
@keyframes la-ldk-15 {
  0%   {background-position:50% 50%,50% 50%,50%  50% ,50% 50%,50% 50%}
  25%  {background-position:0  100%,100%  0,50%  50% ,50% 50%,50% 50%}
  50%  {background-position:0  100%,100%  0,100% 100%,0   0  ,50% 50%}
  75%  {background-position:50% 50%,50% 50%,100% 100%,0   0  ,50% 50%}
  100% {background-position:50% 50%,50% 50%,50%  50% ,50% 50%,50% 50%}
}
`;

// src/ui/styles.ts
var STYLES = `
${LOADERS_CSS}

.la-drawer {
  display: flex; flex-direction: column; height: 100%;
  font-family: var(--lumiverse-font-family);
  color: var(--lumiverse-text);
  background: var(--lumiverse-bg);
  overflow: hidden;
}

/* ─── Header ─── */
.la-header {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-bg-elevated);
  flex-shrink: 0;
}
.la-header-row {
  display: flex; align-items: center; gap: 8px;
  min-width: 0;
}
.la-header-row-char .la-combo-host-full { flex: 1; min-width: 0; }
.la-header-row-char .la-combo-host-full .la-combo-trigger { width: 100%; max-width: none; }
.la-header-label {
  font-weight: 600; font-size: 12px;
  color: var(--lumiverse-text);
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
.la-header-row-meta { gap: 6px; flex-wrap: wrap; row-gap: 6px; }
/* Below this width the action buttons (Workshop, + New, ...) wrap onto a
   second row so they don't push off the edge of a narrow drawer. */
@container drawer (max-width: 360px) {
  .la-header-row-meta .la-conn-select { flex: 1 1 100%; min-width: 0; max-width: none; order: -1; }
}
.la-select {
  background: var(--lumiverse-bg);
  border: 1px solid var(--lumiverse-border);
  color: var(--lumiverse-text);
  border-radius: var(--lumiverse-radius-sm);
  padding: 5px 8px;
  font-size: 12px;
  font-family: inherit;
  min-width: 0;
  cursor: pointer;
  transition: border-color var(--lumiverse-transition-fast), background var(--lumiverse-transition-fast);
}
.la-select:hover { border-color: var(--lumiverse-border-hover); background: var(--lumiverse-bg-hover); }
.la-select:focus { outline: none; border-color: var(--lumiverse-primary-muted); background: var(--lumiverse-bg-hover); }

/* Connection picker: shrink to fit, truncate long labels, keep a reasonable minimum. */
.la-conn-select {
  min-width: 55px;
  max-width: 240px;
  flex: 1 1 55px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.la-btn {
  background: transparent;
  border: 1px solid var(--lumiverse-border);
  color: var(--lumiverse-text);
  border-radius: var(--lumiverse-radius-sm);
  padding: 5px 11px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  white-space: nowrap;
  transition: background var(--lumiverse-transition-fast), border-color var(--lumiverse-transition-fast), color var(--lumiverse-transition-fast);
}
.la-btn:hover { background: var(--lumiverse-bg-hover); border-color: var(--lumiverse-border-hover); }
.la-btn:focus-visible { outline: none; border-color: var(--lumiverse-primary-muted); box-shadow: 0 0 0 2px var(--lumiverse-primary-015); }
.la-btn-primary {
  background: var(--lumiverse-primary);
  border-color: var(--lumiverse-primary);
  color: var(--lumiverse-text);
}
.la-btn-primary:hover { background: var(--lumiverse-primary-hover); border-color: var(--lumiverse-primary-hover); }
.la-btn-danger { color: var(--lumiverse-danger); border-color: var(--lumiverse-border); }
.la-btn-danger:hover { background: var(--lumiverse-danger-015); border-color: var(--lumiverse-danger-050); color: var(--lumiverse-danger); }
.la-btn-ghost { background: transparent; border-color: transparent; color: var(--lumiverse-text-muted); }
.la-btn-ghost:hover { background: var(--lumiverse-bg-hover); color: var(--lumiverse-text); }
.la-btn-mini { padding: 2px 8px; font-size: 11px; }
.la-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.la-btn:disabled:hover { background: transparent; border-color: var(--lumiverse-border); }

.la-flex-spacer { flex: 1; }

/* Searchable combobox */
.la-combo { position: relative; display: inline-block; min-width: 0; }
.la-combo-trigger {
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent;
  border: 1px solid var(--lumiverse-border);
  color: var(--lumiverse-text);
  border-radius: var(--lumiverse-radius-sm);
  padding: 5px 8px 5px 10px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  max-width: 240px;
  transition: background var(--lumiverse-transition-fast), border-color var(--lumiverse-transition-fast);
}
.la-combo-trigger:hover { background: var(--lumiverse-bg-hover); border-color: var(--lumiverse-border-hover); }
.la-combo-trigger:focus { outline: none; border-color: var(--lumiverse-primary-muted); }
.la-combo.is-open .la-combo-trigger { border-color: var(--lumiverse-primary-muted); }
.la-combo-trigger.is-placeholder .la-combo-trigger-label { color: var(--lumiverse-text-dim); }
.la-combo-trigger-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.la-combo-caret { color: var(--lumiverse-text-dim); font-size: 10px; flex-shrink: 0; }
.la-combo-trigger:disabled { opacity: 0.5; cursor: not-allowed; }
.la-combo-pop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 240px;
  max-width: 360px;
  z-index: 1000;
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius);
  box-shadow: var(--lumiverse-shadow-md);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.la-combo-search {
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--lumiverse-border-light);
  color: var(--lumiverse-text);
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
.la-combo-search::placeholder { color: var(--lumiverse-text-dim); }
.la-combo-list { max-height: 280px; overflow-y: auto; padding: 4px; }
.la-combo-item {
  display: block; width: 100%; text-align: left;
  background: transparent; border: none; color: var(--lumiverse-text);
  font-family: inherit; font-size: 13px;
  padding: 6px 10px;
  border-radius: var(--lumiverse-radius-sm);
  cursor: pointer;
}
.la-combo-item.is-active { background: var(--lumiverse-bg-hover); }
.la-combo-item.is-selected { color: var(--lumiverse-primary-text); }
.la-combo-item-label { line-height: 1.3; }
.la-combo-item-sub { color: var(--lumiverse-text-muted); font-size: 11px; margin-top: 2px; }
.la-combo-empty { padding: 10px; font-size: 12px; color: var(--lumiverse-text-muted); }

/* Changes badge in header */
.la-changes-btn {
  position: relative;
  gap: 5px;
}
.la-changes-count {
  background: var(--lumiverse-secondary);
  color: var(--lumiverse-text-muted);
  border-radius: 999px;
  font-size: 10px;
  padding: 1px 6px;
  min-width: 16px;
  text-align: center;
  font-weight: 600;
  transition: background var(--lumiverse-transition-fast), color var(--lumiverse-transition-fast);
}
.la-changes-btn.has-edits .la-changes-count {
  background: var(--lumiverse-primary-020);
  color: var(--lumiverse-primary-text);
}
.la-changes-btn.has-edits { color: var(--lumiverse-text); }

.la-icon-btn {
  padding: 5px;
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.la-icon-btn svg { display: block; }

/* Chat-pin button: subtle by default, primary-tinted when a chat is pinned. */
.la-chat-pin-btn { color: var(--lumiverse-text-muted); }
.la-chat-pin-btn:hover { color: var(--lumiverse-text); }
.la-chat-pin-btn.has-pinned {
  color: var(--lumiverse-text);
  background: var(--lumiverse-primary);
  border-color: var(--lumiverse-primary);
}
.la-chat-pin-btn.has-pinned:hover {
  background: var(--lumiverse-primary-hover);
  border-color: var(--lumiverse-primary-hover);
  color: var(--lumiverse-text);
}

.la-modal-note {
  margin: 0 0 8px;
  padding: 0;
  font-size: 12px;
  color: var(--lumiverse-text-muted);
  line-height: 1.5;
}

/* Inline error banner — shown in the thread when generation fails. */
.la-error-banner {
  border: 1px solid var(--lumiverse-danger);
  background: var(--lumiverse-danger-015);
  color: var(--lumiverse-danger);
  border-radius: var(--lumiverse-radius);
  padding: 12px 14px;
  font-size: 13px;
  line-height: 1.5;
  margin: 8px 0;
}
.la-error-banner-title {
  font-weight: 600;
  margin-bottom: 6px;
}
.la-error-banner-body {
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: var(--lumiverse-font-mono);
  font-size: 12px;
  margin: 0;
  color: var(--lumiverse-text);
  background: var(--lumiverse-bg);
  border-radius: var(--lumiverse-radius-sm);
  padding: 8px 10px;
}

/* Agent settings modal */
.la-agent-settings { display: flex; flex-direction: column; gap: 6px; }
.la-settings-section-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 6px;
}
.la-settings-label {
  font-weight: 600; font-size: 12px;
  color: var(--lumiverse-text);
  letter-spacing: 0.02em;
  margin-top: 6px;
}
.la-settings-section-head .la-settings-label,
.la-settings-reset-row .la-settings-label { margin-top: 0; }
.la-settings-reset-row {
  display: flex; justify-content: flex-end;
  margin-top: 2px; margin-bottom: 4px;
}
.la-settings-hint {
  font-size: 11px;
  color: var(--lumiverse-text-muted);
  margin-bottom: 4px;
  line-height: 1.4;
}
.la-settings-textarea {
  width: 100%;
  background: var(--lumiverse-bg);
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius-sm);
  color: var(--lumiverse-text);
  font-family: var(--lumiverse-font-mono);
  font-size: 12px;
  line-height: 1.5;
  padding: 8px 10px;
  resize: vertical;
  min-height: 90px;
  outline: none;
}
.la-settings-textarea-tall { min-height: 220px; }
.la-settings-textarea:focus { border-color: var(--lumiverse-primary-muted); }
.la-settings-actions {
  display: flex; justify-content: flex-end; gap: 8px;
  margin-top: 6px;
}

/* Sampler sliders inside the settings modal */
.la-samplers-list { display: flex; flex-direction: column; gap: 8px; }
.la-slider-row {
  background: var(--lumiverse-bg);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  padding: 8px 10px;
}
.la-slider-header { display: flex; align-items: center; gap: 8px; }
.la-slider-label {
  flex: 1; font-size: 12px; color: var(--lumiverse-text-muted);
  letter-spacing: 0.02em;
}
.la-slider-label.la-slider-label-set { color: var(--lumiverse-primary-text); }
.la-slider-input {
  width: 90px;
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border-light);
  color: var(--lumiverse-text-muted);
  border-radius: var(--lumiverse-radius-sm);
  padding: 3px 6px;
  font-family: var(--lumiverse-font-mono);
  font-size: 11px;
  text-align: right;
}
.la-slider-input.la-slider-input-set { color: var(--lumiverse-primary-text); border-color: var(--lumiverse-primary-muted); }
.la-slider-track {
  position: relative;
  height: 6px;
  margin-top: 8px;
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: 999px;
  cursor: pointer;
  user-select: none;
}
.la-slider-fill {
  position: absolute; left: 0; top: 0; bottom: 0;
  width: 0%;
  background: var(--lumiverse-secondary);
  border-radius: 999px;
}
.la-slider-track.la-slider-track-set .la-slider-fill { background: var(--lumiverse-primary); }
.la-slider-thumb {
  position: absolute; top: 50%; left: 0%;
  width: 14px; height: 14px;
  margin-left: -7px;
  transform: translateY(-50%);
  border-radius: 50%;
  background: var(--lumiverse-bg-elevated);
  border: 2px solid var(--lumiverse-border-hover);
}
.la-slider-track.la-slider-track-set .la-slider-thumb {
  background: var(--lumiverse-primary);
  border-color: var(--lumiverse-primary-hover);
}

.la-settings-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.la-settings-row-label {
  font-size: 12px; color: var(--lumiverse-text-muted);
}

/* Icon settings modal */
.la-icon-settings { display: flex; flex-direction: column; gap: 10px; }
.la-icon-settings-preview {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 16px;
  background: var(--lumiverse-bg);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius);
}
.la-icon-settings-image {
  width: 96px; height: 96px;
  object-fit: contain;
  border-radius: var(--lumiverse-radius-md);
  background: var(--lumiverse-bg-elevated);
}
.la-icon-settings-image-tall {
  width: 120px;
  height: 180px;
}
.la-icon-settings-caption {
  font-size: 11px;
  color: var(--lumiverse-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.la-icon-settings-actions {
  display: flex; justify-content: space-between; gap: 8px;
  margin-top: 4px;
}

/* ─── Session bar (removed; kept for back-compat selectors) ─── */
.la-session-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--lumiverse-border-light);
  background: var(--lumiverse-bg);
  font-size: 11px;
  color: var(--lumiverse-text-muted);
  flex-shrink: 0;
}
.la-session-bar-spacer { flex: 1; }
.la-session-bar-label { font-weight: 500; }

/* ─── Thread (scrolling area) ─── */
.la-thread {
  flex: 1; min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  /* Bottom reserve lives on .la-virt-inner below; this padding only frames
     the spacer when nothing's mounted yet. */
  padding: 24px 16px 24px;
}
/* The mousey reserve only matters when the message column horizontally
   overlaps the mousey figure. Mousey sits at left:12 of the composer; the
   message column is max-width 760, centered. They clear each other once
   the drawer is wide enough that (drawer_width - 760) / 2 > mousey_right
   edge (~105px at full mousey size), i.e. drawer_width > ~970px. Default
   gives 24px breathing room; the @container override below kicks in only
   when the figure is in the column's vertical channel. */
.la-virt-inner {
  padding-bottom: 24px;
}
@container drawer (max-width: 970px) {
  .la-virt-inner {
    /* Reserve = mousey_visible_extent + 24px buffer. Mousey extends above
       the composer by height * (1 - 0.33) = height * 0.67. Both scale via
       22cqw so the reserve tracks the figure 1:1 across drawer widths. */
    padding-bottom: max(24px, calc(min(140px, 22cqw) * 0.67 + 24px));
  }
  display: flex; flex-direction: column;
  /* scroll-behavior is intentionally NOT smooth here: programmatic stick-to-
     bottom would animate, fighting the user's wheel/keyboard input mid-
     stream. Native browser scrolling stays smooth on its own. */
}
.la-thread > * { width: 100%; max-width: 760px; min-width: 0; margin-left: auto; margin-right: auto; }
.la-thread > * + * { margin-top: 20px; }
/* Spans full chat width, not the 760px message column, so the label sits on the visible midline. */
.la-thread > .la-cache-divider { max-width: none; }

/* ─── Messages ─── */
.la-msg { display: flex; flex-direction: column; gap: 6px; }
.la-msg-user { align-items: flex-end; }
.la-msg-assistant { align-items: stretch; }

.la-msg-bubble {
  word-wrap: break-word;
  line-height: 1.6;
  font-size: 14px;
}
.la-msg-user .la-msg-bubble {
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-lg);
  padding: 10px 14px;
  max-width: 80%;
  white-space: pre-wrap;
}
.la-msg-assistant .la-msg-bubble {
  background: transparent;
  border: none;
  padding: 0;
  width: 100%;
}
.la-msg-meta {
  font-size: 10px;
  color: var(--lumiverse-text-dim);
  padding: 0 4px;
  letter-spacing: 0.02em;
}

.la-msg-block + .la-msg-block { margin-top: 10px; }

/* Message-level actions (Edit / Regenerate) — fade in on hover. */
.la-msg-actions {
  display: flex; gap: 4px;
  opacity: 0;
  transition: opacity var(--lumiverse-transition-fast);
}
.la-msg:hover .la-msg-actions, .la-msg-actions:focus-within { opacity: 1; }
.la-msg-action-btn {
  background: transparent;
  border: 1px solid var(--lumiverse-border-light);
  color: var(--lumiverse-text-muted);
  border-radius: var(--lumiverse-radius-sm);
  padding: 2px 9px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: background var(--lumiverse-transition-fast), color var(--lumiverse-transition-fast), border-color var(--lumiverse-transition-fast);
}
.la-msg-action-btn:hover { background: var(--lumiverse-bg-hover); color: var(--lumiverse-text); border-color: var(--lumiverse-border-hover); }
.la-msg-action-btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  line-height: 0;
}
.la-msg-action-btn-icon svg { width: 14px; height: 14px; display: block; }
.la-msg-action-btn-danger { color: var(--lumiverse-danger); border-color: var(--lumiverse-border); }
.la-msg-action-btn-danger:hover { background: var(--lumiverse-danger-015); border-color: var(--lumiverse-danger-050); color: var(--lumiverse-danger); }

/* Inline-edit textarea inside a user message bubble. */
.la-msg-user .la-msg-bubble.is-editing { padding: 8px; }
.la-msg-edit-textarea {
  width: 100%;
  background: transparent;
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius-sm);
  color: var(--lumiverse-text);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
  padding: 6px 8px;
  resize: vertical;
  min-height: 44px;
  outline: none;
}
.la-msg-edit-textarea:focus { border-color: var(--lumiverse-primary-muted); }
.la-msg-edit-actions {
  display: flex; justify-content: flex-end; gap: 6px; margin-top: 6px;
}

/* Markdown text in assistant messages */
.la-text-block { line-height: 1.65; }
.la-text-block p { margin: 0 0 10px; white-space: pre-wrap; }
.la-text-block p:last-child { margin-bottom: 0; }
.la-text-block ul, .la-text-block ol { margin: 6px 0 10px 22px; padding: 0; }
.la-text-block li { margin: 2px 0; }
.la-text-block h1, .la-text-block h2, .la-text-block h3,
.la-text-block h4, .la-text-block h5, .la-text-block h6 {
  margin: 14px 0 6px; font-weight: 600; color: var(--lumiverse-text);
}
.la-text-block h1 { font-size: 1.4em; }
.la-text-block h2 { font-size: 1.25em; }
.la-text-block h3 { font-size: 1.1em; }
.la-text-block a { color: var(--lumiverse-primary-text); text-decoration: none; border-bottom: 1px solid var(--lumiverse-primary-020); }
.la-text-block a:hover { border-bottom-color: var(--lumiverse-primary-muted); }
.la-text-block code {
  background: var(--lumiverse-fill);
  border: 1px solid var(--lumiverse-border-light);
  padding: 1px 6px;
  border-radius: var(--lumiverse-radius-sm);
  font-family: var(--lumiverse-font-mono);
  font-size: 0.88em;
  color: var(--lumiverse-primary-text);
}
.la-text-block pre {
  background: var(--lumiverse-bg-dark);
  border: 1px solid var(--lumiverse-border-light);
  padding: 12px 14px;
  border-radius: var(--lumiverse-radius);
  overflow-x: auto;
  margin: 10px 0;
}
.la-text-block pre code {
  background: transparent;
  border: none;
  padding: 0;
  color: var(--lumiverse-text);
  font-size: 12.5px;
  line-height: 1.55;
  white-space: pre;
  display: block;
}
.la-text-block blockquote {
  border-left: 3px solid var(--lumiverse-border);
  padding: 2px 0 2px 12px;
  margin: 6px 0;
  color: var(--lumiverse-prose-blockquote, var(--lumiverse-text-muted));
}
.la-text-block hr {
  border: none;
  border-top: 1px solid var(--lumiverse-border-light);
  margin: 14px 0;
}
.la-text-block strong { color: var(--lumiverse-text); }
.la-text-block em { color: var(--lumiverse-prose-italic, var(--lumiverse-text-muted)); }

.la-chunk-fade { animation: la-chunk-fade 180ms ease-out both; }
@keyframes la-chunk-fade { from { opacity: 0; } to { opacity: 1; } }

.la-cache-divider {
  position: relative;
  text-align: center;
  margin: 18px 0 14px;
  opacity: 0.6;
  pointer-events: none;
}
.la-cache-divider::before {
  content: "";
  position: absolute;
  left: 0; right: 0; top: 50%;
  height: 1px;
  background: var(--lumiverse-text-muted);
  z-index: 0;
}
.la-cache-divider-label {
  position: relative;
  z-index: 1;
  display: inline-block;
  background: var(--lumiverse-bg);
  padding: 0 12px;
  font-size: 11px;
  color: var(--lumiverse-text-muted);
  font-style: italic;
  letter-spacing: 0.02em;
}

/* Scramble-cycling "thinking" indicator (Claude-Code-style). */
.la-thinking {
  display: inline-flex; align-items: baseline; gap: 2px;
  color: var(--lumiverse-text-muted);
  font-size: 13px;
  font-family: var(--lumiverse-font-family);
  font-style: italic;
  padding: 4px 0;
  user-select: none;
}
.la-thinking-word {
  font-feature-settings: "tnum" 1;
  background: linear-gradient(
    90deg,
    var(--lumiverse-text-muted) 0%,
    var(--lumiverse-primary-text) 50%,
    var(--lumiverse-text-muted) 100%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: la-thinking-shimmer 3.4s linear infinite;
}
@keyframes la-thinking-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
.la-thinking-dots {
  display: inline-flex; gap: 1px; margin-left: 1px;
  color: var(--lumiverse-text-muted);
}
.la-thinking-dots > span {
  display: inline-block;
  animation: la-thinking-dot 1.4s ease-in-out infinite;
}
.la-thinking-dots > span:nth-child(2) { animation-delay: 0.18s; }
.la-thinking-dots > span:nth-child(3) { animation-delay: 0.36s; }
@keyframes la-thinking-dot {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-2px); }
}

/* Reasoning collapsible */
.la-reasoning {
  background: var(--lumiverse-fill-subtle);
  border-left: 2px solid var(--lumiverse-border);
  border-radius: 0 var(--lumiverse-radius-sm) var(--lumiverse-radius-sm) 0;
  padding: 6px 10px;
  color: var(--lumiverse-text-muted);
  font-size: 12px;
  font-style: italic;
}
.la-reasoning-toggle {
  cursor: pointer; user-select: none;
  display: flex; align-items: center; gap: 4px;
}
.la-reasoning-body { display: none; margin-top: 6px; white-space: pre-wrap; font-style: normal; }
.la-reasoning.is-open .la-reasoning-body { display: block; }

/* Tool call card */
.la-tool-card {
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius);
  background: var(--lumiverse-bg-elevated);
  overflow: hidden;
  font-size: 13px;
  transition: border-color var(--lumiverse-transition-fast);
}
.la-tool-card:hover { border-color: var(--lumiverse-border-hover); }
.la-tool-head {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  user-select: none;
}
.la-tool-head:hover { background: var(--lumiverse-bg-hover); }
.la-tool-icon { color: var(--lumiverse-text-dim); font-size: 10px; }
.la-tool-name {
  font-weight: 500; font-family: var(--lumiverse-font-mono); font-size: 12px;
  color: var(--lumiverse-primary-text);
}
.la-tool-args-preview {
  color: var(--lumiverse-text-dim);
  font-family: var(--lumiverse-font-mono);
  font-size: 11px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  flex: 1; min-width: 0;
}
.la-tool-status {
  font-size: 10px;
  color: var(--lumiverse-text-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.la-tool-status.is-error { color: var(--lumiverse-danger); }
.la-tool-sens {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid currentColor;
  opacity: 0.7;
}
.la-tool-sens-sensitive { color: var(--lumiverse-primary, #7a9bff); }
.la-tool-sens-insensitive { color: var(--lumiverse-text-muted); }
.la-tool-sens-freed { color: var(--lumiverse-text-muted); opacity: 0.5; }
.la-tool-free-btn {
  background: none;
  border: 1px solid var(--lumiverse-border-light);
  color: var(--lumiverse-text-muted);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.la-tool-free-btn:hover {
  border-color: var(--lumiverse-danger);
  color: var(--lumiverse-danger);
}
.la-tool-free-btn.is-confirming {
  background: var(--lumiverse-danger-015);
  border-color: var(--lumiverse-danger);
  color: var(--lumiverse-danger);
}
.la-tool-body {
  display: none;
  border-top: 1px solid var(--lumiverse-border-light);
  padding: 10px 12px;
}
.la-tool-card.is-open .la-tool-body { display: block; }
.la-tool-body-section { margin-bottom: 8px; }
.la-tool-body-section:last-child { margin-bottom: 0; }
.la-tool-body-section-label {
  color: var(--lumiverse-text-dim);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 4px;
}
.la-tool-body pre {
  margin: 0;
  background: var(--lumiverse-bg-dark);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  padding: 8px 10px;
  font-family: var(--lumiverse-font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--lumiverse-text);
  white-space: pre-wrap;
  word-wrap: break-word;
  max-height: 320px;
  overflow-y: auto;
}

/* ask_user_question modal */
.la-ask-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000;
  padding: 20px;
}
.la-ask-modal {
  background: var(--lumiverse-bg);
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius);
  padding: 18px 20px;
  max-width: 720px; width: 100%;
  max-height: 90vh; overflow-y: auto;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45);
  display: flex; flex-direction: column; gap: 16px;
}
.la-ask-header { display: flex; flex-direction: column; gap: 3px; }
.la-ask-title { font-weight: 600; font-size: 15px; color: var(--lumiverse-text); }
.la-ask-subtitle { font-size: 12px; color: var(--lumiverse-text-muted); }
.la-ask-body { display: flex; flex-direction: column; gap: 14px; }
.la-ask-question {
  padding: 12px;
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  display: flex; flex-direction: column; gap: 10px;
}
.la-ask-question-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.la-ask-chip {
  background: var(--lumiverse-primary-015); color: var(--lumiverse-primary-text);
  padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600;
  letter-spacing: 0.04em; text-transform: uppercase;
}
.la-ask-question-text { font-size: 14px; color: var(--lumiverse-text); flex: 1; }
.la-ask-multi-badge {
  font-size: 10px; color: var(--lumiverse-text-dim); font-style: italic;
}
.la-ask-options { display: flex; flex-direction: column; gap: 6px; }
.la-ask-option {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 8px 10px;
  background: var(--lumiverse-bg);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  cursor: pointer;
  transition: background 0.1s;
}
.la-ask-option:hover { background: var(--lumiverse-bg-hover); }
.la-ask-option input { margin-top: 2px; flex-shrink: 0; }
.la-ask-option-text { display: flex; flex-direction: column; gap: 2px; }
.la-ask-option-label { font-weight: 600; font-size: 13px; color: var(--lumiverse-text); }
.la-ask-option-desc { font-size: 11px; color: var(--lumiverse-text-muted); line-height: 1.4; }
.la-ask-other-input {
  width: 100%; resize: vertical; min-height: 48px;
  padding: 6px 8px;
  background: var(--lumiverse-bg); color: var(--lumiverse-text);
  border: 1px solid var(--lumiverse-border-light); border-radius: var(--lumiverse-radius-sm);
  font-family: inherit; font-size: 12px;
}
.la-ask-preview {
  background: var(--lumiverse-bg-dark); color: var(--lumiverse-text);
  padding: 8px; border-radius: var(--lumiverse-radius-sm);
  font-family: var(--lumiverse-font-mono); font-size: 11px;
  white-space: pre-wrap; word-wrap: break-word;
  max-height: 240px; overflow-y: auto;
  border: 1px solid var(--lumiverse-border-light);
}
.la-ask-footer { display: flex; justify-content: flex-end; gap: 8px; }

/* Todos panel (todo_write tool card) */
.la-todos-panel {
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  font-size: 12px;
}
.la-todos-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.la-todo-item { display: flex; gap: 8px; align-items: baseline; line-height: 1.45; }
.la-todo-mark {
  width: 14px; flex-shrink: 0; text-align: center;
  font-family: var(--lumiverse-font-mono);
  color: var(--lumiverse-text-dim);
}
.la-todo-label { white-space: pre-wrap; word-wrap: break-word; }
.la-todo-pending .la-todo-label { color: var(--lumiverse-text-muted); }
.la-todo-in_progress .la-todo-mark { color: var(--lumiverse-primary-text); }
.la-todo-in_progress .la-todo-label { color: var(--lumiverse-text); font-weight: 600; }
.la-todo-completed .la-todo-mark { color: var(--lumiverse-success); }
.la-todo-completed .la-todo-label { color: var(--lumiverse-text-dim); text-decoration: line-through; }
.la-todos-empty { color: var(--lumiverse-text-dim); font-style: italic; }

/* Edits card */
.la-edits-card {
  border: 1px solid var(--lumiverse-primary-muted);
  border-radius: var(--lumiverse-radius);
  background: var(--lumiverse-primary-015);
  padding: 10px 14px;
  font-size: 13px;
}
.la-edits-head {
  display: flex; align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.la-edits-caret {
  color: var(--lumiverse-primary-text);
  font-size: 11px;
  flex-shrink: 0;
  width: 12px; text-align: center;
}
.la-edits-title {
  font-weight: 600;
  color: var(--lumiverse-primary-text);
  letter-spacing: 0.01em;
  flex: 1;
}
.la-edits-head-right { flex-shrink: 0; }
.la-edits-list { display: none; margin-top: 10px; }
.la-edits-card.is-open .la-edits-list { display: flex; flex-direction: column; gap: 8px; }
.la-edit-row {
  padding: 8px 10px;
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
}
.la-edit-row.is-reverted { opacity: 0.5; }
.la-edit-row-head {
  display: flex; align-items: center; gap: 6px;
  flex-wrap: wrap; font-size: 12px;
  margin-bottom: 6px;
}
.la-edit-row-surface { color: var(--lumiverse-text-dim); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
.la-edit-row-label { font-weight: 600; color: var(--lumiverse-text); }
.la-edit-row-field { color: var(--lumiverse-text-muted); font-family: var(--lumiverse-font-mono); font-size: 11px; }
.la-edit-row-stat { color: var(--lumiverse-text-dim); font-size: 11px; }
.la-edit-row-actions { margin-left: auto; display: flex; gap: 4px; }
.la-edit-row-diff { font-family: var(--lumiverse-font-mono); font-size: 11px; }

/* Inline diff coloring */
.la-diff-inline { display: inline; word-wrap: break-word; }
.la-diff-add { color: var(--lumiverse-success); background: var(--lumiverse-success-015); border-radius: 2px; padding: 0 1px; }
.la-diff-del { color: var(--lumiverse-danger); background: var(--lumiverse-danger-015); border-radius: 2px; padding: 0 1px; text-decoration: line-through; }
.la-diff-ctx { color: var(--lumiverse-text-muted); }

/* Unified diff */
.la-diff-unified {
  background: var(--lumiverse-bg-dark);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  padding: 6px;
  overflow-x: auto;
  max-height: 280px;
  overflow-y: auto;
}
.la-diff-row {
  display: flex; gap: 6px; padding: 0 2px;
  font-family: var(--lumiverse-font-mono); font-size: 11px; line-height: 1.55;
}
.la-diff-row .la-diff-sigil { color: var(--lumiverse-text-dim); width: 12px; text-align: center; flex-shrink: 0; }
.la-diff-row .la-diff-text { white-space: pre; overflow-wrap: anywhere; flex: 1; min-width: 0; }
.la-diff-lineno {
  color: var(--lumiverse-text-dim);
  text-align: right;
  width: 36px;
  flex-shrink: 0;
  user-select: none;
  font-feature-settings: "tnum" 1;
  padding-right: 4px;
}
.la-diff-lineno-new { border-left: 1px solid var(--lumiverse-border-light); padding-left: 6px; }
.la-diff-add-row { background: var(--lumiverse-success-015); color: var(--lumiverse-success); }
.la-diff-del-row { background: var(--lumiverse-danger-015); color: var(--lumiverse-danger); }
.la-diff-gap { font-size: 10px; color: var(--lumiverse-text-dim); text-align: center; padding: 3px 0; font-family: var(--lumiverse-font-mono); }
.la-diff-empty { font-size: 11px; color: var(--lumiverse-text-dim); padding: 6px; }
.la-diff-gap-expander, .la-diff-sxs-gap-expander {
  display: block;
  width: 100%;
  text-align: center;
  background: var(--lumiverse-bg-elevated);
  color: var(--lumiverse-text-muted);
  border: none;
  border-top: 1px dashed var(--lumiverse-border-light);
  border-bottom: 1px dashed var(--lumiverse-border-light);
  padding: 4px 6px;
  font-family: var(--lumiverse-font-mono); font-size: 10px;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background var(--lumiverse-transition-fast), color var(--lumiverse-transition-fast);
}
.la-diff-gap-expander:hover, .la-diff-sxs-gap-expander:hover {
  background: var(--lumiverse-bg-hover);
  color: var(--lumiverse-primary-text);
}

/* Composer */
.la-composer {
  position: relative;
  border-top: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-bg);
  padding: 12px 16px 14px;
  display: flex; flex-direction: column; gap: 6px;
  flex-shrink: 0;
}
.la-drawer { container-type: inline-size; container-name: drawer; }
.la-mousey {
  position: absolute;
  left: 12px;
  bottom: 100%;
  height: min(140px, 22cqw);
  width: auto;
  pointer-events: none;
  user-select: none;
  transform: translateY(33%);
  z-index: 1;
  transition: -webkit-mask-image var(--lumiverse-transition-fast), mask-image var(--lumiverse-transition-fast);
}
/* Soft alpha falloff applied ONLY when text is detected behind the image.
   Toggled by the overlap detector in drawer.ts. The mask fades the image's
   own bottom edge so the figure stays visible without occluding text under
   it. backdrop-filter is deliberately NOT used here: it would blur a square
   region matching the element's bounding box, ignoring the PNG's alpha. */
.la-mousey.la-mousey-overlap {
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 72%, rgba(0,0,0,0.35) 92%, transparent 100%);
  mask-image: linear-gradient(to bottom, #000 0%, #000 72%, rgba(0,0,0,0.35) 92%, transparent 100%);
}
.la-composer-inner {
  width: 100%; max-width: 760px;
  margin: 0 auto;
  display: flex; flex-direction: column; gap: 6px;
}
.la-composer-area {
  position: relative;
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius-xl);
  padding: 4px 4px 4px 16px;
  display: flex; align-items: flex-end; gap: 8px;
  transition: border-color var(--lumiverse-transition-fast), box-shadow var(--lumiverse-transition-fast);
}
.la-composer-area:focus-within {
  border-color: var(--lumiverse-primary-muted);
  box-shadow: 0 0 0 3px var(--lumiverse-primary-015);
}
.la-textarea {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--lumiverse-text);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
  padding: 10px 0;
  min-height: 24px;
  max-height: 84px;
  overflow-y: auto;
  resize: none;
  outline: none;
}
.la-textarea::placeholder { color: var(--lumiverse-text-dim); }
.la-composer-actions {
  display: flex; align-items: center;
  flex-shrink: 0;
}
.la-compact-btn {
  position: relative;
  width: 32px; height: 32px;
  background: transparent;
  border: none;
  padding: 0;
  margin-right: 6px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background var(--lumiverse-transition-fast);
}
.la-compact-btn:hover:not(:disabled) { background: var(--lumiverse-bg-hover); }
.la-compact-btn:disabled { cursor: not-allowed; opacity: 0.5; }
.la-compact-btn.is-busy { opacity: 0.55; cursor: progress; }
.la-compact-ring { width: 26px; height: 26px; display: block; }
.la-compact-track { stroke: var(--lumiverse-border); }
.la-compact-fill {
  stroke: var(--lumiverse-primary);
  transition: stroke-dashoffset var(--lumiverse-transition-fast), stroke var(--lumiverse-transition-fast);
}
.la-compact-btn.is-near-limit .la-compact-fill { stroke: var(--lumiverse-warning, var(--lumiverse-primary-hover)); }
.la-compact-btn.is-at-limit .la-compact-fill { stroke: var(--lumiverse-danger); }
.la-compact-tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius);
  box-shadow: var(--lumiverse-shadow-md);
  padding: 8px 10px;
  min-width: 220px;
  max-width: 260px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(4px);
  transition: opacity var(--lumiverse-transition-fast), transform var(--lumiverse-transition-fast);
  z-index: 50;
  text-align: left;
}
.la-compact-btn:hover .la-compact-tooltip,
.la-compact-btn:focus-visible .la-compact-tooltip { opacity: 1; transform: translateY(0); }
.la-compact-tooltip-main {
  font-size: 12px;
  color: var(--lumiverse-text);
  font-weight: 500;
  margin-bottom: 2px;
}
.la-compact-tooltip-sub {
  font-size: 10px;
  color: var(--lumiverse-text-muted);
}

.la-send-btn {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: var(--lumiverse-primary);
  border: none;
  color: var(--lumiverse-text);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background var(--lumiverse-transition-fast), opacity var(--lumiverse-transition-fast);
}
.la-send-btn:hover:not(:disabled) { background: var(--lumiverse-primary-hover); }
.la-send-btn:disabled { background: var(--lumiverse-secondary); cursor: not-allowed; opacity: 0.6; }
.la-send-btn svg { width: 18px; height: 18px; }
.la-cancel-btn {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: var(--lumiverse-bg-hover);
  border: 1px solid var(--lumiverse-border);
  color: var(--lumiverse-danger);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background var(--lumiverse-transition-fast);
}
.la-cancel-btn:hover { background: var(--lumiverse-danger-015); border-color: var(--lumiverse-danger-050); }
.la-cancel-btn svg { width: 14px; height: 14px; }
.la-composer-status { display: none; }
.la-composer-status.is-error { display: none; }
.la-composer-hint { color: var(--lumiverse-text-dim); font-size: 10px; text-align: right; padding: 0 16px; }

/* Empty state */
.la-empty {
  display: flex; align-items: center; justify-content: center;
  flex: 1; flex-direction: column; gap: 14px;
  color: var(--lumiverse-text-muted);
  text-align: center;
  padding: 40px 24px;
  min-height: 240px;
}
.la-empty h3 { margin: 0; color: var(--lumiverse-text); font-weight: 600; font-size: 16px; }
.la-empty p { margin: 0; font-size: 13px; max-width: 420px; line-height: 1.6; color: var(--lumiverse-text-muted); }
.la-empty-suggestions { display: flex; flex-direction: column; gap: 6px; align-items: center; margin-top: 8px; }
.la-empty-suggestion {
  background: var(--lumiverse-bg-elevated);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius);
  padding: 6px 14px;
  font-size: 12px;
  color: var(--lumiverse-text-muted);
  cursor: pointer;
  transition: background var(--lumiverse-transition-fast), border-color var(--lumiverse-transition-fast);
}
.la-empty-suggestion:hover { background: var(--lumiverse-bg-hover); border-color: var(--lumiverse-border-hover); color: var(--lumiverse-text); }

/* ─── Workshop modal tabs ─── */
.la-workshop-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px 0;
  border-bottom: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-bg-elevated);
  flex-shrink: 0;
}
.la-workshop-tab {
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  color: var(--lumiverse-text-muted);
  padding: 6px 14px;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  border-radius: var(--lumiverse-radius-sm) var(--lumiverse-radius-sm) 0 0;
  margin-bottom: -1px;
  transition: color var(--lumiverse-transition-fast), background var(--lumiverse-transition-fast);
}
.la-workshop-tab:hover { color: var(--lumiverse-text); }
.la-workshop-tab.is-active {
  background: var(--lumiverse-bg);
  border-color: var(--lumiverse-border);
  border-bottom-color: var(--lumiverse-bg);
  color: var(--lumiverse-primary-text);
  font-weight: 600;
}
.la-workshop-view { display: none; flex: 1; min-height: 0; flex-direction: column; }
.la-workshop-view.is-active { display: flex; }

/* ─── Workspace (Files tab) ─── */
.la-ws {
  display: flex; flex-direction: column;
  height: 100%; min-height: 0;
  background: var(--lumiverse-bg);
}
.la-ws-toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-bg-elevated);
  flex-shrink: 0;
}
.la-ws-status {
  font-size: 11px;
  color: var(--lumiverse-text-muted);
  margin-left: auto;
  max-width: 50%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.la-ws-status.is-error { color: var(--lumiverse-danger); }
.la-ws-split {
  display: grid;
  grid-template-columns: minmax(240px, 320px) 1fr;
  flex: 1; min-height: 0;
}
.la-ws-tree {
  overflow-y: auto;
  border-right: 1px solid var(--lumiverse-border);
  padding: 6px 4px;
  background: var(--lumiverse-bg-elevated);
  min-height: 0;
}
.la-ws-row {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 8px;
  border-radius: var(--lumiverse-radius-sm);
  cursor: pointer;
  font-size: 12px;
  user-select: none;
}
.la-ws-row:hover { background: var(--lumiverse-bg-hover); }
.la-ws-row.is-selected { background: var(--lumiverse-primary-015); color: var(--lumiverse-primary-text); }
.la-ws-caret { color: var(--lumiverse-text-dim); width: 10px; font-size: 10px; flex-shrink: 0; }
.la-ws-icon { width: 16px; text-align: center; flex-shrink: 0; }
.la-ws-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.la-ws-size { color: var(--lumiverse-text-dim); font-size: 10px; flex-shrink: 0; }
.la-ws-loading { color: var(--lumiverse-text-dim); font-size: 11px; }
.la-ws-empty {
  padding: 16px;
  color: var(--lumiverse-text-muted);
  font-size: 12px;
  text-align: center;
}
.la-ws-pane {
  display: flex; flex-direction: column;
  overflow: hidden;
  min-height: 0;
  padding: 12px 16px;
}
.la-ws-pane-empty { color: var(--lumiverse-text-muted); font-size: 13px; padding: 8px; }
.la-ws-pane-header { margin-bottom: 8px; }
.la-ws-pane-title { font-weight: 600; font-size: 13px; word-break: break-all; }
.la-ws-pane-meta { font-size: 11px; color: var(--lumiverse-text-muted); margin-top: 2px; }
.la-ws-pane-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.la-ws-pane-note {
  font-size: 12px;
  color: var(--lumiverse-text-muted);
  padding: 8px 12px;
  background: var(--lumiverse-fill-subtle);
  border-radius: var(--lumiverse-radius-sm);
}
.la-ws-preview {
  flex: 1; min-height: 0;
  background: var(--lumiverse-bg-dark);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  overflow: auto;
}
.la-ws-preview-pre {
  margin: 0;
  padding: 10px 12px;
  font-family: var(--lumiverse-font-mono);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
}
.la-ws-preview { display: flex; flex-direction: column; }
.la-ws-editor-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--lumiverse-border-light);
  background: var(--lumiverse-bg-dark);
  flex-shrink: 0;
}
.la-ws-editor-status {
  flex: 1;
  font-size: 11px;
  color: var(--lumiverse-text-muted);
}
.la-ws-editor-status.is-dirty { color: var(--lumiverse-primary); font-weight: 600; }
.la-ws-editor {
  flex: 1;
  width: 100%;
  min-height: 200px;
  margin: 0;
  padding: 10px 12px;
  border: none;
  outline: none;
  resize: none;
  font-family: var(--lumiverse-font-mono);
  font-size: 12px;
  line-height: 1.5;
  background: var(--lumiverse-bg-dark);
  color: var(--lumiverse-text);
  box-sizing: border-box;
}
.la-ws-system-tag {
  margin-left: 6px;
  padding: 0 6px;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--lumiverse-text-muted);
  background: var(--lumiverse-bg-dark);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: 4px;
  line-height: 14px;
  flex-shrink: 0;
}
.la-ws-preview-img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  margin: 0 auto;
  object-fit: contain;
  background: var(--lumiverse-bg-dark);
}
.la-ws-preview-audio { display: block; width: 100%; padding: 16px 12px; }
.la-ws-preview-video { display: block; max-width: 100%; max-height: 100%; margin: 0 auto; background: black; }
@media (max-width: 720px) {
  .la-ws-split { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .la-ws-tree { max-height: 30vh; border-right: none; border-bottom: 1px solid var(--lumiverse-border); }
  .la-ws-pane { padding: 8px 10px; }
}

/* ─── Workshop Characters tab ─── */
.la-chars {
  display: flex; flex-direction: column;
  height: 100%; min-height: 0;
  background: var(--lumiverse-bg);
}
.la-chars-toolbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-bg-elevated);
  flex-shrink: 0;
}
.la-chars-summary { display: flex; gap: 6px; flex-wrap: wrap; }
.la-chars-summary-pill {
  font-size: 11px;
  color: var(--lumiverse-text-muted);
  background: var(--lumiverse-bg);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  padding: 2px 8px;
}
.la-chars-list { flex: 1; overflow-y: auto; padding: 6px; min-height: 0; }
.la-chars-empty {
  padding: 24px 16px;
  color: var(--lumiverse-text-muted);
  font-size: 12px;
  text-align: center;
}
.la-chars-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius);
  background: var(--lumiverse-bg-elevated);
  margin-bottom: 6px;
}
.la-chars-row:hover { background: var(--lumiverse-bg-hover); }
.la-chars-main { flex: 1; min-width: 0; }
.la-chars-name {
  font-weight: 600; font-size: 13px;
  display: flex; align-items: baseline; gap: 8px;
  overflow: hidden; white-space: nowrap;
}
.la-chars-name-text { overflow: hidden; text-overflow: ellipsis; }
.la-chars-size {
  font-weight: 400; font-size: 11px;
  color: var(--lumiverse-text-muted);
  flex-shrink: 0;
}
.la-chars-meta {
  font-size: 11px;
  color: var(--lumiverse-text-muted);
  margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.la-chars-actions { display: flex; gap: 6px; flex-shrink: 0; }

/* ─── Diff modal (rendered inside host showModal body) ─── */
/* Host body has padding 16px and overflowY auto. We size root to 100% of that
   content area, then run internal scroll on tree and pane-body so the host
   body never scrolls itself. */
.la-diff-modal-root {
  display: flex; flex-direction: column;
  height: 100%; min-height: 0;
  margin: -16px;
  background: var(--lumiverse-bg);
  color: var(--lumiverse-text);
  font-family: var(--lumiverse-font-family);
}
.la-diff-modal-toolbar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-bg-elevated);
  flex-shrink: 0;
}
.la-diff-modal-stats { font-size: 12px; color: var(--lumiverse-text-muted); }
.la-diff-view-toggle {
  display: inline-flex;
  background: var(--lumiverse-bg);
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius-sm);
  padding: 2px;
}
.la-diff-view-tab {
  background: transparent; border: none; color: var(--lumiverse-text-muted);
  font-family: inherit; font-size: 11px;
  padding: 4px 10px;
  border-radius: var(--lumiverse-radius-sm);
  cursor: pointer;
  transition: background var(--lumiverse-transition-fast), color var(--lumiverse-transition-fast);
}
.la-diff-view-tab.is-active { background: var(--lumiverse-bg-elevated); color: var(--lumiverse-text); }
.la-diff-view-tab:hover:not(.is-active) { color: var(--lumiverse-text); }
.la-diff-modal-body {
  display: grid;
  grid-template-columns: minmax(220px, 300px) 1fr;
  flex: 1; min-height: 0;
}
.la-diff-modal-tree {
  overflow-y: auto;
  border-right: 1px solid var(--lumiverse-border);
  padding: 8px 6px;
  background: var(--lumiverse-bg-elevated);
  min-height: 0;
}
.la-diff-tree-section { margin-bottom: 10px; }
.la-diff-tree-section-head {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--lumiverse-text-dim);
  padding: 6px 10px;
  font-weight: 600;
}
.la-diff-tree-row {
  display: block; width: 100%; text-align: left;
  background: transparent; border: none; color: inherit; font-family: inherit;
  padding: 7px 10px;
  border-radius: var(--lumiverse-radius-sm);
  cursor: pointer;
  margin-bottom: 2px;
  transition: background var(--lumiverse-transition-fast);
}
.la-diff-tree-row:hover { background: var(--lumiverse-bg-hover); }
.la-diff-tree-row.is-active { background: var(--lumiverse-primary-015); }
.la-diff-tree-row.is-reverted { opacity: 0.5; }
.la-diff-tree-primary {
  font-size: 13px; color: var(--lumiverse-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.la-diff-tree-secondary {
  font-size: 11px; color: var(--lumiverse-text-muted); margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.la-diff-tree-empty, .la-diff-pane-empty {
  padding: 16px; color: var(--lumiverse-text-muted); font-size: 13px;
}
.la-diff-modal-pane {
  display: flex; flex-direction: column;
  overflow: hidden;
  min-height: 0;
}
.la-diff-pane-toolbar {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 4px 14px;
  padding: 12px 18px;
  border-bottom: 1px solid var(--lumiverse-border);
  background: var(--lumiverse-bg-elevated);
  flex-shrink: 0;
}
.la-diff-pane-heading {
  grid-column: 1; grid-row: 1; font-size: 14px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0;
}
.la-diff-pane-sub { color: var(--lumiverse-text-muted); font-weight: 400; }
.la-diff-pane-meta {
  grid-column: 1; grid-row: 2; font-size: 11px; color: var(--lumiverse-text-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0;
}
.la-diff-pane-actions { grid-column: 2; grid-row: 1 / span 2; align-self: center; display: flex; gap: 8px; }
.la-diff-pane-body {
  flex: 1; overflow: auto; padding: 18px;
  min-height: 0;
}
.la-diff-pane-note {
  background: var(--lumiverse-fill-subtle);
  border: 1px solid var(--lumiverse-border-light);
  border-radius: var(--lumiverse-radius-sm);
  padding: 8px 12px;
  margin-bottom: 14px;
  font-size: 12px;
  color: var(--lumiverse-text-muted);
}

/* ─── Mobile (matches MOBILE_BREAKPOINT_PX in diff-modal.ts) ─── */
/* Tree above pane. Both compact: single-line truncated rows in the tree,
   single-line pane heading + meta. Revert button stays full width but tighter. */
@media (max-width: 720px) {
  .la-diff-modal-toolbar { padding: 6px 8px; gap: 6px; }
  .la-diff-modal-stats { font-size: 11px; }
  .la-diff-view-tab { padding: 3px 8px; font-size: 10px; }

  .la-diff-modal-body {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
  .la-diff-modal-tree {
    max-height: 26vh;
    padding: 4px 4px;
    border-right: none;
    border-bottom: 1px solid var(--lumiverse-border);
  }
  .la-diff-tree-section { margin-bottom: 4px; }
  .la-diff-tree-section-head {
    padding: 3px 6px;
    font-size: 9px;
    letter-spacing: 0.06em;
  }
  .la-diff-tree-row {
    padding: 4px 8px;
    margin-bottom: 1px;
  }
  .la-diff-tree-primary { font-size: 12px; line-height: 1.25; }
  .la-diff-tree-secondary { font-size: 10px; margin-top: 0; line-height: 1.2; }

  .la-diff-pane-toolbar {
    padding: 6px 10px;
    gap: 2px 8px;
  }
  .la-diff-pane-heading { font-size: 12px; }
  .la-diff-pane-meta { font-size: 10px; }
  .la-diff-pane-body { padding: 10px; }
  .la-diff-pane-note { padding: 6px 8px; margin-bottom: 8px; font-size: 11px; }
  .la-diff-pane-actions .la-btn { padding: 4px 9px; font-size: 11px; }
}

/* Side-by-side diff */
.la-diff-sxs {
  display: flex; flex-direction: column;
  font-family: var(--lumiverse-font-mono);
  font-size: 12px;
  line-height: 1.55;
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius);
  overflow: hidden;
}
.la-diff-sxs-head { display: grid; grid-template-columns: 1fr 1fr; background: var(--lumiverse-bg-elevated); }
.la-diff-sxs-headcell {
  padding: 7px 14px; font-weight: 600;
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--lumiverse-text-muted);
  border-bottom: 1px solid var(--lumiverse-border);
}
.la-diff-sxs-headcell-old { border-right: 1px solid var(--lumiverse-border); }
.la-diff-sxs-body { background: var(--lumiverse-bg-dark); }
.la-diff-sxs-row { display: grid; grid-template-columns: 1fr 1fr; }
.la-diff-sxs-cell {
  padding: 2px 14px;
  white-space: pre-wrap; word-wrap: break-word; overflow-wrap: anywhere;
  border-right: 1px solid var(--lumiverse-border-light);
}
.la-diff-sxs-cell:last-child { border-right: none; }
.la-diff-sxs-row.la-diff-sxs-del .la-diff-sxs-old { background: var(--lumiverse-danger-015); }
.la-diff-sxs-row.la-diff-sxs-add .la-diff-sxs-new { background: var(--lumiverse-success-015); }
.la-diff-sxs-row.la-diff-sxs-change .la-diff-sxs-old { background: var(--lumiverse-danger-015); }
.la-diff-sxs-row.la-diff-sxs-change .la-diff-sxs-new { background: var(--lumiverse-success-015); }
.la-diff-sxs-empty { background: var(--lumiverse-bg) !important; }

/* Sessions modal list */
.la-sessions-modal-list { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; }
.la-session-item {
  padding: 10px 14px;
  border: 1px solid var(--lumiverse-border);
  border-radius: var(--lumiverse-radius);
  background: var(--lumiverse-bg-elevated);
  cursor: pointer;
  display: flex; align-items: center; gap: 10px;
  transition: background var(--lumiverse-transition-fast), border-color var(--lumiverse-transition-fast);
}
.la-session-item:hover { background: var(--lumiverse-bg-hover); border-color: var(--lumiverse-border-hover); }
.la-session-item.is-active { border-color: var(--lumiverse-primary-muted); background: var(--lumiverse-primary-010); }
.la-session-item-main { flex: 1; min-width: 0; }
.la-session-item-meta { color: var(--lumiverse-text-muted); font-size: 11px; margin-top: 2px; }
.la-session-item-actions { margin-left: auto; display: flex; gap: 6px; }
.la-session-item-delete {
  margin-left: auto;
  flex-shrink: 0;
  width: 30px; height: 30px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--lumiverse-text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--lumiverse-transition-fast),
              background var(--lumiverse-transition-fast),
              border-color var(--lumiverse-transition-fast),
              color var(--lumiverse-transition-fast);
}
.la-session-item:hover .la-session-item-delete,
.la-session-item-delete:focus-visible { opacity: 1; }
.la-session-item-delete:hover {
  background: var(--lumiverse-danger-015);
  border-color: var(--lumiverse-danger-050);
  color: var(--lumiverse-danger);
}
.la-session-item-delete:disabled { opacity: 0.4; cursor: not-allowed; }
.la-session-item-delete svg { width: 14px; height: 14px; display: block; }

@media (max-width: 640px) {
  .la-header { padding: 8px 10px; }
  .la-thread { padding: 16px 10px 16px; }
  .la-composer { padding: 10px 10px 12px; }
  .la-msg-user .la-msg-bubble { max-width: 92%; }
}
`;

// src/ui/markdown.ts
var ALLOWED_TAGS = new Set([
  "p",
  "br",
  "hr",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "img",
  "span",
  "div"
]);
var DROP_TAGS = new Set([
  "style",
  "script",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "head",
  "title",
  "meta",
  "link",
  "base"
]);
var ALLOWED_ATTRS_PER_TAG = {
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "title"]),
  code: new Set(["class"]),
  pre: new Set(["class"])
};
var ALLOWED_URL_SCHEMES = new Set(["http:", "https:", "mailto:"]);
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
var PLACEHOLDER_PREFIX = " LA_PH_";
var PLACEHOLDER_SUFFIX = " ";
function inlineMarkdown(input, codeSpans) {
  let out = input;
  out = out.replace(/`([^`\n]+)`/g, (_m, code) => {
    const key = `${PLACEHOLDER_PREFIX}${codeSpans.size}${PLACEHOLDER_SUFFIX}`;
    codeSpans.set(key, `<code>${escapeHtml(code)}</code>`);
    return key;
  });
  out = escapeHtml(out);
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => `<a href="${escapeHtml(href)}">${text}</a>`);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  out = out.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, "$1<em>$2</em>");
  out = out.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  for (const [key, html] of codeSpans)
    out = out.split(key).join(html);
  codeSpans.clear();
  return out;
}
function blockMarkdownToHtml(input) {
  if (!input)
    return "";
  const lines = input.replace(/\r\n?/g, `
`).split(`
`);
  const out = [];
  const codeSpans = new Map;
  let i = 0;
  let para = [];
  const flushPara = () => {
    if (para.length === 0)
      return;
    const joined = para.join(`
`);
    if (joined.trim()) {
      out.push(`<p>${inlineMarkdown(joined, codeSpans)}</p>`);
    }
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    const fenceMatch = /^(```+|~~~+)([A-Za-z0-9_+-]*)\s*$/.exec(trimmed);
    if (fenceMatch && fenceMatch[1]) {
      flushPara();
      const fence = fenceMatch[1];
      const fenceChar = fence[0];
      const lang = fenceMatch[2] ?? "";
      i++;
      const buf = [];
      while (i < lines.length) {
        const cur = lines[i] ?? "";
        const closer = new RegExp(`^${fenceChar}{${fence.length},}\\s*$`).exec(cur.trim());
        if (closer) {
          i++;
          break;
        }
        buf.push(cur);
        i++;
      }
      const classAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      out.push(`<pre><code${classAttr}>${escapeHtml(buf.join(`
`))}</code></pre>`);
      continue;
    }
    if (trimmed.length === 0) {
      flushPara();
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading && heading[1] && heading[2] !== undefined) {
      flushPara();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2], codeSpans)}</h${level}>`);
      i++;
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      flushPara();
      const buf = [];
      while (i < lines.length && /^>\s?/.test((lines[i] ?? "").trim())) {
        buf.push((lines[i] ?? "").trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${inlineMarkdown(buf.join(`
`), codeSpans)}</blockquote>`);
      continue;
    }
    const ulMatch = /^(?:[-*+])\s+(.*)$/.exec(trimmed);
    const olMatch = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (ulMatch || olMatch) {
      flushPara();
      const isOrdered = !!olMatch;
      const items = [];
      while (i < lines.length) {
        const cur = (lines[i] ?? "").trim();
        const m = isOrdered ? /^\d+\.\s+(.*)$/.exec(cur) : /^(?:[-*+])\s+(.*)$/.exec(cur);
        if (!m)
          break;
        items.push(`<li>${inlineMarkdown(m[1] ?? "", codeSpans)}</li>`);
        i++;
      }
      out.push(`<${isOrdered ? "ol" : "ul"}>${items.join("")}</${isOrdered ? "ol" : "ul"}>`);
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return out.join(`
`);
}
function isAllowedUrl(url) {
  try {
    const trimmed = url.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith("/"))
      return true;
    const parsed = new URL(trimmed, "https://example.invalid/");
    return ALLOWED_URL_SCHEMES.has(parsed.protocol);
  } catch {
    return false;
  }
}
function sanitizeNode(input, target, doc) {
  const node = input;
  if (node.nodeType === Node.TEXT_NODE) {
    target.appendChild(doc.createTextNode(node.data));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE)
    return;
  const el = node;
  const tagName = el.tagName.toLowerCase();
  if (DROP_TAGS.has(tagName))
    return;
  if (!ALLOWED_TAGS.has(tagName)) {
    for (const child of Array.from(el.childNodes))
      sanitizeNode(child, target, doc);
    return;
  }
  const cleanEl = doc.createElement(tagName);
  const allowedAttrs = ALLOWED_ATTRS_PER_TAG[tagName];
  if (allowedAttrs) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (!allowedAttrs.has(name))
        continue;
      if ((name === "href" || name === "src") && !isAllowedUrl(attr.value))
        continue;
      cleanEl.setAttribute(name, attr.value);
    }
  }
  if (tagName === "a") {
    cleanEl.setAttribute("rel", "noopener noreferrer nofollow");
    cleanEl.setAttribute("target", "_blank");
  }
  if (tagName === "img") {
    cleanEl.setAttribute("loading", "lazy");
    cleanEl.setAttribute("referrerpolicy", "no-referrer");
  }
  for (const child of Array.from(el.childNodes))
    sanitizeNode(child, cleanEl, doc);
  target.appendChild(cleanEl);
}
function renderMarkdown(raw) {
  const doc = document;
  const frag = doc.createDocumentFragment();
  if (!raw)
    return frag;
  const html = blockMarkdownToHtml(raw);
  const parsed = new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html");
  const sourceRoot = parsed.getElementById("root");
  if (!sourceRoot) {
    frag.appendChild(doc.createTextNode(raw));
    return frag;
  }
  const wrapper = doc.createElement("div");
  for (const child of Array.from(sourceRoot.childNodes))
    sanitizeNode(child, wrapper, doc);
  for (const child of Array.from(wrapper.childNodes))
    frag.appendChild(child);
  return frag;
}
// node_modules/diff/libesm/diff/base.js
class Diff {
  diff(oldStr, newStr, options = {}) {
    let callback;
    if (typeof options === "function") {
      callback = options;
      options = {};
    } else if ("callback" in options) {
      callback = options.callback;
    }
    const oldString = this.castInput(oldStr, options);
    const newString = this.castInput(newStr, options);
    const oldTokens = this.removeEmpty(this.tokenize(oldString, options));
    const newTokens = this.removeEmpty(this.tokenize(newString, options));
    return this.diffWithOptionsObj(oldTokens, newTokens, options, callback);
  }
  diffWithOptionsObj(oldTokens, newTokens, options, callback) {
    var _a;
    const done = (value) => {
      value = this.postProcess(value, options);
      if (callback) {
        setTimeout(function() {
          callback(value);
        }, 0);
        return;
      } else {
        return value;
      }
    };
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let editLength = 1;
    let maxEditLength = newLen + oldLen;
    if (options.maxEditLength != null) {
      maxEditLength = Math.min(maxEditLength, options.maxEditLength);
    }
    const maxExecutionTime = (_a = options.timeout) !== null && _a !== undefined ? _a : Infinity;
    const abortAfterTimestamp = Date.now() + maxExecutionTime;
    const bestPath = [{ oldPos: -1, lastComponent: undefined }];
    let newPos = this.extractCommon(bestPath[0], newTokens, oldTokens, 0, options);
    if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
      return done(this.buildValues(bestPath[0].lastComponent, newTokens, oldTokens));
    }
    let minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
    const execEditLength = () => {
      for (let diagonalPath = Math.max(minDiagonalToConsider, -editLength);diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
        let basePath;
        const removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
        if (removePath) {
          bestPath[diagonalPath - 1] = undefined;
        }
        let canAdd = false;
        if (addPath) {
          const addPathNewPos = addPath.oldPos - diagonalPath;
          canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
        }
        const canRemove = removePath && removePath.oldPos + 1 < oldLen;
        if (!canAdd && !canRemove) {
          bestPath[diagonalPath] = undefined;
          continue;
        }
        if (!canRemove || canAdd && removePath.oldPos < addPath.oldPos) {
          basePath = this.addToPath(addPath, true, false, 0, options);
        } else {
          basePath = this.addToPath(removePath, false, true, 1, options);
        }
        newPos = this.extractCommon(basePath, newTokens, oldTokens, diagonalPath, options);
        if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
          return done(this.buildValues(basePath.lastComponent, newTokens, oldTokens)) || true;
        } else {
          bestPath[diagonalPath] = basePath;
          if (basePath.oldPos + 1 >= oldLen) {
            maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
          }
          if (newPos + 1 >= newLen) {
            minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
          }
        }
      }
      editLength++;
    };
    if (callback) {
      (function exec() {
        setTimeout(function() {
          if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) {
            return callback(undefined);
          }
          if (!execEditLength()) {
            exec();
          }
        }, 0);
      })();
    } else {
      while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
        const ret = execEditLength();
        if (ret) {
          return ret;
        }
      }
    }
  }
  addToPath(path, added, removed, oldPosInc, options) {
    const last = path.lastComponent;
    if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) {
      return {
        oldPos: path.oldPos + oldPosInc,
        lastComponent: { count: last.count + 1, added, removed, previousComponent: last.previousComponent }
      };
    } else {
      return {
        oldPos: path.oldPos + oldPosInc,
        lastComponent: { count: 1, added, removed, previousComponent: last }
      };
    }
  }
  extractCommon(basePath, newTokens, oldTokens, diagonalPath, options) {
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
    while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(oldTokens[oldPos + 1], newTokens[newPos + 1], options)) {
      newPos++;
      oldPos++;
      commonCount++;
      if (options.oneChangePerToken) {
        basePath.lastComponent = { count: 1, previousComponent: basePath.lastComponent, added: false, removed: false };
      }
    }
    if (commonCount && !options.oneChangePerToken) {
      basePath.lastComponent = { count: commonCount, previousComponent: basePath.lastComponent, added: false, removed: false };
    }
    basePath.oldPos = oldPos;
    return newPos;
  }
  equals(left, right, options) {
    if (options.comparator) {
      return options.comparator(left, right);
    } else {
      return left === right || !!options.ignoreCase && left.toLowerCase() === right.toLowerCase();
    }
  }
  removeEmpty(array) {
    const ret = [];
    for (let i = 0;i < array.length; i++) {
      if (array[i]) {
        ret.push(array[i]);
      }
    }
    return ret;
  }
  castInput(value, options) {
    return value;
  }
  tokenize(value, options) {
    return Array.from(value);
  }
  join(chars) {
    return chars.join("");
  }
  postProcess(changeObjects, options) {
    return changeObjects;
  }
  get useLongestToken() {
    return false;
  }
  buildValues(lastComponent, newTokens, oldTokens) {
    const components = [];
    let nextComponent;
    while (lastComponent) {
      components.push(lastComponent);
      nextComponent = lastComponent.previousComponent;
      delete lastComponent.previousComponent;
      lastComponent = nextComponent;
    }
    components.reverse();
    const componentLen = components.length;
    let componentPos = 0, newPos = 0, oldPos = 0;
    for (;componentPos < componentLen; componentPos++) {
      const component = components[componentPos];
      if (!component.removed) {
        if (!component.added && this.useLongestToken) {
          let value = newTokens.slice(newPos, newPos + component.count);
          value = value.map(function(value2, i) {
            const oldValue = oldTokens[oldPos + i];
            return oldValue.length > value2.length ? oldValue : value2;
          });
          component.value = this.join(value);
        } else {
          component.value = this.join(newTokens.slice(newPos, newPos + component.count));
        }
        newPos += component.count;
        if (!component.added) {
          oldPos += component.count;
        }
      } else {
        component.value = this.join(oldTokens.slice(oldPos, oldPos + component.count));
        oldPos += component.count;
      }
    }
    return components;
  }
}

// node_modules/diff/libesm/util/string.js
function longestCommonPrefix(str1, str2) {
  let i;
  for (i = 0;i < str1.length && i < str2.length; i++) {
    if (str1[i] != str2[i]) {
      return str1.slice(0, i);
    }
  }
  return str1.slice(0, i);
}
function longestCommonSuffix(str1, str2) {
  let i;
  if (!str1 || !str2 || str1[str1.length - 1] != str2[str2.length - 1]) {
    return "";
  }
  for (i = 0;i < str1.length && i < str2.length; i++) {
    if (str1[str1.length - (i + 1)] != str2[str2.length - (i + 1)]) {
      return str1.slice(-i);
    }
  }
  return str1.slice(-i);
}
function replacePrefix(string, oldPrefix, newPrefix) {
  if (string.slice(0, oldPrefix.length) != oldPrefix) {
    throw Error(`string ${JSON.stringify(string)} doesn't start with prefix ${JSON.stringify(oldPrefix)}; this is a bug`);
  }
  return newPrefix + string.slice(oldPrefix.length);
}
function replaceSuffix(string, oldSuffix, newSuffix) {
  if (!oldSuffix) {
    return string + newSuffix;
  }
  if (string.slice(-oldSuffix.length) != oldSuffix) {
    throw Error(`string ${JSON.stringify(string)} doesn't end with suffix ${JSON.stringify(oldSuffix)}; this is a bug`);
  }
  return string.slice(0, -oldSuffix.length) + newSuffix;
}
function removePrefix(string, oldPrefix) {
  return replacePrefix(string, oldPrefix, "");
}
function removeSuffix(string, oldSuffix) {
  return replaceSuffix(string, oldSuffix, "");
}
function maximumOverlap(string1, string2) {
  return string2.slice(0, overlapCount(string1, string2));
}
function overlapCount(a, b) {
  let startA = 0;
  if (a.length > b.length) {
    startA = a.length - b.length;
  }
  let endB = b.length;
  if (a.length < b.length) {
    endB = a.length;
  }
  const map = Array(endB);
  let k = 0;
  map[0] = 0;
  for (let j = 1;j < endB; j++) {
    if (b[j] == b[k]) {
      map[j] = map[k];
    } else {
      map[j] = k;
    }
    while (k > 0 && b[j] != b[k]) {
      k = map[k];
    }
    if (b[j] == b[k]) {
      k++;
    }
  }
  k = 0;
  for (let i = startA;i < a.length; i++) {
    while (k > 0 && a[i] != b[k]) {
      k = map[k];
    }
    if (a[i] == b[k]) {
      k++;
    }
  }
  return k;
}
function segment(string, segmenter) {
  const parts = [];
  for (const segmentObj of Array.from(segmenter.segment(string))) {
    const segment2 = segmentObj.segment;
    if (parts.length && /\s/.test(parts[parts.length - 1]) && /\s/.test(segment2)) {
      parts[parts.length - 1] += segment2;
    } else {
      parts.push(segment2);
    }
  }
  return parts;
}
function trailingWs(string, segmenter) {
  if (segmenter) {
    return leadingAndTrailingWs(string, segmenter)[1];
  }
  let i;
  for (i = string.length - 1;i >= 0; i--) {
    if (!string[i].match(/\s/)) {
      break;
    }
  }
  return string.substring(i + 1);
}
function leadingWs(string, segmenter) {
  if (segmenter) {
    return leadingAndTrailingWs(string, segmenter)[0];
  }
  const match = string.match(/^\s*/);
  return match ? match[0] : "";
}
function leadingAndTrailingWs(string, segmenter) {
  if (!segmenter) {
    return [leadingWs(string), trailingWs(string)];
  }
  if (segmenter.resolvedOptions().granularity != "word") {
    throw new Error('The segmenter passed must have a granularity of "word"');
  }
  const segments = segment(string, segmenter);
  const firstSeg = segments[0];
  const lastSeg = segments[segments.length - 1];
  const head = /\s/.test(firstSeg) ? firstSeg : "";
  const tail = /\s/.test(lastSeg) ? lastSeg : "";
  return [head, tail];
}

// node_modules/diff/libesm/diff/word.js
var extendedWordChars = "a-zA-Z0-9_\\u{AD}\\u{C0}-\\u{D6}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}";
var tokenizeIncludingWhitespace = new RegExp(`[${extendedWordChars}]+|\\s+|[^${extendedWordChars}]`, "ug");

class WordDiff extends Diff {
  equals(left, right, options) {
    if (options.ignoreCase) {
      left = left.toLowerCase();
      right = right.toLowerCase();
    }
    return left.trim() === right.trim();
  }
  tokenize(value, options = {}) {
    let parts;
    if (options.intlSegmenter) {
      const segmenter = options.intlSegmenter;
      if (segmenter.resolvedOptions().granularity != "word") {
        throw new Error('The segmenter passed must have a granularity of "word"');
      }
      parts = segment(value, segmenter);
    } else {
      parts = value.match(tokenizeIncludingWhitespace) || [];
    }
    const tokens = [];
    let prevPart = null;
    parts.forEach((part) => {
      if (/\s/.test(part)) {
        if (prevPart == null) {
          tokens.push(part);
        } else {
          tokens.push(tokens.pop() + part);
        }
      } else if (prevPart != null && /\s/.test(prevPart)) {
        if (tokens[tokens.length - 1] == prevPart) {
          tokens.push(tokens.pop() + part);
        } else {
          tokens.push(prevPart + part);
        }
      } else {
        tokens.push(part);
      }
      prevPart = part;
    });
    return tokens;
  }
  join(tokens) {
    return tokens.map((token, i) => {
      if (i == 0) {
        return token;
      } else {
        return token.replace(/^\s+/, "");
      }
    }).join("");
  }
  postProcess(changes, options) {
    if (!changes || options.oneChangePerToken) {
      return changes;
    }
    let lastKeep = null;
    let insertion = null;
    let deletion = null;
    changes.forEach((change) => {
      if (change.added) {
        insertion = change;
      } else if (change.removed) {
        deletion = change;
      } else {
        if (insertion || deletion) {
          dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, change, options.intlSegmenter);
        }
        lastKeep = change;
        insertion = null;
        deletion = null;
      }
    });
    if (insertion || deletion) {
      dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, null, options.intlSegmenter);
    }
    return changes;
  }
}
var wordDiff = new WordDiff;
function dedupeWhitespaceInChangeObjects(startKeep, deletion, insertion, endKeep, segmenter) {
  if (deletion && insertion) {
    const [oldWsPrefix, oldWsSuffix] = leadingAndTrailingWs(deletion.value, segmenter);
    const [newWsPrefix, newWsSuffix] = leadingAndTrailingWs(insertion.value, segmenter);
    if (startKeep) {
      const commonWsPrefix = longestCommonPrefix(oldWsPrefix, newWsPrefix);
      startKeep.value = replaceSuffix(startKeep.value, newWsPrefix, commonWsPrefix);
      deletion.value = removePrefix(deletion.value, commonWsPrefix);
      insertion.value = removePrefix(insertion.value, commonWsPrefix);
    }
    if (endKeep) {
      const commonWsSuffix = longestCommonSuffix(oldWsSuffix, newWsSuffix);
      endKeep.value = replacePrefix(endKeep.value, newWsSuffix, commonWsSuffix);
      deletion.value = removeSuffix(deletion.value, commonWsSuffix);
      insertion.value = removeSuffix(insertion.value, commonWsSuffix);
    }
  } else if (insertion) {
    if (startKeep) {
      const ws = leadingWs(insertion.value, segmenter);
      insertion.value = insertion.value.substring(ws.length);
    }
    if (endKeep) {
      const ws = leadingWs(endKeep.value, segmenter);
      endKeep.value = endKeep.value.substring(ws.length);
    }
  } else if (startKeep && endKeep) {
    const newWsFull = leadingWs(endKeep.value, segmenter), [delWsStart, delWsEnd] = leadingAndTrailingWs(deletion.value, segmenter);
    const newWsStart = longestCommonPrefix(newWsFull, delWsStart);
    deletion.value = removePrefix(deletion.value, newWsStart);
    const newWsEnd = longestCommonSuffix(removePrefix(newWsFull, newWsStart), delWsEnd);
    deletion.value = removeSuffix(deletion.value, newWsEnd);
    endKeep.value = replacePrefix(endKeep.value, newWsFull, newWsEnd);
    startKeep.value = replaceSuffix(startKeep.value, newWsFull, newWsFull.slice(0, newWsFull.length - newWsEnd.length));
  } else if (endKeep) {
    const endKeepWsPrefix = leadingWs(endKeep.value, segmenter);
    const deletionWsSuffix = trailingWs(deletion.value, segmenter);
    const overlap = maximumOverlap(deletionWsSuffix, endKeepWsPrefix);
    deletion.value = removeSuffix(deletion.value, overlap);
  } else if (startKeep) {
    const startKeepWsSuffix = trailingWs(startKeep.value, segmenter);
    const deletionWsPrefix = leadingWs(deletion.value, segmenter);
    const overlap = maximumOverlap(startKeepWsSuffix, deletionWsPrefix);
    deletion.value = removePrefix(deletion.value, overlap);
  }
}

class WordsWithSpaceDiff extends Diff {
  tokenize(value) {
    const regex = new RegExp(`(\\r?\\n)|[${extendedWordChars}]+|[^\\S\\n\\r]+|[^${extendedWordChars}]`, "ug");
    return value.match(regex) || [];
  }
}
var wordsWithSpaceDiff = new WordsWithSpaceDiff;
function diffWordsWithSpace(oldStr, newStr, options) {
  return wordsWithSpaceDiff.diff(oldStr, newStr, options);
}

// node_modules/diff/libesm/diff/line.js
class LineDiff extends Diff {
  constructor() {
    super(...arguments);
    this.tokenize = tokenize;
  }
  equals(left, right, options) {
    if (options.ignoreWhitespace) {
      if (!options.newlineIsToken || !left.includes(`
`)) {
        left = left.trim();
      }
      if (!options.newlineIsToken || !right.includes(`
`)) {
        right = right.trim();
      }
    } else if (options.ignoreNewlineAtEof && !options.newlineIsToken) {
      if (left.endsWith(`
`)) {
        left = left.slice(0, -1);
      }
      if (right.endsWith(`
`)) {
        right = right.slice(0, -1);
      }
    }
    return super.equals(left, right, options);
  }
}
var lineDiff = new LineDiff;
function diffLines(oldStr, newStr, options) {
  return lineDiff.diff(oldStr, newStr, options);
}
function tokenize(value, options) {
  if (options.stripTrailingCr) {
    value = value.replace(/\r\n/g, `
`);
  }
  const retLines = [], linesAndNewlines = value.split(/(\n|\r\n)/);
  if (!linesAndNewlines[linesAndNewlines.length - 1]) {
    linesAndNewlines.pop();
  }
  for (let i = 0;i < linesAndNewlines.length; i++) {
    const line = linesAndNewlines[i];
    if (i % 2 && !options.newlineIsToken) {
      retLines[retLines.length - 1] += line;
    } else {
      retLines.push(line);
    }
  }
  return retLines;
}
// src/ui/diff.ts
var MAX_LINE_CHARS = 4000;
var DEFAULT_CONTEXT_LINES = 3;
var EXPAND_CHUNK_LINES = 20;
function trunc(s) {
  if (s.length <= MAX_LINE_CHARS)
    return s;
  return `${s.slice(0, MAX_LINE_CHARS)} … (truncated, ${s.length} chars total)`;
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls)
    e.className = cls;
  if (text !== undefined)
    e.textContent = text;
  return e;
}
function computeDiffStats(before, after) {
  if (before === after)
    return { added: 0, removed: 0, unchanged: before.split(`
`).length };
  const parts = diffLines(before, after);
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const p of parts) {
    const lineCount = p.value.endsWith(`
`) ? p.count ?? p.value.split(`
`).length - 1 : p.count ?? p.value.split(`
`).length;
    if (p.added)
      added += lineCount;
    else if (p.removed)
      removed += lineCount;
    else
      unchanged += lineCount;
  }
  return { added, removed, unchanged };
}
function renderInlineFieldDiff(before, after) {
  const wrap = el("div", "la-diff-inline");
  const parts = diffWordsWithSpace(before, after);
  for (const p of parts) {
    if (p.added) {
      const s = el("span", "la-diff-add");
      s.textContent = trunc(p.value);
      wrap.appendChild(s);
    } else if (p.removed) {
      const s = el("span", "la-diff-del");
      s.textContent = trunc(p.value);
      wrap.appendChild(s);
    } else {
      const s = el("span", "la-diff-ctx");
      s.textContent = trunc(p.value);
      wrap.appendChild(s);
    }
  }
  return wrap;
}
function buildDiffLines(before, after) {
  const parts = diffLines(before, after);
  const out = [];
  let oldN = 1;
  let newN = 1;
  for (const p of parts) {
    const lines = p.value.split(`
`);
    if (lines.length > 0 && lines[lines.length - 1] === "")
      lines.pop();
    for (const line of lines) {
      if (p.added) {
        out.push({ kind: "add", text: line, oldLineNum: null, newLineNum: newN++ });
      } else if (p.removed) {
        out.push({ kind: "del", text: line, oldLineNum: oldN++, newLineNum: null });
      } else {
        out.push({ kind: "ctx", text: line, oldLineNum: oldN++, newLineNum: newN++ });
      }
    }
  }
  return out;
}
function findVisibleRanges(lines, context) {
  if (lines.length === 0)
    return [];
  const visible = new Array(lines.length).fill(false);
  for (let i2 = 0;i2 < lines.length; i2++) {
    if (lines[i2].kind === "ctx")
      continue;
    const lo = Math.max(0, i2 - context);
    const hi = Math.min(lines.length - 1, i2 + context);
    for (let j = lo;j <= hi; j++)
      visible[j] = true;
  }
  const ranges = [];
  let i = 0;
  while (i < lines.length) {
    if (!visible[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < lines.length && visible[j + 1])
      j++;
    ranges.push([i, j]);
    i = j + 1;
  }
  return ranges;
}
function renderDiffLine(line, showNumbers) {
  const cls = line.kind === "add" ? "la-diff-add-row" : line.kind === "del" ? "la-diff-del-row" : "la-diff-ctx";
  const sigil = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  const row = el("div", `la-diff-row ${cls}`);
  if (showNumbers) {
    const oldCol = el("span", "la-diff-lineno la-diff-lineno-old", line.oldLineNum === null ? "" : String(line.oldLineNum));
    const newCol = el("span", "la-diff-lineno la-diff-lineno-new", line.newLineNum === null ? "" : String(line.newLineNum));
    row.append(oldCol, newCol);
  }
  const sigilEl = el("span", "la-diff-sigil", sigil);
  const textEl = el("span", "la-diff-text", trunc(line.text));
  row.append(sigilEl, textEl);
  return row;
}
function renderGap(lines, from, to, showNumbers) {
  const remaining = to - from + 1;
  const btn = el("button", "la-diff-gap-expander");
  btn.type = "button";
  const setLabel = (n, leftover) => {
    const more = leftover > 0 ? ` (${leftover} more hidden)` : "";
    btn.textContent = `…  expand ${n} unchanged line${n === 1 ? "" : "s"}${more}  …`;
  };
  setLabel(Math.min(EXPAND_CHUNK_LINES, remaining), Math.max(0, remaining - EXPAND_CHUNK_LINES));
  let cursor = from;
  btn.addEventListener("click", () => {
    const chunkEnd = Math.min(cursor + EXPAND_CHUNK_LINES - 1, to);
    const frag = document.createDocumentFragment();
    for (let i = cursor;i <= chunkEnd; i++) {
      frag.appendChild(renderDiffLine(lines[i], showNumbers));
    }
    cursor = chunkEnd + 1;
    if (cursor > to) {
      btn.replaceWith(frag);
    } else {
      const leftover = to - cursor + 1;
      const nextChunk = Math.min(EXPAND_CHUNK_LINES, leftover);
      setLabel(nextChunk, leftover - nextChunk);
      btn.before(frag);
    }
  });
  return btn;
}
function renderUnifiedDiff(before, after, contextLines = DEFAULT_CONTEXT_LINES) {
  const wrap = el("div", "la-diff-unified");
  if (before === after) {
    wrap.appendChild(el("div", "la-diff-empty", "(no changes)"));
    return wrap;
  }
  const lines = buildDiffLines(before, after);
  const ranges = findVisibleRanges(lines, contextLines);
  const showNumbers = lines.length >= 8;
  if (ranges.length === 0) {
    for (const line of lines)
      wrap.appendChild(renderDiffLine(line, showNumbers));
    return wrap;
  }
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (cursor < start)
      wrap.appendChild(renderGap(lines, cursor, start - 1, showNumbers));
    for (let i = start;i <= end; i++)
      wrap.appendChild(renderDiffLine(lines[i], showNumbers));
    cursor = end + 1;
  }
  if (cursor < lines.length)
    wrap.appendChild(renderGap(lines, cursor, lines.length - 1, showNumbers));
  return wrap;
}
function buildSxsPairs(before, after) {
  const parts = diffLines(before, after);
  const pairs = [];
  let oldN = 1;
  let newN = 1;
  for (let i = 0;i < parts.length; i++) {
    const p = parts[i];
    const next = parts[i + 1];
    if (p.removed && next && next.added) {
      const oldLines = p.value.split(`
`);
      const newLines = next.value.split(`
`);
      if (oldLines[oldLines.length - 1] === "")
        oldLines.pop();
      if (newLines[newLines.length - 1] === "")
        newLines.pop();
      const m = Math.max(oldLines.length, newLines.length);
      for (let k = 0;k < m; k++) {
        const hasOld = k < oldLines.length;
        const hasNew = k < newLines.length;
        pairs.push({
          left: hasOld ? oldLines[k] ?? "" : null,
          right: hasNew ? newLines[k] ?? "" : null,
          kind: "change",
          oldLineNum: hasOld ? oldN++ : null,
          newLineNum: hasNew ? newN++ : null
        });
      }
      i++;
      continue;
    }
    const lines = p.value.split(`
`);
    if (lines[lines.length - 1] === "")
      lines.pop();
    if (p.added) {
      for (const l of lines)
        pairs.push({ left: null, right: l, kind: "add", oldLineNum: null, newLineNum: newN++ });
    } else if (p.removed) {
      for (const l of lines)
        pairs.push({ left: l, right: null, kind: "del", oldLineNum: oldN++, newLineNum: null });
    } else {
      for (const l of lines)
        pairs.push({ left: l, right: l, kind: "ctx", oldLineNum: oldN++, newLineNum: newN++ });
    }
  }
  return pairs;
}
function findSxsVisibleRanges(pairs, context) {
  if (pairs.length === 0)
    return [];
  const visible = new Array(pairs.length).fill(false);
  for (let i2 = 0;i2 < pairs.length; i2++) {
    if (pairs[i2].kind === "ctx")
      continue;
    const lo = Math.max(0, i2 - context);
    const hi = Math.min(pairs.length - 1, i2 + context);
    for (let j = lo;j <= hi; j++)
      visible[j] = true;
  }
  const ranges = [];
  let i = 0;
  while (i < pairs.length) {
    if (!visible[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < pairs.length && visible[j + 1])
      j++;
    ranges.push([i, j]);
    i = j + 1;
  }
  return ranges;
}
function renderSxsRow(pair) {
  const r = el("div", `la-diff-sxs-row la-diff-sxs-${pair.kind}`);
  const l = el("div", "la-diff-sxs-cell la-diff-sxs-old");
  const rt = el("div", "la-diff-sxs-cell la-diff-sxs-new");
  l.textContent = pair.left === null ? "" : trunc(pair.left);
  rt.textContent = pair.right === null ? "" : trunc(pair.right);
  if (pair.left === null)
    l.classList.add("la-diff-sxs-empty");
  if (pair.right === null)
    rt.classList.add("la-diff-sxs-empty");
  r.appendChild(l);
  r.appendChild(rt);
  return r;
}
function renderSxsGap(pairs, from, to) {
  const remaining = to - from + 1;
  const btn = el("button", "la-diff-sxs-gap-expander");
  btn.type = "button";
  const setLabel = (n, leftover) => {
    const more = leftover > 0 ? ` (${leftover} more hidden)` : "";
    btn.textContent = `…  expand ${n} unchanged line${n === 1 ? "" : "s"}${more}  …`;
  };
  setLabel(Math.min(EXPAND_CHUNK_LINES, remaining), Math.max(0, remaining - EXPAND_CHUNK_LINES));
  let cursor = from;
  btn.addEventListener("click", () => {
    const chunkEnd = Math.min(cursor + EXPAND_CHUNK_LINES - 1, to);
    const frag = document.createDocumentFragment();
    for (let i = cursor;i <= chunkEnd; i++)
      frag.appendChild(renderSxsRow(pairs[i]));
    cursor = chunkEnd + 1;
    if (cursor > to) {
      btn.replaceWith(frag);
    } else {
      const leftover = to - cursor + 1;
      const nextChunk = Math.min(EXPAND_CHUNK_LINES, leftover);
      setLabel(nextChunk, leftover - nextChunk);
      btn.before(frag);
    }
  });
  return btn;
}
function renderSideBySideDiff(before, after, contextLines = DEFAULT_CONTEXT_LINES) {
  const root = el("div", "la-diff-sxs");
  const head = el("div", "la-diff-sxs-head");
  head.appendChild(el("div", "la-diff-sxs-headcell la-diff-sxs-headcell-old", "Before"));
  head.appendChild(el("div", "la-diff-sxs-headcell la-diff-sxs-headcell-new", "After"));
  root.appendChild(head);
  const body = el("div", "la-diff-sxs-body");
  if (before === after) {
    body.appendChild(el("div", "la-diff-empty", "(no changes)"));
    root.appendChild(body);
    return root;
  }
  const pairs = buildSxsPairs(before, after);
  const ranges = findSxsVisibleRanges(pairs, contextLines);
  if (ranges.length === 0) {
    for (const pair of pairs)
      body.appendChild(renderSxsRow(pair));
    root.appendChild(body);
    return root;
  }
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (cursor < start)
      body.appendChild(renderSxsGap(pairs, cursor, start - 1));
    for (let i = start;i <= end; i++)
      body.appendChild(renderSxsRow(pairs[i]));
    cursor = end + 1;
  }
  if (cursor < pairs.length)
    body.appendChild(renderSxsGap(pairs, cursor, pairs.length - 1));
  root.appendChild(body);
  return root;
}
function isShortField(before, after) {
  const longest = Math.max(before.length, after.length);
  const newlines = (before + `
` + after).split(`
`).length - 1;
  return longest < 120 && newlines <= 2;
}

// src/ui/icons.ts
var STROKE = `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
var ICON_RETRY = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M21 3V8M21 8H16M21 8L18 5.29168C16.4077 3.86656 14.3051 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21C16.2832 21 19.8675 18.008 20.777 14" ${STROKE}/></svg>`;
var ICON_EDIT = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M20 16v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" ${STROKE}/><polygon points="12.5 15.8 22 6.2 17.8 2 8.3 11.5 8 16 12.5 15.8" ${STROKE}/></svg>`;
var ICON_TRASH = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6" ${STROKE}/></svg>`;

// src/ui/loading.ts
var WORDS = [
  "Accomplishing",
  "Actioning",
  "Actualizing",
  "Baking",
  "Booping",
  "Brewing",
  "Calculating",
  "Cerebrating",
  "Channelling",
  "Churning",
  "Clauding",
  "Coalescing",
  "Cogitating",
  "Combobulating",
  "Computing",
  "Concocting",
  "Conjuring",
  "Considering",
  "Contemplating",
  "Cooking",
  "Crafting",
  "Creating",
  "Crunching",
  "Deciphering",
  "Deliberating",
  "Determining",
  "Discombobulating",
  "Divining",
  "Doing",
  "Effecting",
  "Elucidating",
  "Enchanting",
  "Envisioning",
  "Finagling",
  "Flibbertigibbeting",
  "Forging",
  "Forming",
  "Frolicking",
  "Generating",
  "Germinating",
  "Hatching",
  "Herding",
  "Honking",
  "Hustling",
  "Ideating",
  "Imagining",
  "Incubating",
  "Inferring",
  "Jiving",
  "Manifesting",
  "Marinating",
  "Meandering",
  "Moseying",
  "Mulling",
  "Mustering",
  "Musing",
  "Noodling",
  "Percolating",
  "Perusing",
  "Philosophising",
  "Pondering",
  "Pontificating",
  "Processing",
  "Puttering",
  "Puzzling",
  "Reticulating",
  "Ruminating",
  "Scheming",
  "Schlepping",
  "Shimmying",
  "Shucking",
  "Simmering",
  "Smooshing",
  "Spelunking",
  "Spinning",
  "Stewing",
  "Sussing",
  "Synthesizing",
  "Thinking",
  "Tinkering",
  "Transmuting",
  "Unfurling",
  "Unravelling",
  "Vibing",
  "Wandering",
  "Whirring",
  "Wibbling",
  "Wizarding",
  "Working",
  "Wrangling"
];
var SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
var SCRAMBLE_MS = 480;
var HOLD_MIN_MS = 2400;
var HOLD_JITTER_MS = 1400;
function randomChar() {
  return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
}
function pickWord(exclude) {
  let pick = WORDS[Math.floor(Math.random() * WORDS.length)];
  if (exclude && pick === exclude) {
    pick = WORDS[(WORDS.indexOf(pick) + 1) % WORDS.length];
  }
  return pick;
}
function mountLoading(parent) {
  const wrap = document.createElement("div");
  wrap.className = "la-thinking";
  const spinner = document.createElement("span");
  spinner.className = `la-ld ${pickLoaderVariant()}`;
  const word = document.createElement("span");
  word.className = "la-thinking-word";
  const dots = document.createElement("span");
  dots.className = "la-thinking-dots";
  dots.innerHTML = "<span>.</span><span>.</span><span>.</span>";
  wrap.append(spinner, word, dots);
  parent.appendChild(wrap);
  let active = true;
  let current = pickWord(null);
  word.textContent = current;
  let rafHandle = null;
  let timeoutHandle = null;
  const animateTo = (target) => new Promise((resolve) => {
    const start = performance.now();
    const sourceLen = current.length;
    const targetLen = target.length;
    const maxLen = Math.max(sourceLen, targetLen);
    const stepMs = SCRAMBLE_MS / Math.max(1, maxLen);
    const frame = (now) => {
      if (!active) {
        resolve();
        return;
      }
      const elapsed = now - start;
      let out = "";
      for (let i = 0;i < maxLen; i++) {
        const lockAt = i * stepMs;
        if (elapsed >= lockAt + 60) {
          if (i < targetLen)
            out += target[i];
        } else if (elapsed >= lockAt) {
          out += Math.random() < 0.5 && i < targetLen ? target[i] : randomChar();
        } else {
          if (i < Math.max(sourceLen, targetLen))
            out += randomChar();
        }
      }
      word.textContent = out;
      if (elapsed < SCRAMBLE_MS + 80) {
        rafHandle = requestAnimationFrame(frame);
      } else {
        word.textContent = target;
        current = target;
        resolve();
      }
    };
    rafHandle = requestAnimationFrame(frame);
  });
  const cycle = async () => {
    if (!active)
      return;
    const next = pickWord(current);
    await animateTo(next);
    if (!active)
      return;
    timeoutHandle = setTimeout(cycle, HOLD_MIN_MS + Math.random() * HOLD_JITTER_MS);
  };
  timeoutHandle = setTimeout(cycle, 1400);
  return {
    destroy() {
      active = false;
      if (rafHandle !== null)
        cancelAnimationFrame(rafHandle);
      if (timeoutHandle !== null)
        clearTimeout(timeoutHandle);
      wrap.remove();
    }
  };
}

// src/ui/chat-thread.ts
function el2(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls)
    e.className = cls;
  if (text !== undefined)
    e.textContent = text;
  return e;
}
function describeToolActivity(name, args) {
  const s = (k) => typeof args[k] === "string" ? args[k] : undefined;
  const n = (k) => typeof args[k] === "number" ? args[k] : undefined;
  switch (name) {
    case "list_characters":
      return { kind: "read", verb: "Listing", target: "characters" };
    case "list_connections":
      return { kind: "read", verb: "Listing", target: "connections" };
    case "list_world_books":
      return { kind: "read", verb: "Listing", target: "world books" };
    case "list_world_book_entries":
      return { kind: "read", verb: "Listing", target: "world book entries" };
    case "list_regex_scripts":
      return { kind: "read", verb: "Listing", target: "regex scripts" };
    case "list_alternate_greetings":
      return { kind: "read", verb: "Listing", target: "alternate greetings" };
    case "list_extension_keys": {
      const p = s("path");
      return { kind: "read", verb: "Inspecting", target: p ? `extensions.${p}` : "extensions" };
    }
    case "grep_card":
      return { kind: "search", verb: "Searching", target: `for ${JSON.stringify(s("pattern") ?? "")}` };
    case "survey_cjk":
      return { kind: "search", verb: "Surveying", target: "CJK runs across the card" };
    case "read_character_field":
      return { kind: "read", verb: "Reading", target: s("field") ?? "character field" };
    case "read_alternate_greeting": {
      const i = n("index");
      return { kind: "read", verb: "Reading", target: `alternate_greetings[${i ?? "?"}]` };
    }
    case "read_world_book_entry":
      return { kind: "read", verb: "Reading", target: `world book entry ${s("entry_id") ?? "?"}` };
    case "read_regex_script_meta":
      return { kind: "read", verb: "Reading", target: `regex script ${s("script_id") ?? "?"} metadata` };
    case "read_regex_script_field":
      return { kind: "read", verb: "Reading", target: `regex script ${s("script_id") ?? "?"}.${s("field") ?? "?"}` };
    case "read_character_extension":
      return { kind: "read", verb: "Reading", target: `extensions.${s("path") ?? "?"}` };
    case "edit_character_field":
      return { kind: "write", verb: "Editing", target: s("field") ?? "character field" };
    case "edit_alternate_greeting": {
      const i = n("index");
      return { kind: "write", verb: "Editing", target: `alternate_greetings[${i ?? "?"}]` };
    }
    case "edit_world_book_entry":
      return { kind: "write", verb: "Editing", target: `world book entry ${s("entry_id") ?? "?"}` };
    case "edit_regex_script_field":
      return { kind: "write", verb: "Editing", target: `regex script ${s("script_id") ?? "?"}.${s("field") ?? "?"}` };
    case "edit_character_extension":
      return { kind: "write", verb: "Editing", target: `extensions.${s("path") ?? "?"}` };
    case "update_character":
      return { kind: "write", verb: "Updating", target: `character (${Object.keys(args["patch"] ?? {}).join(", ")})` };
    case "update_world_book_entry":
      return { kind: "write", verb: "Updating", target: `world book entry ${s("entry_id") ?? "?"}` };
    case "update_regex_script":
      return { kind: "write", verb: "Updating", target: `regex script ${s("script_id") ?? "?"}` };
    case "update_character_extension":
      return { kind: "write", verb: "Replacing", target: `extensions.${s("path") ?? "?"}` };
    case "create_world_book_entry":
      return { kind: "create", verb: "Creating", target: `world book entry${s("comment") ? ` '${s("comment")}'` : ""}` };
    case "delete_world_book_entry":
      return { kind: "delete", verb: "Deleting", target: `world book entry ${s("entry_id") ?? "?"}` };
    case "create_regex_script":
      return { kind: "create", verb: "Creating", target: `regex script${s("name") ? ` '${s("name")}'` : ""}` };
    case "delete_regex_script":
      return { kind: "delete", verb: "Deleting", target: `regex script ${s("script_id") ?? "?"}` };
    case "create_alternate_greeting": {
      const i = n("index");
      return { kind: "create", verb: "Adding", target: i !== undefined ? `alternate_greetings[${i}]` : "alternate greeting" };
    }
    case "delete_alternate_greeting": {
      const i = n("index");
      return { kind: "delete", verb: "Deleting", target: `alternate_greetings[${i ?? "?"}]` };
    }
    case "apply_glossary": {
      const e = args["entries"] ?? {};
      const dry = args["dry_run"] === true;
      return { kind: dry ? "search" : "write", verb: dry ? "Dry-running" : "Applying", target: `glossary (${Object.keys(e).length} entries)` };
    }
    case "test_regex":
      return { kind: "test", verb: "Testing", target: "regex pattern" };
    case "count_cjk_chars":
      return { kind: "read", verb: "Counting", target: "CJK chars" };
    case "todo_write": {
      const todos = Array.isArray(args["todos"]) ? args["todos"] : [];
      const active = todos.find((t) => t && t.status === "in_progress");
      if (active)
        return { kind: "write", verb: "Working on", target: active.activeForm };
      return { kind: "write", verb: "Updating", target: `todos (${todos.length})` };
    }
    case "finish":
      return { kind: "finish", verb: "Marking", target: "task complete" };
    default:
      return { kind: "read", verb: "Calling", target: name };
  }
}
function todoMark(status) {
  switch (status) {
    case "completed":
      return "✓";
    case "in_progress":
      return "→";
    case "pending":
      return "·";
  }
}
function renderTodosPanel(todos) {
  const panel = el2("div", "la-todos-panel");
  if (todos.length === 0) {
    panel.appendChild(el2("div", "la-todos-empty", "(no items)"));
    return panel;
  }
  const list = el2("ul", "la-todos-list");
  for (const t of todos) {
    if (!t || typeof t !== "object")
      continue;
    const status = t.status === "in_progress" || t.status === "completed" ? t.status : "pending";
    const li = el2("li", `la-todo-item la-todo-${status}`);
    li.append(el2("span", "la-todo-mark", todoMark(status)), el2("span", "la-todo-label", status === "in_progress" ? t.activeForm ?? t.content ?? "" : t.content ?? ""));
    list.appendChild(li);
  }
  panel.appendChild(list);
  return panel;
}
function buildToolCard(callId, name, args, deps) {
  const card = el2("div", "la-tool-card la-msg-block is-running");
  card.dataset["callId"] = callId;
  const desc = describeToolActivity(name, args);
  card.dataset["kind"] = desc.kind;
  const head = el2("div", "la-tool-head");
  const caret = el2("span", "la-tool-caret", "▸");
  const spinner = el2("span", "la-tool-spinner");
  spinner.setAttribute("aria-hidden", "true");
  const activity = el2("span", "la-tool-activity");
  const verbSpan = el2("span", "la-tool-verb", desc.verb);
  const targetSpan = el2("span", "la-tool-target", " " + desc.target);
  activity.append(verbSpan, targetSpan);
  const sensBadge = el2("span", "la-tool-sens");
  sensBadge.style.display = "none";
  const status = el2("span", "la-tool-status", "running");
  const freeBtn = el2("button", "la-tool-free-btn", "free");
  freeBtn.type = "button";
  freeBtn.title = "Replace this result with a stub to save context. The model loses access to its content.";
  freeBtn.style.display = "none";
  let confirmTimer = null;
  const resetConfirm = () => {
    if (confirmTimer !== null) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
    freeBtn.classList.remove("is-confirming");
    freeBtn.textContent = "free";
  };
  freeBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (!deps?.onFreeToolResult)
      return;
    const inCache = deps.isToolResultInCache?.(callId) ?? false;
    if (inCache) {
      deps.onFreeToolResult(callId);
      return;
    }
    if (freeBtn.classList.contains("is-confirming")) {
      resetConfirm();
      deps.onFreeToolResult(callId);
      return;
    }
    freeBtn.classList.add("is-confirming");
    freeBtn.textContent = "Confirm?";
    confirmTimer = setTimeout(resetConfirm, 4000);
  });
  head.append(caret, spinner, activity, sensBadge, freeBtn, status);
  const body = el2("div", "la-tool-body");
  const argsSection = el2("div", "la-tool-body-section");
  argsSection.append(el2("div", "la-tool-body-section-label", `${name} args`), Object.assign(el2("pre"), { textContent: JSON.stringify(args, null, 2) }));
  body.appendChild(argsSection);
  const resultSection = el2("div", "la-tool-body-section la-tool-body-result");
  resultSection.append(el2("div", "la-tool-body-section-label", "result"), el2("pre", undefined, ""));
  body.appendChild(resultSection);
  card.append(head);
  if (name === "todo_write" && Array.isArray(args["todos"])) {
    card.appendChild(renderTodosPanel(args["todos"]));
  }
  card.appendChild(body);
  head.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t.closest(".la-tool-free-btn"))
      return;
    card.classList.toggle("is-open");
    caret.textContent = card.classList.contains("is-open") ? "▾" : "▸";
  });
  return card;
}
function applyToolCardSensitivity(card, sensitivity, freed) {
  const badge = card.querySelector(".la-tool-sens");
  const freeBtn = card.querySelector(".la-tool-free-btn");
  if (!badge || !freeBtn)
    return;
  if (freed) {
    badge.textContent = "freed";
    badge.className = "la-tool-sens la-tool-sens-freed";
    badge.style.display = "";
    freeBtn.style.display = "none";
    return;
  }
  if (sensitivity === "sensitive") {
    badge.textContent = "sensitive";
    badge.className = "la-tool-sens la-tool-sens-sensitive";
    badge.style.display = "";
  } else if (sensitivity === "insensitive") {
    badge.textContent = "insensitive";
    badge.className = "la-tool-sens la-tool-sens-insensitive";
    badge.style.display = "";
  } else {
    badge.style.display = "none";
  }
  freeBtn.style.display = "";
}
function describeEditSurface(entry) {
  const r = entry.record;
  if (r.op === "create")
    return { primary: `+ ${r.surfaceLabel}`, secondary: r.surface, statSummary: "created" };
  if (r.op === "delete")
    return { primary: `× ${r.surfaceLabel}`, secondary: r.surface, statSummary: "deleted" };
  const stats = computeDiffStats(r.before, r.after);
  return { primary: r.surfaceLabel, secondary: r.field, statSummary: `+${stats.added} -${stats.removed}` };
}
function buildEditRow(entry, deps) {
  const row = el2("div", `la-edit-row ${entry.reverted ? "is-reverted" : ""}`);
  row.dataset["editId"] = entry.id;
  const head = el2("div", "la-edit-row-head");
  const desc = describeEditSurface(entry);
  head.appendChild(el2("span", "la-edit-row-surface", desc.secondary));
  head.appendChild(el2("span", "la-edit-row-label", desc.primary));
  if (entry.record.op === "edit") {
    head.appendChild(el2("span", "la-edit-row-field", `· ${entry.record.field}`));
  }
  head.appendChild(el2("span", "la-edit-row-stat", `· ${desc.statSummary}`));
  if (entry.reverted)
    head.appendChild(el2("span", "la-edit-row-stat", "· reverted"));
  const actions = el2("div", "la-edit-row-actions");
  const fullBtn = el2("button", "la-btn la-btn-mini la-btn-ghost", "Open full diff");
  fullBtn.addEventListener("click", () => deps.onOpenDiffModal(entry.id));
  actions.appendChild(fullBtn);
  if (!entry.reverted) {
    const revertBtn = el2("button", "la-btn la-btn-mini la-btn-danger", "Revert");
    revertBtn.addEventListener("click", async () => {
      revertBtn.disabled = true;
      revertBtn.textContent = "Reverting…";
      try {
        await deps.onRevertEdit(entry.id);
      } catch (err) {
        revertBtn.disabled = false;
        revertBtn.textContent = "Revert";
      }
    });
    actions.appendChild(revertBtn);
  }
  head.appendChild(actions);
  row.appendChild(head);
  const diffWrap = el2("div", "la-edit-row-diff");
  const r = entry.record;
  if (r.op === "edit") {
    if (isShortField(r.before, r.after)) {
      diffWrap.appendChild(renderInlineFieldDiff(r.before, r.after));
    } else {
      diffWrap.appendChild(renderUnifiedDiff(r.before, r.after, 2));
    }
  } else if (r.op === "create") {
    diffWrap.textContent = "Created. Open full diff to inspect.";
  } else {
    diffWrap.textContent = "Deleted. Open full diff to inspect or revert.";
  }
  row.appendChild(diffWrap);
  return row;
}
function buildEditsCard(parentMsg, deps) {
  const card = el2("div", "la-edits-card la-msg-block");
  const head = el2("div", "la-edits-head");
  const caret = el2("span", "la-edits-caret", "▸");
  const title = el2("span", "la-edits-title", "Edits (0)");
  const right = el2("span", "la-edits-head-right");
  const revertAllBtn = el2("button", "la-btn la-btn-mini la-btn-danger", "Revert all");
  revertAllBtn.style.display = "none";
  revertAllBtn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const liveIds = entries.filter((e) => !e.reverted).map((e) => e.id);
    if (liveIds.length === 0)
      return;
    revertAllBtn.disabled = true;
    revertAllBtn.textContent = "Reverting…";
    try {
      if (deps.onRevertManyEdits)
        await deps.onRevertManyEdits(liveIds);
      else
        for (const id of [...liveIds].reverse())
          await deps.onRevertEdit(id);
    } catch {}
    revertAllBtn.disabled = false;
    revertAllBtn.textContent = "Revert all";
  });
  const allBtn = el2("button", "la-btn la-btn-mini", "See Workshop");
  allBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    deps.onOpenDiffModal(undefined);
  });
  right.append(revertAllBtn, allBtn);
  head.append(caret, title, right);
  const list = el2("div", "la-edits-list");
  card.append(head, list);
  head.addEventListener("click", () => {
    card.classList.toggle("is-open");
    caret.textContent = card.classList.contains("is-open") ? "▾" : "▸";
  });
  const entries = [];
  const setTitle = () => {
    const liveCount = entries.filter((e) => !e.reverted).length;
    title.textContent = `Edits (${entries.length})`;
    revertAllBtn.style.display = liveCount > 0 ? "" : "none";
  };
  const append = (entry) => {
    entries.push(entry);
    list.appendChild(buildEditRow(entry, deps));
    setTitle();
  };
  const rebuild = (next) => {
    entries.length = 0;
    list.innerHTML = "";
    for (const e of next) {
      entries.push(e);
      list.appendChild(buildEditRow(e, deps));
    }
    setTitle();
  };
  return { card, add: append, rebuild, count: () => entries.length };
}
function renderUserMessage(msg, deps) {
  const wrap = el2("div", "la-msg la-msg-user");
  const bubble = el2("div", "la-msg-bubble");
  bubble.textContent = msg.content;
  wrap.appendChild(bubble);
  if (deps?.onEditUserMessage || deps?.onDeleteMessage) {
    const actions = el2("div", "la-msg-actions");
    if (deps?.onEditUserMessage) {
      const editBtn = el2("button", "la-msg-action-btn la-msg-action-btn-icon");
      editBtn.innerHTML = ICON_EDIT;
      editBtn.setAttribute("aria-label", "Edit message");
      editBtn.title = "Edit message";
      editBtn.addEventListener("click", async () => {
        const editor = enterEditMode(bubble, msg.content);
        const result = await editor;
        if (result === null)
          return;
        const liveEdits = deps.liveEditsAfterUserMessage?.(msg.id) ?? 0;
        let action = "keep";
        if (liveEdits > 0 && deps.promptEditsAction) {
          const choice = await deps.promptEditsAction({ liveEditCount: liveEdits, action: "edit" });
          if (choice === "cancel")
            return;
          action = choice;
        }
        await deps.onEditUserMessage(msg.id, result, action);
      });
      actions.appendChild(editBtn);
    }
    if (deps?.onDeleteMessage) {
      const delBtn = el2("button", "la-msg-action-btn la-msg-action-btn-icon la-msg-action-btn-danger");
      delBtn.innerHTML = ICON_TRASH;
      delBtn.setAttribute("aria-label", "Delete message");
      delBtn.title = "Delete this message";
      delBtn.addEventListener("click", async () => {
        await deps.onDeleteMessage(msg.id, "keep");
      });
      actions.appendChild(delBtn);
    }
    wrap.appendChild(actions);
  }
  return wrap;
}
function enterEditMode(bubble, current) {
  return new Promise((resolve) => {
    const original = bubble.textContent ?? "";
    const renderedHeight = bubble.getBoundingClientRect().height;
    bubble.innerHTML = "";
    bubble.classList.add("is-editing");
    const ta = document.createElement("textarea");
    ta.className = "la-msg-edit-textarea";
    ta.value = current;
    ta.rows = Math.max(2, Math.min(10, current.split(`
`).length));
    if (renderedHeight > 0)
      ta.style.minHeight = `${Math.ceil(renderedHeight)}px`;
    const autoGrow = () => {
      ta.style.height = "auto";
      const next = Math.max(renderedHeight, ta.scrollHeight);
      ta.style.height = `${Math.ceil(next)}px`;
    };
    const actions = el2("div", "la-msg-edit-actions");
    const cancelBtn = el2("button", "la-btn la-btn-mini la-btn-ghost", "Cancel");
    const saveBtn = el2("button", "la-btn la-btn-mini la-btn-primary", "Save and resubmit");
    actions.append(cancelBtn, saveBtn);
    bubble.append(ta, actions);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    autoGrow();
    ta.addEventListener("input", autoGrow);
    const finish = (val) => {
      bubble.classList.remove("is-editing");
      if (val === null)
        bubble.textContent = original;
      resolve(val);
    };
    cancelBtn.addEventListener("click", () => finish(null));
    saveBtn.addEventListener("click", () => {
      const v = ta.value.trim();
      if (v.length === 0) {
        finish(null);
        return;
      }
      finish(v);
    });
    ta.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish(null);
      } else if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
        ev.preventDefault();
        saveBtn.click();
      }
    });
  });
}
function buildEditIndex(edits) {
  const m = new Map;
  for (const e of edits)
    m.set(e.id, e);
  return m;
}
function renderStaticAssistant(msg, deps, allEdits) {
  const lookup = (id) => allEdits instanceof Map ? allEdits.get(id) : allEdits.find((e) => e.id === id);
  const wrap = el2("div", "la-msg la-msg-assistant");
  const bubble = el2("div", "la-msg-bubble");
  const collected = [];
  for (const block of msg.blocks) {
    if (block.type === "text") {
      if (block.content.length === 0)
        continue;
      const textBlock = el2("div", "la-msg-block la-text-block");
      textBlock.appendChild(renderMarkdown(block.content));
      bubble.appendChild(textBlock);
    } else if (block.type === "reasoning") {
      if (block.content.length === 0)
        continue;
      const r = el2("div", "la-reasoning la-msg-block");
      const t = el2("div", "la-reasoning-toggle", "▸ Thinking");
      const b = el2("div", "la-reasoning-body");
      b.textContent = block.content;
      r.append(t, b);
      t.addEventListener("click", () => r.classList.toggle("is-open"));
      bubble.appendChild(r);
    } else if (block.type === "tool") {
      const card = buildToolCard(block.call_id, block.name, block.args, deps);
      card.classList.remove("is-running");
      card.classList.add(block.is_error ? "is-error" : "is-done");
      const status = card.querySelector(".la-tool-status");
      if (status) {
        status.textContent = block.is_error ? "error" : "done";
        if (block.is_error)
          status.classList.add("is-error");
      }
      const resultPre = card.querySelector(".la-tool-body-result pre");
      if (resultPre)
        resultPre.textContent = block.result ?? "";
      applyToolCardSensitivity(card, block.sensitivity, block.freed);
      bubble.appendChild(card);
      for (const eid of block.edit_ids) {
        const entry = lookup(eid);
        if (entry)
          collected.push(entry);
      }
    }
  }
  if (collected.length > 0) {
    const editsCard = buildEditsCard(wrap, deps);
    editsCard.rebuild(collected);
    bubble.appendChild(editsCard.card);
  }
  if (msg.status === "complete" && msg.usage) {
    const meta = el2("div", "la-msg-meta", `${msg.usage.total} tokens · turn ${msg.turn}`);
    wrap.appendChild(meta);
  } else if (msg.status === "cancelled") {
    wrap.appendChild(el2("div", "la-msg-meta", "cancelled"));
  } else if (msg.status === "errored") {
    wrap.appendChild(el2("div", "la-msg-meta", "errored"));
  }
  wrap.appendChild(bubble);
  const canShowActions = msg.status === "complete" || msg.status === "cancelled" || msg.status === "errored";
  if (canShowActions && (deps.onRegenerateAssistant || deps.onDeleteMessage)) {
    const actions = el2("div", "la-msg-actions la-msg-actions-right");
    if (deps.onRegenerateAssistant) {
      const regenBtn = el2("button", "la-msg-action-btn la-msg-action-btn-icon");
      regenBtn.innerHTML = ICON_RETRY;
      regenBtn.setAttribute("aria-label", "Regenerate response");
      regenBtn.title = "Regenerate";
      regenBtn.addEventListener("click", async () => {
        const liveEdits = deps.liveEditsForAssistantMessage?.(msg.id) ?? 0;
        let action = "keep";
        if (liveEdits > 0 && deps.promptEditsAction) {
          const choice = await deps.promptEditsAction({ liveEditCount: liveEdits, action: "regenerate" });
          if (choice === "cancel")
            return;
          action = choice;
        }
        await deps.onRegenerateAssistant(msg.id, action);
      });
      actions.appendChild(regenBtn);
    }
    if (deps.onDeleteMessage) {
      const delBtn = el2("button", "la-msg-action-btn la-msg-action-btn-icon la-msg-action-btn-danger");
      delBtn.innerHTML = ICON_TRASH;
      delBtn.setAttribute("aria-label", "Delete message");
      delBtn.title = "Delete this message";
      delBtn.addEventListener("click", async () => {
        const liveEdits = deps.liveEditsForAssistantMessage?.(msg.id) ?? 0;
        let action = "keep";
        if (liveEdits > 0 && deps.promptEditsAction) {
          const choice = await deps.promptEditsAction({ liveEditCount: liveEdits, action: "delete" });
          if (choice === "cancel")
            return;
          action = choice;
        }
        await deps.onDeleteMessage(msg.id, action);
      });
      actions.appendChild(delBtn);
    }
    wrap.appendChild(actions);
  }
  return wrap;
}
function createStreamingAssistant(deps) {
  const wrap = el2("div", "la-msg la-msg-assistant");
  const bubble = el2("div", "la-msg-bubble");
  wrap.appendChild(bubble);
  let loadingHandle = null;
  const loadingHost = el2("div", "la-streaming-loading");
  const moveLoadingToTail = () => {
    if (!loadingHandle)
      return;
    bubble.appendChild(loadingHost);
  };
  const setLoading = (active) => {
    const isActive = loadingHandle !== null;
    if (active === isActive)
      return;
    if (active) {
      loadingHandle = mountLoading(loadingHost);
      moveLoadingToTail();
    } else if (loadingHandle) {
      loadingHandle.destroy();
      loadingHandle = null;
      if (loadingHost.parentElement)
        loadingHost.remove();
    }
  };
  let textBlock = null;
  let reasoningBlock = null;
  let reasoningBody = null;
  const toolCardsByCallId = new Map;
  let editsCardHandle = null;
  let metaLine = null;
  const editIndex = new Map;
  const textRaw = new Map;
  const dirtyBlocks = new Set;
  let pendingRenderTimer = null;
  const flushDirtyBlocks = () => {
    for (const tb of dirtyBlocks) {
      const raw = textRaw.get(tb) ?? "";
      tb.innerHTML = "";
      tb.appendChild(renderMarkdown(raw));
    }
    dirtyBlocks.clear();
  };
  const scheduleStreamingRender = () => {
    if (pendingRenderTimer !== null)
      return;
    pendingRenderTimer = setTimeout(() => {
      pendingRenderTimer = null;
      flushDirtyBlocks();
    }, 80);
  };
  const pendingForTools = new Map;
  const ensureEditsCard = () => {
    if (!editsCardHandle)
      editsCardHandle = buildEditsCard(wrap, deps);
    bubble.appendChild(editsCardHandle.card);
    return editsCardHandle;
  };
  return {
    root: wrap,
    appendToken(token) {
      if (token.length === 0)
        return;
      if (!textBlock) {
        textBlock = el2("div", "la-msg-block la-text-block");
        bubble.appendChild(textBlock);
        textRaw.set(textBlock, "");
      }
      textRaw.set(textBlock, (textRaw.get(textBlock) ?? "") + token);
      dirtyBlocks.add(textBlock);
      scheduleStreamingRender();
      moveLoadingToTail();
    },
    appendReasoning(token) {
      if (token.length === 0)
        return;
      if (!reasoningBlock) {
        reasoningBlock = el2("div", "la-reasoning la-msg-block");
        const t = el2("div", "la-reasoning-toggle", "▸ Thinking");
        reasoningBody = el2("div", "la-reasoning-body");
        reasoningBlock.append(t, reasoningBody);
        t.addEventListener("click", () => reasoningBlock.classList.toggle("is-open"));
        bubble.appendChild(reasoningBlock);
      }
      reasoningBody.textContent = (reasoningBody.textContent ?? "") + token;
      moveLoadingToTail();
    },
    startTool(callId, name, args) {
      textBlock = null;
      const card = buildToolCard(callId, name, args, deps);
      bubble.appendChild(card);
      toolCardsByCallId.set(callId, card);
      moveLoadingToTail();
    },
    finishTool(callId, result, isError, editIds, sensitivity) {
      const card = toolCardsByCallId.get(callId);
      if (!card)
        return;
      card.classList.remove("is-running");
      card.classList.add(isError ? "is-error" : "is-done");
      const status = card.querySelector(".la-tool-status");
      if (status) {
        status.textContent = isError ? "error" : "done";
        if (isError)
          status.classList.add("is-error");
        else
          status.classList.remove("is-error");
      }
      const resultPre = card.querySelector(".la-tool-body-result pre");
      if (resultPre)
        resultPre.textContent = result;
      if (sensitivity)
        applyToolCardSensitivity(card, sensitivity, false);
      pendingForTools.set(callId, [...editIds]);
      if (editIds.length === 0)
        return;
      const card2 = ensureEditsCard();
      for (const id of editIds) {
        const entry = editIndex.get(id);
        if (entry)
          card2.add(entry);
      }
    },
    setToolSensitivity(callId, sensitivity, freed) {
      const card = toolCardsByCallId.get(callId);
      if (!card)
        return;
      applyToolCardSensitivity(card, sensitivity, freed);
    },
    attachEdits(edits) {
      for (const e of edits)
        editIndex.set(e.id, e);
      if (edits.length === 0)
        return;
      const card = ensureEditsCard();
      const all = [];
      for (const [, ids] of pendingForTools) {
        for (const id of ids) {
          const entry = editIndex.get(id);
          if (entry)
            all.push(entry);
        }
      }
      if (all.length > 0)
        card.rebuild(all);
    },
    addWarning(_message) {},
    setLoading(active) {
      setLoading(active);
    },
    setStatus(status) {
      if (status !== "streaming")
        setLoading(false);
      if (status === "cancelled") {
        if (!metaLine) {
          metaLine = el2("div", "la-msg-meta", "cancelled");
          wrap.appendChild(metaLine);
        } else
          metaLine.textContent = "cancelled";
      } else if (status === "errored") {
        if (!metaLine) {
          metaLine = el2("div", "la-msg-meta", "errored");
          wrap.appendChild(metaLine);
        } else
          metaLine.textContent = "errored";
      } else if (status === "complete") {
        if (pendingRenderTimer !== null) {
          clearTimeout(pendingRenderTimer);
          pendingRenderTimer = null;
        }
        for (const tb of Array.from(bubble.querySelectorAll(".la-text-block"))) {
          const raw = textRaw.get(tb);
          if (raw === undefined)
            continue;
          tb.innerHTML = "";
          tb.appendChild(renderMarkdown(raw));
        }
        dirtyBlocks.clear();
      }
    },
    setUsage(usage) {
      if (!usage)
        return;
      if (!metaLine) {
        metaLine = el2("div", "la-msg-meta");
        wrap.appendChild(metaLine);
      }
      metaLine.textContent = `${usage.total} tokens`;
    }
  };
}
function renderMessage(msg, deps, allEdits) {
  if (msg.role === "user")
    return renderUserMessage(msg, deps);
  return renderStaticAssistant(msg, deps, allEdits);
}

// node_modules/@tanstack/virtual-core/dist/esm/utils.js
function memo(getDeps, fn, opts) {
  let deps = opts.initialDeps ?? [];
  let result;
  let isInitial = true;
  function memoizedFunction() {
    var _a, _b, _c;
    let depTime;
    if (opts.key && ((_a = opts.debug) == null ? undefined : _a.call(opts)))
      depTime = Date.now();
    const newDeps = getDeps();
    const depsChanged = newDeps.length !== deps.length || newDeps.some((dep, index) => deps[index] !== dep);
    if (!depsChanged) {
      return result;
    }
    deps = newDeps;
    let resultTime;
    if (opts.key && ((_b = opts.debug) == null ? undefined : _b.call(opts)))
      resultTime = Date.now();
    result = fn(...newDeps);
    if (opts.key && ((_c = opts.debug) == null ? undefined : _c.call(opts))) {
      const depEndTime = Math.round((Date.now() - depTime) * 100) / 100;
      const resultEndTime = Math.round((Date.now() - resultTime) * 100) / 100;
      const resultFpsPercentage = resultEndTime / 16;
      const pad = (str, num) => {
        str = String(str);
        while (str.length < num) {
          str = " " + str;
        }
        return str;
      };
      console.info(`%c⏱ ${pad(resultEndTime, 5)} /${pad(depEndTime, 5)} ms`, `
            font-size: .6rem;
            font-weight: bold;
            color: hsl(${Math.max(0, Math.min(120 - 120 * resultFpsPercentage, 120))}deg 100% 31%);`, opts == null ? undefined : opts.key);
    }
    if ((opts == null ? undefined : opts.onChange) && !(isInitial && opts.skipInitialOnChange)) {
      opts.onChange(result);
    }
    isInitial = false;
    return result;
  }
  memoizedFunction.updateDeps = (newDeps) => {
    deps = newDeps;
  };
  return memoizedFunction;
}
function notUndefined(value, msg) {
  if (value === undefined) {
    throw new Error(`Unexpected undefined${msg ? `: ${msg}` : ""}`);
  } else {
    return value;
  }
}
var approxEqual = (a, b) => Math.abs(a - b) < 1.01;
var debounce = (targetWindow, fn, ms) => {
  let timeoutId;
  return function(...args) {
    targetWindow.clearTimeout(timeoutId);
    timeoutId = targetWindow.setTimeout(() => fn.apply(this, args), ms);
  };
};

// node_modules/@tanstack/virtual-core/dist/esm/index.js
var getRect = (element) => {
  const { offsetWidth, offsetHeight } = element;
  return { width: offsetWidth, height: offsetHeight };
};
var defaultKeyExtractor = (index) => index;
var defaultRangeExtractor = (range) => {
  const start = Math.max(range.startIndex - range.overscan, 0);
  const end = Math.min(range.endIndex + range.overscan, range.count - 1);
  const arr = [];
  for (let i = start;i <= end; i++) {
    arr.push(i);
  }
  return arr;
};
var observeElementRect = (instance, cb) => {
  const element = instance.scrollElement;
  if (!element) {
    return;
  }
  const targetWindow = instance.targetWindow;
  if (!targetWindow) {
    return;
  }
  const handler = (rect) => {
    const { width, height } = rect;
    cb({ width: Math.round(width), height: Math.round(height) });
  };
  handler(getRect(element));
  if (!targetWindow.ResizeObserver) {
    return () => {};
  }
  const observer = new targetWindow.ResizeObserver((entries) => {
    const run = () => {
      const entry = entries[0];
      if (entry == null ? undefined : entry.borderBoxSize) {
        const box = entry.borderBoxSize[0];
        if (box) {
          handler({ width: box.inlineSize, height: box.blockSize });
          return;
        }
      }
      handler(getRect(element));
    };
    instance.options.useAnimationFrameWithResizeObserver ? requestAnimationFrame(run) : run();
  });
  observer.observe(element, { box: "border-box" });
  return () => {
    observer.unobserve(element);
  };
};
var addEventListenerOptions = {
  passive: true
};
var supportsScrollend = typeof window == "undefined" ? true : ("onscrollend" in window);
var observeElementOffset = (instance, cb) => {
  const element = instance.scrollElement;
  if (!element) {
    return;
  }
  const targetWindow = instance.targetWindow;
  if (!targetWindow) {
    return;
  }
  let offset = 0;
  const fallback = instance.options.useScrollendEvent && supportsScrollend ? () => {
    return;
  } : debounce(targetWindow, () => {
    cb(offset, false);
  }, instance.options.isScrollingResetDelay);
  const createHandler = (isScrolling) => () => {
    const { horizontal, isRtl } = instance.options;
    offset = horizontal ? element["scrollLeft"] * (isRtl && -1 || 1) : element["scrollTop"];
    fallback();
    cb(offset, isScrolling);
  };
  const handler = createHandler(true);
  const endHandler = createHandler(false);
  element.addEventListener("scroll", handler, addEventListenerOptions);
  const registerScrollendEvent = instance.options.useScrollendEvent && supportsScrollend;
  if (registerScrollendEvent) {
    element.addEventListener("scrollend", endHandler, addEventListenerOptions);
  }
  return () => {
    element.removeEventListener("scroll", handler);
    if (registerScrollendEvent) {
      element.removeEventListener("scrollend", endHandler);
    }
  };
};
var measureElement = (element, entry, instance) => {
  if (entry == null ? undefined : entry.borderBoxSize) {
    const box = entry.borderBoxSize[0];
    if (box) {
      const size = Math.round(box[instance.options.horizontal ? "inlineSize" : "blockSize"]);
      return size;
    }
  }
  return element[instance.options.horizontal ? "offsetWidth" : "offsetHeight"];
};
var elementScroll = (offset, {
  adjustments = 0,
  behavior
}, instance) => {
  var _a, _b;
  const toOffset = offset + adjustments;
  (_b = (_a = instance.scrollElement) == null ? undefined : _a.scrollTo) == null || _b.call(_a, {
    [instance.options.horizontal ? "left" : "top"]: toOffset,
    behavior
  });
};

class Virtualizer {
  constructor(opts) {
    this.unsubs = [];
    this.scrollElement = null;
    this.targetWindow = null;
    this.isScrolling = false;
    this.scrollState = null;
    this.measurementsCache = [];
    this.itemSizeCache = /* @__PURE__ */ new Map;
    this.laneAssignments = /* @__PURE__ */ new Map;
    this.pendingMeasuredCacheIndexes = [];
    this.prevLanes = undefined;
    this.lanesChangedFlag = false;
    this.lanesSettling = false;
    this.scrollRect = null;
    this.scrollOffset = null;
    this.scrollDirection = null;
    this.scrollAdjustments = 0;
    this.elementsCache = /* @__PURE__ */ new Map;
    this.now = () => {
      var _a, _b, _c;
      return ((_c = (_b = (_a = this.targetWindow) == null ? undefined : _a.performance) == null ? undefined : _b.now) == null ? undefined : _c.call(_b)) ?? Date.now();
    };
    this.observer = /* @__PURE__ */ (() => {
      let _ro = null;
      const get = () => {
        if (_ro) {
          return _ro;
        }
        if (!this.targetWindow || !this.targetWindow.ResizeObserver) {
          return null;
        }
        return _ro = new this.targetWindow.ResizeObserver((entries) => {
          entries.forEach((entry) => {
            const run = () => {
              const node = entry.target;
              const index = this.indexFromElement(node);
              if (!node.isConnected) {
                this.observer.unobserve(node);
                return;
              }
              if (this.shouldMeasureDuringScroll(index)) {
                this.resizeItem(index, this.options.measureElement(node, entry, this));
              }
            };
            this.options.useAnimationFrameWithResizeObserver ? requestAnimationFrame(run) : run();
          });
        });
      };
      return {
        disconnect: () => {
          var _a;
          (_a = get()) == null || _a.disconnect();
          _ro = null;
        },
        observe: (target) => {
          var _a;
          return (_a = get()) == null ? undefined : _a.observe(target, { box: "border-box" });
        },
        unobserve: (target) => {
          var _a;
          return (_a = get()) == null ? undefined : _a.unobserve(target);
        }
      };
    })();
    this.range = null;
    this.setOptions = (opts2) => {
      Object.entries(opts2).forEach(([key, value]) => {
        if (typeof value === "undefined")
          delete opts2[key];
      });
      this.options = {
        debug: false,
        initialOffset: 0,
        overscan: 1,
        paddingStart: 0,
        paddingEnd: 0,
        scrollPaddingStart: 0,
        scrollPaddingEnd: 0,
        horizontal: false,
        getItemKey: defaultKeyExtractor,
        rangeExtractor: defaultRangeExtractor,
        onChange: () => {},
        measureElement,
        initialRect: { width: 0, height: 0 },
        scrollMargin: 0,
        gap: 0,
        indexAttribute: "data-index",
        initialMeasurementsCache: [],
        lanes: 1,
        isScrollingResetDelay: 150,
        enabled: true,
        isRtl: false,
        useScrollendEvent: false,
        useAnimationFrameWithResizeObserver: false,
        laneAssignmentMode: "estimate",
        ...opts2
      };
    };
    this.notify = (sync) => {
      var _a, _b;
      (_b = (_a = this.options).onChange) == null || _b.call(_a, this, sync);
    };
    this.maybeNotify = memo(() => {
      this.calculateRange();
      return [
        this.isScrolling,
        this.range ? this.range.startIndex : null,
        this.range ? this.range.endIndex : null
      ];
    }, (isScrolling) => {
      this.notify(isScrolling);
    }, {
      key: "maybeNotify",
      debug: () => this.options.debug,
      initialDeps: [
        this.isScrolling,
        this.range ? this.range.startIndex : null,
        this.range ? this.range.endIndex : null
      ]
    });
    this.cleanup = () => {
      this.unsubs.filter(Boolean).forEach((d) => d());
      this.unsubs = [];
      this.observer.disconnect();
      if (this.rafId != null && this.targetWindow) {
        this.targetWindow.cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      this.scrollState = null;
      this.scrollElement = null;
      this.targetWindow = null;
    };
    this._didMount = () => {
      return () => {
        this.cleanup();
      };
    };
    this._willUpdate = () => {
      var _a;
      const scrollElement = this.options.enabled ? this.options.getScrollElement() : null;
      if (this.scrollElement !== scrollElement) {
        this.cleanup();
        if (!scrollElement) {
          this.maybeNotify();
          return;
        }
        this.scrollElement = scrollElement;
        if (this.scrollElement && "ownerDocument" in this.scrollElement) {
          this.targetWindow = this.scrollElement.ownerDocument.defaultView;
        } else {
          this.targetWindow = ((_a = this.scrollElement) == null ? undefined : _a.window) ?? null;
        }
        this.elementsCache.forEach((cached) => {
          this.observer.observe(cached);
        });
        this.unsubs.push(this.options.observeElementRect(this, (rect) => {
          this.scrollRect = rect;
          this.maybeNotify();
        }));
        this.unsubs.push(this.options.observeElementOffset(this, (offset, isScrolling) => {
          this.scrollAdjustments = 0;
          this.scrollDirection = isScrolling ? this.getScrollOffset() < offset ? "forward" : "backward" : null;
          this.scrollOffset = offset;
          this.isScrolling = isScrolling;
          if (this.scrollState) {
            this.scheduleScrollReconcile();
          }
          this.maybeNotify();
        }));
        this._scrollToOffset(this.getScrollOffset(), {
          adjustments: undefined,
          behavior: undefined
        });
      }
    };
    this.rafId = null;
    this.getSize = () => {
      if (!this.options.enabled) {
        this.scrollRect = null;
        return 0;
      }
      this.scrollRect = this.scrollRect ?? this.options.initialRect;
      return this.scrollRect[this.options.horizontal ? "width" : "height"];
    };
    this.getScrollOffset = () => {
      if (!this.options.enabled) {
        this.scrollOffset = null;
        return 0;
      }
      this.scrollOffset = this.scrollOffset ?? (typeof this.options.initialOffset === "function" ? this.options.initialOffset() : this.options.initialOffset);
      return this.scrollOffset;
    };
    this.getFurthestMeasurement = (measurements, index) => {
      const furthestMeasurementsFound = /* @__PURE__ */ new Map;
      const furthestMeasurements = /* @__PURE__ */ new Map;
      for (let m = index - 1;m >= 0; m--) {
        const measurement = measurements[m];
        if (furthestMeasurementsFound.has(measurement.lane)) {
          continue;
        }
        const previousFurthestMeasurement = furthestMeasurements.get(measurement.lane);
        if (previousFurthestMeasurement == null || measurement.end > previousFurthestMeasurement.end) {
          furthestMeasurements.set(measurement.lane, measurement);
        } else if (measurement.end < previousFurthestMeasurement.end) {
          furthestMeasurementsFound.set(measurement.lane, true);
        }
        if (furthestMeasurementsFound.size === this.options.lanes) {
          break;
        }
      }
      return furthestMeasurements.size === this.options.lanes ? Array.from(furthestMeasurements.values()).sort((a, b) => {
        if (a.end === b.end) {
          return a.index - b.index;
        }
        return a.end - b.end;
      })[0] : undefined;
    };
    this.getMeasurementOptions = memo(() => [
      this.options.count,
      this.options.paddingStart,
      this.options.scrollMargin,
      this.options.getItemKey,
      this.options.enabled,
      this.options.lanes,
      this.options.laneAssignmentMode
    ], (count, paddingStart, scrollMargin, getItemKey, enabled, lanes, laneAssignmentMode) => {
      const lanesChanged = this.prevLanes !== undefined && this.prevLanes !== lanes;
      if (lanesChanged) {
        this.lanesChangedFlag = true;
      }
      this.prevLanes = lanes;
      this.pendingMeasuredCacheIndexes = [];
      return {
        count,
        paddingStart,
        scrollMargin,
        getItemKey,
        enabled,
        lanes,
        laneAssignmentMode
      };
    }, {
      key: false
    });
    this.getMeasurements = memo(() => [this.getMeasurementOptions(), this.itemSizeCache], ({
      count,
      paddingStart,
      scrollMargin,
      getItemKey,
      enabled,
      lanes,
      laneAssignmentMode
    }, itemSizeCache) => {
      if (!enabled) {
        this.measurementsCache = [];
        this.itemSizeCache.clear();
        this.laneAssignments.clear();
        return [];
      }
      if (this.laneAssignments.size > count) {
        for (const index of this.laneAssignments.keys()) {
          if (index >= count) {
            this.laneAssignments.delete(index);
          }
        }
      }
      if (this.lanesChangedFlag) {
        this.lanesChangedFlag = false;
        this.lanesSettling = true;
        this.measurementsCache = [];
        this.itemSizeCache.clear();
        this.laneAssignments.clear();
        this.pendingMeasuredCacheIndexes = [];
      }
      if (this.measurementsCache.length === 0 && !this.lanesSettling) {
        this.measurementsCache = this.options.initialMeasurementsCache;
        this.measurementsCache.forEach((item) => {
          this.itemSizeCache.set(item.key, item.size);
        });
      }
      const min = this.lanesSettling ? 0 : this.pendingMeasuredCacheIndexes.length > 0 ? Math.min(...this.pendingMeasuredCacheIndexes) : 0;
      this.pendingMeasuredCacheIndexes = [];
      if (this.lanesSettling && this.measurementsCache.length === count) {
        this.lanesSettling = false;
      }
      const measurements = this.measurementsCache.slice(0, min);
      const laneLastIndex = new Array(lanes).fill(undefined);
      for (let m = 0;m < min; m++) {
        const item = measurements[m];
        if (item) {
          laneLastIndex[item.lane] = m;
        }
      }
      for (let i = min;i < count; i++) {
        const key = getItemKey(i);
        const cachedLane = this.laneAssignments.get(i);
        let lane;
        let start;
        const shouldCacheLane = laneAssignmentMode === "estimate" || itemSizeCache.has(key);
        if (cachedLane !== undefined && this.options.lanes > 1) {
          lane = cachedLane;
          const prevIndex = laneLastIndex[lane];
          const prevInLane = prevIndex !== undefined ? measurements[prevIndex] : undefined;
          start = prevInLane ? prevInLane.end + this.options.gap : paddingStart + scrollMargin;
        } else {
          const furthestMeasurement = this.options.lanes === 1 ? measurements[i - 1] : this.getFurthestMeasurement(measurements, i);
          start = furthestMeasurement ? furthestMeasurement.end + this.options.gap : paddingStart + scrollMargin;
          lane = furthestMeasurement ? furthestMeasurement.lane : i % this.options.lanes;
          if (this.options.lanes > 1 && shouldCacheLane) {
            this.laneAssignments.set(i, lane);
          }
        }
        const measuredSize = itemSizeCache.get(key);
        const size = typeof measuredSize === "number" ? measuredSize : this.options.estimateSize(i);
        const end = start + size;
        measurements[i] = {
          index: i,
          start,
          size,
          end,
          key,
          lane
        };
        laneLastIndex[lane] = i;
      }
      this.measurementsCache = measurements;
      return measurements;
    }, {
      key: "getMeasurements",
      debug: () => this.options.debug
    });
    this.calculateRange = memo(() => [
      this.getMeasurements(),
      this.getSize(),
      this.getScrollOffset(),
      this.options.lanes
    ], (measurements, outerSize, scrollOffset, lanes) => {
      return this.range = measurements.length > 0 && outerSize > 0 ? calculateRange({
        measurements,
        outerSize,
        scrollOffset,
        lanes
      }) : null;
    }, {
      key: "calculateRange",
      debug: () => this.options.debug
    });
    this.getVirtualIndexes = memo(() => {
      let startIndex = null;
      let endIndex = null;
      const range = this.calculateRange();
      if (range) {
        startIndex = range.startIndex;
        endIndex = range.endIndex;
      }
      this.maybeNotify.updateDeps([this.isScrolling, startIndex, endIndex]);
      return [
        this.options.rangeExtractor,
        this.options.overscan,
        this.options.count,
        startIndex,
        endIndex
      ];
    }, (rangeExtractor, overscan, count, startIndex, endIndex) => {
      return startIndex === null || endIndex === null ? [] : rangeExtractor({
        startIndex,
        endIndex,
        overscan,
        count
      });
    }, {
      key: "getVirtualIndexes",
      debug: () => this.options.debug
    });
    this.indexFromElement = (node) => {
      const attributeName = this.options.indexAttribute;
      const indexStr = node.getAttribute(attributeName);
      if (!indexStr) {
        console.warn(`Missing attribute name '${attributeName}={index}' on measured element.`);
        return -1;
      }
      return parseInt(indexStr, 10);
    };
    this.shouldMeasureDuringScroll = (index) => {
      var _a;
      if (!this.scrollState || this.scrollState.behavior !== "smooth") {
        return true;
      }
      const scrollIndex = this.scrollState.index ?? ((_a = this.getVirtualItemForOffset(this.scrollState.lastTargetOffset)) == null ? undefined : _a.index);
      if (scrollIndex !== undefined && this.range) {
        const bufferSize = Math.max(this.options.overscan, Math.ceil((this.range.endIndex - this.range.startIndex) / 2));
        const minIndex = Math.max(0, scrollIndex - bufferSize);
        const maxIndex = Math.min(this.options.count - 1, scrollIndex + bufferSize);
        return index >= minIndex && index <= maxIndex;
      }
      return true;
    };
    this.measureElement = (node) => {
      if (!node) {
        this.elementsCache.forEach((cached, key2) => {
          if (!cached.isConnected) {
            this.observer.unobserve(cached);
            this.elementsCache.delete(key2);
          }
        });
        return;
      }
      const index = this.indexFromElement(node);
      const key = this.options.getItemKey(index);
      const prevNode = this.elementsCache.get(key);
      if (prevNode !== node) {
        if (prevNode) {
          this.observer.unobserve(prevNode);
        }
        this.observer.observe(node);
        this.elementsCache.set(key, node);
      }
      if ((!this.isScrolling || this.scrollState) && this.shouldMeasureDuringScroll(index)) {
        this.resizeItem(index, this.options.measureElement(node, undefined, this));
      }
    };
    this.resizeItem = (index, size) => {
      var _a;
      const item = this.measurementsCache[index];
      if (!item)
        return;
      const itemSize = this.itemSizeCache.get(item.key) ?? item.size;
      const delta = size - itemSize;
      if (delta !== 0) {
        if (((_a = this.scrollState) == null ? undefined : _a.behavior) !== "smooth" && (this.shouldAdjustScrollPositionOnItemSizeChange !== undefined ? this.shouldAdjustScrollPositionOnItemSizeChange(item, delta, this) : item.start < this.getScrollOffset() + this.scrollAdjustments)) {
          if (this.options.debug) {
            console.info("correction", delta);
          }
          this._scrollToOffset(this.getScrollOffset(), {
            adjustments: this.scrollAdjustments += delta,
            behavior: undefined
          });
        }
        this.pendingMeasuredCacheIndexes.push(item.index);
        this.itemSizeCache = new Map(this.itemSizeCache.set(item.key, size));
        this.notify(false);
      }
    };
    this.getVirtualItems = memo(() => [this.getVirtualIndexes(), this.getMeasurements()], (indexes, measurements) => {
      const virtualItems = [];
      for (let k = 0, len = indexes.length;k < len; k++) {
        const i = indexes[k];
        const measurement = measurements[i];
        virtualItems.push(measurement);
      }
      return virtualItems;
    }, {
      key: "getVirtualItems",
      debug: () => this.options.debug
    });
    this.getVirtualItemForOffset = (offset) => {
      const measurements = this.getMeasurements();
      if (measurements.length === 0) {
        return;
      }
      return notUndefined(measurements[findNearestBinarySearch(0, measurements.length - 1, (index) => notUndefined(measurements[index]).start, offset)]);
    };
    this.getMaxScrollOffset = () => {
      if (!this.scrollElement)
        return 0;
      if ("scrollHeight" in this.scrollElement) {
        return this.options.horizontal ? this.scrollElement.scrollWidth - this.scrollElement.clientWidth : this.scrollElement.scrollHeight - this.scrollElement.clientHeight;
      } else {
        const doc = this.scrollElement.document.documentElement;
        return this.options.horizontal ? doc.scrollWidth - this.scrollElement.innerWidth : doc.scrollHeight - this.scrollElement.innerHeight;
      }
    };
    this.getOffsetForAlignment = (toOffset, align, itemSize = 0) => {
      if (!this.scrollElement)
        return 0;
      const size = this.getSize();
      const scrollOffset = this.getScrollOffset();
      if (align === "auto") {
        align = toOffset >= scrollOffset + size ? "end" : "start";
      }
      if (align === "center") {
        toOffset += (itemSize - size) / 2;
      } else if (align === "end") {
        toOffset -= size;
      }
      const maxOffset = this.getMaxScrollOffset();
      return Math.max(Math.min(maxOffset, toOffset), 0);
    };
    this.getOffsetForIndex = (index, align = "auto") => {
      index = Math.max(0, Math.min(index, this.options.count - 1));
      const size = this.getSize();
      const scrollOffset = this.getScrollOffset();
      const item = this.measurementsCache[index];
      if (!item)
        return;
      if (align === "auto") {
        if (item.end >= scrollOffset + size - this.options.scrollPaddingEnd) {
          align = "end";
        } else if (item.start <= scrollOffset + this.options.scrollPaddingStart) {
          align = "start";
        } else {
          return [scrollOffset, align];
        }
      }
      if (align === "end" && index === this.options.count - 1) {
        return [this.getMaxScrollOffset(), align];
      }
      const toOffset = align === "end" ? item.end + this.options.scrollPaddingEnd : item.start - this.options.scrollPaddingStart;
      return [
        this.getOffsetForAlignment(toOffset, align, item.size),
        align
      ];
    };
    this.scrollToOffset = (toOffset, { align = "start", behavior = "auto" } = {}) => {
      const offset = this.getOffsetForAlignment(toOffset, align);
      const now = this.now();
      this.scrollState = {
        index: null,
        align,
        behavior,
        startedAt: now,
        lastTargetOffset: offset,
        stableFrames: 0
      };
      this._scrollToOffset(offset, { adjustments: undefined, behavior });
      this.scheduleScrollReconcile();
    };
    this.scrollToIndex = (index, {
      align: initialAlign = "auto",
      behavior = "auto"
    } = {}) => {
      index = Math.max(0, Math.min(index, this.options.count - 1));
      const offsetInfo = this.getOffsetForIndex(index, initialAlign);
      if (!offsetInfo) {
        return;
      }
      const [offset, align] = offsetInfo;
      const now = this.now();
      this.scrollState = {
        index,
        align,
        behavior,
        startedAt: now,
        lastTargetOffset: offset,
        stableFrames: 0
      };
      this._scrollToOffset(offset, { adjustments: undefined, behavior });
      this.scheduleScrollReconcile();
    };
    this.scrollBy = (delta, { behavior = "auto" } = {}) => {
      const offset = this.getScrollOffset() + delta;
      const now = this.now();
      this.scrollState = {
        index: null,
        align: "start",
        behavior,
        startedAt: now,
        lastTargetOffset: offset,
        stableFrames: 0
      };
      this._scrollToOffset(offset, { adjustments: undefined, behavior });
      this.scheduleScrollReconcile();
    };
    this.getTotalSize = () => {
      var _a;
      const measurements = this.getMeasurements();
      let end;
      if (measurements.length === 0) {
        end = this.options.paddingStart;
      } else if (this.options.lanes === 1) {
        end = ((_a = measurements[measurements.length - 1]) == null ? undefined : _a.end) ?? 0;
      } else {
        const endByLane = Array(this.options.lanes).fill(null);
        let endIndex = measurements.length - 1;
        while (endIndex >= 0 && endByLane.some((val) => val === null)) {
          const item = measurements[endIndex];
          if (endByLane[item.lane] === null) {
            endByLane[item.lane] = item.end;
          }
          endIndex--;
        }
        end = Math.max(...endByLane.filter((val) => val !== null));
      }
      return Math.max(end - this.options.scrollMargin + this.options.paddingEnd, 0);
    };
    this._scrollToOffset = (offset, {
      adjustments,
      behavior
    }) => {
      this.options.scrollToFn(offset, { behavior, adjustments }, this);
    };
    this.measure = () => {
      this.itemSizeCache = /* @__PURE__ */ new Map;
      this.laneAssignments = /* @__PURE__ */ new Map;
      this.notify(false);
    };
    this.setOptions(opts);
  }
  scheduleScrollReconcile() {
    if (!this.targetWindow) {
      this.scrollState = null;
      return;
    }
    if (this.rafId != null)
      return;
    this.rafId = this.targetWindow.requestAnimationFrame(() => {
      this.rafId = null;
      this.reconcileScroll();
    });
  }
  reconcileScroll() {
    if (!this.scrollState)
      return;
    const el3 = this.scrollElement;
    if (!el3)
      return;
    const MAX_RECONCILE_MS = 5000;
    if (this.now() - this.scrollState.startedAt > MAX_RECONCILE_MS) {
      this.scrollState = null;
      return;
    }
    const offsetInfo = this.scrollState.index != null ? this.getOffsetForIndex(this.scrollState.index, this.scrollState.align) : undefined;
    const targetOffset = offsetInfo ? offsetInfo[0] : this.scrollState.lastTargetOffset;
    const STABLE_FRAMES = 1;
    const targetChanged = targetOffset !== this.scrollState.lastTargetOffset;
    if (!targetChanged && approxEqual(targetOffset, this.getScrollOffset())) {
      this.scrollState.stableFrames++;
      if (this.scrollState.stableFrames >= STABLE_FRAMES) {
        this.scrollState = null;
        return;
      }
    } else {
      this.scrollState.stableFrames = 0;
      if (targetChanged) {
        this.scrollState.lastTargetOffset = targetOffset;
        this.scrollState.behavior = "auto";
        this._scrollToOffset(targetOffset, {
          adjustments: undefined,
          behavior: "auto"
        });
      }
    }
    this.scheduleScrollReconcile();
  }
}
var findNearestBinarySearch = (low, high, getCurrentValue, value) => {
  while (low <= high) {
    const middle = (low + high) / 2 | 0;
    const currentValue = getCurrentValue(middle);
    if (currentValue < value) {
      low = middle + 1;
    } else if (currentValue > value) {
      high = middle - 1;
    } else {
      return middle;
    }
  }
  if (low > 0) {
    return low - 1;
  } else {
    return 0;
  }
};
function calculateRange({
  measurements,
  outerSize,
  scrollOffset,
  lanes
}) {
  const lastIndex = measurements.length - 1;
  const getOffset = (index) => measurements[index].start;
  if (measurements.length <= lanes) {
    return {
      startIndex: 0,
      endIndex: lastIndex
    };
  }
  let startIndex = findNearestBinarySearch(0, lastIndex, getOffset, scrollOffset);
  let endIndex = startIndex;
  if (lanes === 1) {
    while (endIndex < lastIndex && measurements[endIndex].end < scrollOffset + outerSize) {
      endIndex++;
    }
  } else if (lanes > 1) {
    const endPerLane = Array(lanes).fill(0);
    while (endIndex < lastIndex && endPerLane.some((pos) => pos < scrollOffset + outerSize)) {
      const item = measurements[endIndex];
      endPerLane[item.lane] = item.end;
      endIndex++;
    }
    const startPerLane = Array(lanes).fill(scrollOffset + outerSize);
    while (startIndex >= 0 && startPerLane.some((pos) => pos >= scrollOffset)) {
      const item = measurements[startIndex];
      startPerLane[item.lane] = item.start;
      startIndex--;
    }
    startIndex = Math.max(0, startIndex - startIndex % lanes);
    endIndex = Math.min(lastIndex, endIndex + (lanes - 1 - endIndex % lanes));
  }
  return { startIndex, endIndex };
}

// src/ui/chat-virtualizer.ts
var STICKY_THRESHOLD_PX = 80;
var DEFAULT_ESTIMATE = 220;
var OVERSCAN = 4;

class ChatVirtualizer {
  deps;
  spacer;
  inner;
  virt;
  nodeByKey = new Map;
  cleanup = null;
  stickyToBottom = true;
  scrollListener = null;
  forceBottomOnNextSync = false;
  hasFirstRenderHappened = false;
  constructor(deps) {
    this.deps = deps;
    deps.scrollContainer.style.overflowAnchor = "none";
    deps.scrollContainer.style.contain = "strict";
    this.spacer = document.createElement("div");
    this.spacer.className = "la-virt-spacer";
    this.spacer.style.position = "relative";
    this.spacer.style.width = "100%";
    deps.scrollContainer.appendChild(this.spacer);
    this.inner = document.createElement("div");
    this.inner.className = "la-virt-inner";
    this.inner.style.position = "absolute";
    this.inner.style.top = "0";
    this.inner.style.left = "0";
    this.inner.style.width = "100%";
    this.spacer.appendChild(this.inner);
    this.virt = new Virtualizer({
      count: deps.getMessages().length,
      getScrollElement: () => deps.scrollContainer,
      estimateSize: (i) => {
        const m = deps.getMessages()[i];
        return m ? deps.estimateSize?.(m) ?? DEFAULT_ESTIMATE : DEFAULT_ESTIMATE;
      },
      getItemKey: (i) => deps.getMessages()[i]?.id ?? i,
      observeElementOffset,
      observeElementRect,
      scrollToFn: elementScroll,
      overscan: OVERSCAN,
      onChange: () => this.sync()
    });
    this.cleanup = this.virt._didMount();
    this.scrollListener = () => this.updateStickiness();
    deps.scrollContainer.addEventListener("scroll", this.scrollListener, { passive: true });
    this.sync();
  }
  setCount() {
    this.virt.setOptions({ ...this.virt.options, count: this.deps.getMessages().length });
    this.sync();
  }
  requestMeasure(messageId) {
    const node = this.nodeByKey.get(messageId);
    if (node)
      this.virt.measureElement(node);
  }
  evict(messageId) {
    const node = this.nodeByKey.get(messageId);
    if (node?.parentElement)
      node.remove();
    this.nodeByKey.delete(messageId);
  }
  clear() {
    for (const node of this.nodeByKey.values()) {
      if (node.parentElement)
        node.remove();
    }
    this.nodeByKey.clear();
  }
  scrollToBottom() {
    const count = this.deps.getMessages().length;
    if (count === 0)
      return;
    this.forceBottomOnNextSync = true;
    this.virt.scrollToIndex(count - 1, { align: "end" });
    this.stickyToBottom = true;
  }
  isNearBottom() {
    return this.stickyToBottom;
  }
  destroy() {
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = null;
    }
    if (this.scrollListener) {
      this.deps.scrollContainer.removeEventListener("scroll", this.scrollListener);
      this.scrollListener = null;
    }
    this.clear();
    if (this.spacer.parentElement)
      this.spacer.parentElement.removeChild(this.spacer);
  }
  updateStickiness() {
    const el3 = this.deps.scrollContainer;
    const distanceFromBottom = el3.scrollHeight - el3.scrollTop - el3.clientHeight;
    this.stickyToBottom = distanceFromBottom <= STICKY_THRESHOLD_PX;
  }
  normaliseItemStyle(node) {
    if (node.style.position)
      node.style.position = "";
    if (node.style.top)
      node.style.top = "";
    if (node.style.left)
      node.style.left = "";
    if (node.style.right)
      node.style.right = "";
    if (node.style.transform)
      node.style.transform = "";
  }
  sync() {
    this.virt._willUpdate();
    const items = this.virt.getVirtualItems();
    const totalSize = this.virt.getTotalSize();
    this.spacer.style.height = `${totalSize}px`;
    this.inner.style.transform = `translateY(${items[0]?.start ?? 0}px)`;
    const activeKeys = new Set;
    for (const it of items)
      activeKeys.add(String(it.key));
    for (const [key, node] of this.nodeByKey) {
      if (!activeKeys.has(key) && node.parentElement === this.inner) {
        this.inner.removeChild(node);
      }
    }
    const messages = this.deps.getMessages();
    for (const item of items) {
      const key = String(item.key);
      const msg = messages[item.index];
      if (!msg)
        continue;
      let node = this.nodeByKey.get(key);
      if (!node) {
        node = this.deps.renderMessage(msg, item.index);
        node.setAttribute("data-virt-key", key);
        this.nodeByKey.set(key, node);
      }
      this.normaliseItemStyle(node);
      node.setAttribute("data-index", String(item.index));
      this.inner.appendChild(node);
      this.virt.measureElement(node);
    }
    const stickBottom = () => {
      const el3 = this.deps.scrollContainer;
      const prevBehavior = el3.style.scrollBehavior;
      el3.style.scrollBehavior = "auto";
      el3.scrollTop = Math.max(0, el3.scrollHeight - el3.clientHeight);
      el3.style.scrollBehavior = prevBehavior;
    };
    const isCurrentlyAtBottom = () => {
      const el3 = this.deps.scrollContainer;
      const distance = el3.scrollHeight - el3.scrollTop - el3.clientHeight;
      return distance >= 0 && distance <= STICKY_THRESHOLD_PX;
    };
    if (!this.hasFirstRenderHappened) {
      this.hasFirstRenderHappened = items.length > 0;
    } else if (this.forceBottomOnNextSync) {
      this.forceBottomOnNextSync = false;
      stickBottom();
    } else if (this.stickyToBottom && isCurrentlyAtBottom()) {
      stickBottom();
    } else if (!isCurrentlyAtBottom()) {
      this.stickyToBottom = false;
    }
  }
}

// src/types.ts
function fileKeyOf(e) {
  const r = e.record;
  if (r.op === "edit")
    return `${r.surface}:${r.surfaceId}:${r.field}`;
  return `${r.surface}:${r.surfaceId}`;
}

// src/ui/diff-modal.ts
var SURFACE_LABELS = {
  character_field: "Character",
  alternate_greeting: "Alternate greetings",
  world_book_entry: "World book",
  regex_script: "Regex scripts",
  extension: "Extensions",
  external: "External (other extensions)"
};
var SURFACE_ORDER = ["character_field", "alternate_greeting", "world_book_entry", "regex_script", "extension", "external"];
var MOBILE_BREAKPOINT_PX = 720;
var DESKTOP_WIDTH_CAP = 1700;
var DESKTOP_WIDTH_MIN = 720;
var DESKTOP_MARGIN_PX = 80;
var DESKTOP_HEIGHT_CAP = 1400;
var DESKTOP_HEIGHT_MIN = 480;
function computeModalWidth() {
  const vw = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 1180;
  return Math.max(DESKTOP_WIDTH_MIN, Math.min(DESKTOP_WIDTH_CAP, vw - DESKTOP_MARGIN_PX));
}
function computeModalMaxHeight() {
  const vh = typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 880;
  return Math.max(DESKTOP_HEIGHT_MIN, Math.min(DESKTOP_HEIGHT_CAP, vh - DESKTOP_MARGIN_PX));
}
function el3(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls)
    e.className = cls;
  if (text !== undefined)
    e.textContent = text;
  return e;
}
function groupBySurface(edits) {
  const out = new Map;
  for (const e of edits) {
    const r = e.record;
    const surface = r.surface;
    if (!out.has(surface))
      out.set(surface, []);
    out.get(surface).push(e);
  }
  return out;
}
function describeRecord(entry) {
  const r = entry.record;
  if (r.op === "create") {
    return {
      primary: `+ ${r.surfaceLabel}`,
      secondary: `created (${r.surface})`,
      statSummary: "created"
    };
  }
  if (r.op === "delete") {
    return {
      primary: `× ${r.surfaceLabel}`,
      secondary: `deleted (${r.surface})`,
      statSummary: "deleted"
    };
  }
  const stats = computeDiffStats(r.before, r.after);
  const stat = `+${stats.added} -${stats.removed}`;
  return {
    primary: r.surfaceLabel,
    secondary: r.field,
    statSummary: stat
  };
}
function openDiffModal(ctx, deps, opts) {
  const modal = ctx.ui.showModal({
    title: "Workshop",
    width: computeModalWidth(),
    maxHeight: computeModalMaxHeight()
  });
  const root = modal.root;
  root.classList.add("la-diff-modal-root");
  let open = true;
  const handleClose = () => {
    if (!open)
      return;
    open = false;
    try {
      modal.dismiss();
    } catch {}
    deps.onClose?.();
  };
  modal.onDismiss(() => {
    if (!open)
      return;
    open = false;
    deps.onClose?.();
  });
  let activeTab = "edits";
  const tabs = el3("div", "la-workshop-tabs");
  const editsTabBtn = el3("button", "la-workshop-tab is-active", "Edits");
  const filesTabBtn = el3("button", "la-workshop-tab", "Files");
  const charsTabBtn = el3("button", "la-workshop-tab", "Characters");
  tabs.append(editsTabBtn, filesTabBtn, charsTabBtn);
  if (!deps.filesPanel)
    filesTabBtn.style.display = "none";
  if (!deps.charactersPanel)
    charsTabBtn.style.display = "none";
  const toolbar = el3("div", "la-diff-modal-toolbar");
  const stats = el3("div", "la-diff-modal-stats");
  const spacer = el3("div", "la-flex-spacer");
  const viewToggle = el3("div", "la-diff-view-toggle");
  const byTimeBtn = el3("button", "la-diff-view-tab is-active", "By time");
  const byFileBtn = el3("button", "la-diff-view-tab", "By file");
  viewToggle.append(byTimeBtn, byFileBtn);
  toolbar.append(stats, spacer, viewToggle);
  let viewMode = "time";
  byTimeBtn.addEventListener("click", () => {
    if (viewMode === "time")
      return;
    viewMode = "time";
    byTimeBtn.classList.add("is-active");
    byFileBtn.classList.remove("is-active");
    refresh();
  });
  byFileBtn.addEventListener("click", () => {
    if (viewMode === "file")
      return;
    viewMode = "file";
    byFileBtn.classList.add("is-active");
    byTimeBtn.classList.remove("is-active");
    refresh();
  });
  const body = el3("div", "la-diff-modal-body");
  const tree = el3("aside", "la-diff-modal-tree");
  const pane = el3("section", "la-diff-modal-pane");
  body.append(tree, pane);
  const editsView = el3("div", "la-workshop-view la-workshop-view-edits is-active");
  editsView.append(toolbar, body);
  const filesView = el3("div", "la-workshop-view la-workshop-view-files");
  if (deps.filesPanel)
    filesView.appendChild(deps.filesPanel);
  const charsView = el3("div", "la-workshop-view la-workshop-view-chars");
  if (deps.charactersPanel)
    charsView.appendChild(deps.charactersPanel);
  const switchTab = (next) => {
    if (activeTab === next)
      return;
    activeTab = next;
    editsTabBtn.classList.toggle("is-active", next === "edits");
    filesTabBtn.classList.toggle("is-active", next === "files");
    charsTabBtn.classList.toggle("is-active", next === "characters");
    editsView.classList.toggle("is-active", next === "edits");
    filesView.classList.toggle("is-active", next === "files");
    charsView.classList.toggle("is-active", next === "characters");
    if (next === "characters")
      deps.onCharactersTabActivated?.();
  };
  editsTabBtn.addEventListener("click", () => switchTab("edits"));
  filesTabBtn.addEventListener("click", () => {
    if (deps.filesPanel)
      switchTab("files");
  });
  charsTabBtn.addEventListener("click", () => {
    if (deps.charactersPanel)
      switchTab("characters");
  });
  root.__focusTab = switchTab;
  root.append(tabs, editsView, filesView, charsView);
  let currentEditId = opts?.initialEditId ?? null;
  let edits = deps.getEdits();
  const refresh = () => {
    const liveCount = edits.filter((e) => !e.reverted).length;
    stats.textContent = `${liveCount} live / ${edits.length} total`;
    renderTree();
    renderPane();
  };
  const renderTree = () => {
    tree.innerHTML = "";
    if (edits.length === 0) {
      tree.appendChild(el3("div", "la-diff-tree-empty", "No edits yet."));
      return;
    }
    if (viewMode === "time")
      renderTreeByTime();
    else
      renderTreeByFile();
  };
  const renderTreeByTime = () => {
    const grouped = groupBySurface(edits);
    for (const surf of SURFACE_ORDER) {
      const group = grouped.get(surf);
      if (!group || group.length === 0)
        continue;
      const section = el3("div", "la-diff-tree-section");
      const sectionHead = el3("div", "la-diff-tree-section-head");
      sectionHead.textContent = `${SURFACE_LABELS[surf]}  (${group.length})`;
      section.appendChild(sectionHead);
      for (const entry of group)
        appendEntryRow(section, entry);
      tree.appendChild(section);
    }
  };
  const renderTreeByFile = () => {
    const byFile = new Map;
    for (const e of edits) {
      const k = fileKeyOf(e);
      if (!byFile.has(k))
        byFile.set(k, []);
      byFile.get(k).push(e);
    }
    const fileList = [...byFile.entries()].map(([k, entries]) => {
      entries.sort((a, b) => a.ts - b.ts);
      return { fileKey: k, entries };
    });
    fileList.sort((a, b) => {
      const aLive = a.entries.filter((e) => !e.reverted).length;
      const bLive = b.entries.filter((e) => !e.reverted).length;
      if (aLive !== bLive)
        return bLive - aLive;
      return b.entries[b.entries.length - 1].ts - a.entries[a.entries.length - 1].ts;
    });
    for (const f of fileList) {
      const section = el3("div", "la-diff-tree-section");
      const sectionHead = el3("div", "la-diff-tree-section-head");
      const first = f.entries[0];
      const r = first.record;
      const surface = SURFACE_LABELS[r.surface] ?? r.surface;
      const surfaceLabel = "surfaceLabel" in r ? r.surfaceLabel : "";
      const field = r.op === "edit" ? r.field : "";
      const live = f.entries.filter((e) => !e.reverted).length;
      sectionHead.textContent = `${surface}: ${surfaceLabel}${field ? " · " + field : ""}  (${live}/${f.entries.length})`;
      section.appendChild(sectionHead);
      for (const entry of f.entries)
        appendEntryRow(section, entry);
      tree.appendChild(section);
    }
  };
  const appendEntryRow = (section, entry) => {
    const row = el3("button", `la-diff-tree-row ${entry.id === currentEditId ? "is-active" : ""} ${entry.reverted ? "is-reverted" : ""}`);
    const desc = describeRecord(entry);
    const primary = el3("div", "la-diff-tree-primary");
    primary.textContent = desc.primary;
    const secondary = el3("div", "la-diff-tree-secondary");
    secondary.textContent = `${desc.secondary} · ${desc.statSummary} · turn ${entry.turn}${entry.reverted ? " · reverted" : ""}`;
    row.append(primary, secondary);
    row.addEventListener("click", () => {
      currentEditId = entry.id;
      refresh();
    });
    section.appendChild(row);
  };
  const renderPane = () => {
    pane.innerHTML = "";
    if (edits.length === 0) {
      pane.appendChild(el3("div", "la-diff-pane-empty", "Nothing changed in this session yet."));
      return;
    }
    const target = currentEditId ? edits.find((e) => e.id === currentEditId) : edits[0];
    if (!target) {
      pane.appendChild(el3("div", "la-diff-pane-empty", "Select an edit on the left."));
      return;
    }
    currentEditId = target.id;
    const r = target.record;
    const toolbar2 = el3("div", "la-diff-pane-toolbar");
    const heading = el3("div", "la-diff-pane-heading");
    const desc = describeRecord(target);
    heading.appendChild(el3("strong", undefined, desc.primary));
    heading.appendChild(el3("span", "la-diff-pane-sub", ` · ${desc.secondary}`));
    const meta = el3("div", "la-diff-pane-meta", `Turn ${target.turn} · ${desc.statSummary} · tool ${target.toolName} · ${new Date(target.ts).toLocaleString()}`);
    const actions = el3("div", "la-diff-pane-actions");
    const revertBtn = el3("button", `la-btn ${target.reverted ? "la-btn-disabled" : "la-btn-danger"}`, target.reverted ? "Reverted" : "Revert this edit");
    revertBtn.disabled = target.reverted;
    revertBtn.addEventListener("click", async () => {
      if (target.reverted)
        return;
      revertBtn.disabled = true;
      revertBtn.textContent = "Reverting…";
      try {
        await deps.onRevert(target.id);
      } finally {}
    });
    actions.appendChild(revertBtn);
    toolbar2.appendChild(heading);
    toolbar2.appendChild(meta);
    toolbar2.appendChild(actions);
    pane.appendChild(toolbar2);
    const isMobile = window.innerWidth < MOBILE_BREAKPOINT_PX;
    if (r.op === "create") {
      const snap = r.snapshot;
      const wrap2 = el3("div", "la-diff-pane-body");
      wrap2.appendChild(el3("div", "la-diff-pane-note", "Created — full content of the new entry is below."));
      const full = "world_book_id" in snap || "find_regex" in snap ? JSON.stringify(snap, null, 2) : snap.greeting;
      wrap2.appendChild(renderSideBySideDiff("", full));
      pane.appendChild(wrap2);
      return;
    }
    if (r.op === "delete") {
      const snap = r.snapshot;
      const wrap2 = el3("div", "la-diff-pane-body");
      wrap2.appendChild(el3("div", "la-diff-pane-note", "Deleted — content shown was removed; revert restores it."));
      const full = "world_book_id" in snap || "find_regex" in snap ? JSON.stringify(snap, null, 2) : snap.greeting;
      wrap2.appendChild(renderSideBySideDiff(full, ""));
      pane.appendChild(wrap2);
      return;
    }
    const wrap = el3("div", "la-diff-pane-body");
    if (isShortField(r.before, r.after) && !isMobile) {
      wrap.appendChild(renderInlineFieldDiff(r.before, r.after));
    } else if (isMobile) {
      wrap.appendChild(renderUnifiedDiff(r.before, r.after, 3));
    } else {
      wrap.appendChild(renderSideBySideDiff(r.before, r.after));
    }
    pane.appendChild(wrap);
  };
  refresh();
  return {
    setEdits(next) {
      if (!open)
        return;
      edits = next;
      refresh();
    },
    focusEdit(editId) {
      if (!open)
        return;
      currentEditId = editId;
      refresh();
    },
    isOpen() {
      return open;
    },
    close() {
      handleClose();
    }
  };
}

// src/ui/workspace-panel.ts
function el4(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls)
    e.className = cls;
  if (text !== undefined)
    e.textContent = text;
  return e;
}
function joinPath(parent, name) {
  return parent === "" ? name : `${parent}/${name}`;
}
function dirname(path) {
  const ix = path.lastIndexOf("/");
  return ix < 0 ? "" : path.slice(0, ix);
}
function basename(path) {
  const ix = path.lastIndexOf("/");
  return ix < 0 ? path : path.slice(ix + 1);
}
function fmtBytes(n) {
  if (n < 1024)
    return `${n} B`;
  if (n < 1024 * 1024)
    return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
function base64ToBlob(b64, mime) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0;i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0;i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function previewKind(path) {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "avif"].includes(ext))
    return "image";
  if (["mp3", "wav", "ogg", "m4a", "flac", "opus"].includes(ext))
    return "audio";
  if (["mp4", "webm", "mov", "mkv"].includes(ext))
    return "video";
  if (["zip", "tar", "gz", "7z", "rar", "exe", "dll", "so", "dylib", "pdf", "wasm", "bin"].includes(ext))
    return "binary";
  return "text";
}
function mimeFromKind(kind, path) {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (kind === "image") {
    if (ext === "jpg" || ext === "jpeg")
      return "image/jpeg";
    if (ext === "svg")
      return "image/svg+xml";
    return `image/${ext}`;
  }
  if (kind === "audio") {
    if (ext === "mp3")
      return "audio/mpeg";
    if (ext === "m4a")
      return "audio/mp4";
    return `audio/${ext}`;
  }
  if (ext === "mov")
    return "video/quicktime";
  if (ext === "mkv")
    return "video/x-matroska";
  return `video/${ext}`;
}
function mountWorkspacePanel(deps) {
  const root = el4("div", "la-ws");
  const toolbar = el4("div", "la-ws-toolbar");
  const refreshBtn = el4("button", "la-btn la-btn-mini", "Refresh");
  const uploadBtn = el4("button", "la-btn la-btn-mini la-btn-primary", "Upload...");
  const newFolderBtn = el4("button", "la-btn la-btn-mini", "New folder");
  const newFileBtn = el4("button", "la-btn la-btn-mini", "New file");
  const downloadZipBtn = el4("button", "la-btn la-btn-mini", "Download .zip");
  const spacer = el4("span", "la-flex-spacer");
  const status = el4("div", "la-ws-status");
  toolbar.append(refreshBtn, uploadBtn, newFolderBtn, newFileBtn, downloadZipBtn, spacer, status);
  root.appendChild(toolbar);
  const split = el4("div", "la-ws-split");
  const treeWrap = el4("aside", "la-ws-tree");
  const pane = el4("section", "la-ws-pane");
  split.append(treeWrap, pane);
  root.appendChild(split);
  const dirCache = new Map;
  const expanded = new Set([""]);
  let selectedPath = null;
  let selectedIsDirectory = false;
  let selectedSize = 0;
  let selectedIsSystem = false;
  const pendingList = new Set;
  const setStatus = (text, isError = false) => {
    status.textContent = text;
    status.classList.toggle("is-error", isError);
    if (!isError && text) {
      setTimeout(() => {
        if (status.textContent === text)
          status.textContent = "";
      }, 3000);
    }
  };
  const requestList = (path) => {
    if (pendingList.has(path))
      return;
    pendingList.add(path);
    deps.sendBackend({ type: "ws_list", path });
  };
  const renderTree = () => {
    treeWrap.innerHTML = "";
    const renderDir = (path, depth, parentEl) => {
      const children = dirCache.get(path);
      if (children === undefined) {
        const placeholder = el4("div", "la-ws-row la-ws-loading");
        placeholder.style.paddingLeft = `${depth * 14 + 8}px`;
        placeholder.textContent = "Loading...";
        parentEl.appendChild(placeholder);
        requestList(path);
        return;
      }
      if (children.length === 0 && depth === 0) {
        const empty = el4("div", "la-ws-empty");
        empty.textContent = "Workspace is empty. Upload a file or have the agent write one.";
        parentEl.appendChild(empty);
        return;
      }
      for (const entry of children) {
        const row = el4("div", `la-ws-row ${selectedPath === entry.path ? "is-selected" : ""}`);
        row.style.paddingLeft = `${depth * 14 + 6}px`;
        const caret = el4("span", "la-ws-caret");
        const icon = el4("span", "la-ws-icon");
        const name = el4("span", "la-ws-name", entry.name);
        const size = el4("span", "la-ws-size", entry.isDirectory ? "" : fmtBytes(entry.sizeBytes));
        if (entry.isDirectory) {
          caret.textContent = expanded.has(entry.path) ? "▾" : "▸";
          icon.textContent = "\uD83D\uDCC1";
        } else {
          caret.textContent = " ";
          icon.textContent = "\uD83D\uDCC4";
        }
        row.append(caret, icon, name);
        if (entry.isSystem) {
          const tag = el4("span", "la-ws-system-tag", "system");
          tag.title = "System file — needed by the agent. You can read and edit it, but deleting or renaming is blocked.";
          row.appendChild(tag);
        }
        row.appendChild(size);
        row.addEventListener("click", (ev) => {
          ev.stopPropagation();
          selectedPath = entry.path;
          selectedIsDirectory = entry.isDirectory;
          selectedSize = entry.sizeBytes;
          selectedIsSystem = !!entry.isSystem;
          if (entry.isDirectory) {
            if (expanded.has(entry.path))
              expanded.delete(entry.path);
            else {
              expanded.add(entry.path);
              if (!dirCache.has(entry.path))
                requestList(entry.path);
            }
          } else if (entry.sizeBytes < 4 * 1024 * 1024) {
            const kind = previewKind(entry.path);
            if (kind === "text")
              deps.sendBackend({ type: "ws_read_text", path: entry.path });
            else if (kind !== "binary")
              deps.sendBackend({ type: "ws_download", path: entry.path });
          }
          renderTree();
          renderPane();
        });
        parentEl.appendChild(row);
        if (entry.isDirectory && expanded.has(entry.path)) {
          renderDir(entry.path, depth + 1, parentEl);
        }
      }
    };
    renderDir("", 0, treeWrap);
  };
  const renderPane = () => {
    pane.innerHTML = "";
    if (!selectedPath) {
      pane.appendChild(el4("div", "la-ws-pane-empty", "Select a file or folder."));
      return;
    }
    const header = el4("div", "la-ws-pane-header");
    const title = el4("div", "la-ws-pane-title", selectedPath);
    const meta = el4("div", "la-ws-pane-meta", selectedIsDirectory ? "Directory" : fmtBytes(selectedSize));
    header.append(title, meta);
    pane.appendChild(header);
    const actions = el4("div", "la-ws-pane-actions");
    if (!selectedIsDirectory) {
      const dl = el4("button", "la-btn la-btn-mini", "Download");
      dl.addEventListener("click", () => deps.sendBackend({ type: "ws_download", path: selectedPath }));
      actions.appendChild(dl);
    }
    const dlZip = el4("button", "la-btn la-btn-mini", selectedIsDirectory ? "Download as .zip" : "Download in zip");
    dlZip.addEventListener("click", () => deps.sendBackend({ type: "ws_download_zip", paths: [selectedPath] }));
    actions.appendChild(dlZip);
    const rename = el4("button", `la-btn la-btn-mini${selectedIsSystem ? " la-btn-disabled" : ""}`, "Rename");
    rename.disabled = selectedIsSystem;
    if (selectedIsSystem)
      rename.title = "System paths can't be renamed.";
    rename.addEventListener("click", () => {
      const newName = window.prompt(`Rename '${basename(selectedPath)}' to:`, basename(selectedPath));
      if (!newName || newName === basename(selectedPath))
        return;
      const to = joinPath(dirname(selectedPath), newName);
      deps.sendBackend({ type: "ws_move", from: selectedPath, to });
    });
    actions.appendChild(rename);
    if (!selectedIsDirectory) {
      const dup = el4("button", "la-btn la-btn-mini", "Duplicate");
      dup.title = "Copy this file to a new name in the same folder.";
      dup.addEventListener("click", () => deps.sendBackend({ type: "ws_duplicate", path: selectedPath }));
      actions.appendChild(dup);
    }
    const inCustomTools = !!selectedPath && (selectedPath === "custom_tools" || selectedPath.startsWith("custom_tools/"));
    const del = el4("button", `la-btn la-btn-mini la-btn-danger${selectedIsSystem ? " la-btn-disabled" : ""}`, "Delete");
    del.disabled = selectedIsSystem;
    if (selectedIsSystem)
      del.title = "This is a system file/folder — the agent depends on it. The backend will reject deletion.";
    del.addEventListener("click", async () => {
      const baseMsg = `Permanently delete '${selectedPath}'?${selectedIsDirectory ? " This removes the folder and everything in it." : ""}`;
      const message = inCustomTools ? `${baseMsg}

This lives under custom_tools/. The agent's saved tool recipes are stored here — only delete if you know what you're doing.` : baseMsg;
      const c = await deps.ctx.ui.showConfirm({
        title: "Delete",
        message,
        variant: "danger",
        confirmLabel: "Delete"
      });
      if (c.confirmed) {
        deps.sendBackend({ type: "ws_delete", path: selectedPath, recursive: selectedIsDirectory });
        selectedPath = null;
      }
    });
    actions.appendChild(del);
    pane.appendChild(actions);
    if (!selectedIsDirectory) {
      const kind = previewKind(selectedPath);
      if (kind === "binary") {
        pane.appendChild(el4("div", "la-ws-pane-note", "Binary file. Download to inspect."));
      } else if (selectedSize >= 4 * 1024 * 1024) {
        pane.appendChild(el4("div", "la-ws-pane-note", "File is larger than 4 MB. Download to view."));
      } else {
        const previewWrap = el4("div", "la-ws-preview");
        previewWrap.textContent = "Loading preview...";
        pane.appendChild(previewWrap);
      }
    }
  };
  const refresh = () => {
    dirCache.clear();
    pendingList.clear();
    requestList("");
    renderTree();
  };
  refreshBtn.addEventListener("click", refresh);
  const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;
  uploadBtn.addEventListener("click", async () => {
    try {
      const targetDir = selectedPath && selectedIsDirectory ? selectedPath : "";
      const files = await deps.ctx.uploads.pickFile({ multiple: true, maxSizeBytes: 25 * 1024 * 1024 });
      if (files.length === 0)
        return;
      for (const file of files) {
        const path = joinPath(targetDir, file.name);
        const total = Math.max(1, Math.ceil(file.bytes.length / UPLOAD_CHUNK_BYTES));
        const transferId = `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        for (let i = 0;i < total; i++) {
          const start = i * UPLOAD_CHUNK_BYTES;
          const chunk = file.bytes.subarray(start, Math.min(file.bytes.length, start + UPLOAD_CHUNK_BYTES));
          const dataBase64 = await bytesToBase64(chunk);
          deps.sendBackend({ type: "ws_upload_part", transferId, path, dataBase64, index: i, total });
        }
        setStatus(`Uploading ${file.name} (${total} part${total === 1 ? "" : "s"})...`);
      }
    } catch (err) {
      setStatus(`Upload failed: ${err.message}`, true);
    }
  });
  newFolderBtn.addEventListener("click", () => {
    const targetDir = selectedPath && selectedIsDirectory ? selectedPath : "";
    const name = window.prompt(`New folder name under '${targetDir || "/"}':`);
    if (!name)
      return;
    deps.sendBackend({ type: "ws_mkdir", path: joinPath(targetDir, name) });
  });
  newFileBtn.addEventListener("click", () => {
    const targetDir = selectedPath && selectedIsDirectory ? selectedPath : "";
    const name = window.prompt(`New file name under '${targetDir || "/"}':`);
    if (!name)
      return;
    deps.sendBackend({ type: "ws_write_text", path: joinPath(targetDir, name), content: "" });
  });
  downloadZipBtn.addEventListener("click", () => {
    deps.sendBackend({ type: "ws_download_zip", paths: selectedPath ? [selectedPath] : [] });
    setStatus("Building zip...");
  });
  refresh();
  return {
    root,
    onListed(path, entries) {
      pendingList.delete(path);
      dirCache.set(path, [...entries]);
      renderTree();
    },
    onTextPushed(path, content) {
      if (path !== selectedPath)
        return;
      const wrap = pane.querySelector(".la-ws-preview");
      if (!wrap)
        return;
      wrap.innerHTML = "";
      const editor = document.createElement("textarea");
      editor.className = "la-ws-editor";
      editor.value = content;
      editor.spellcheck = false;
      const bar = document.createElement("div");
      bar.className = "la-ws-editor-bar";
      const statusLabel = document.createElement("span");
      statusLabel.className = "la-ws-editor-status";
      statusLabel.textContent = "Saved";
      const saveBtn = document.createElement("button");
      saveBtn.className = "la-btn la-btn-mini la-btn-primary";
      saveBtn.textContent = "Save";
      saveBtn.disabled = true;
      let savedValue = content;
      const markDirty = () => {
        const dirty = editor.value !== savedValue;
        saveBtn.disabled = !dirty;
        statusLabel.textContent = dirty ? "Unsaved changes" : "Saved";
        statusLabel.classList.toggle("is-dirty", dirty);
      };
      const doSave = () => {
        if (editor.value === savedValue)
          return;
        const next = editor.value;
        deps.sendBackend({ type: "ws_write_text", path, content: next });
        savedValue = next;
        saveBtn.disabled = true;
        statusLabel.textContent = "Saved";
        statusLabel.classList.remove("is-dirty");
      };
      editor.addEventListener("input", markDirty);
      editor.addEventListener("keydown", (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && (ev.key === "s" || ev.key === "S")) {
          ev.preventDefault();
          doSave();
        }
      });
      saveBtn.addEventListener("click", doSave);
      bar.append(statusLabel, saveBtn);
      wrap.appendChild(bar);
      wrap.appendChild(editor);
    },
    onChanged() {
      refresh();
      setStatus("Workspace updated.");
    },
    onDownloadReady(path, dataBase64, mimeType) {
      if (path === selectedPath) {
        const kind = previewKind(path);
        const wrap = pane.querySelector(".la-ws-preview");
        if (wrap && (kind === "image" || kind === "audio" || kind === "video")) {
          wrap.innerHTML = "";
          const dataUrl = `data:${mimeType || mimeFromKind(kind, path)};base64,${dataBase64}`;
          let media;
          if (kind === "image") {
            const img = document.createElement("img");
            img.className = "la-ws-preview-img";
            img.src = dataUrl;
            img.alt = basename(path);
            media = img;
          } else if (kind === "audio") {
            const a = document.createElement("audio");
            a.className = "la-ws-preview-audio";
            a.controls = true;
            a.src = dataUrl;
            media = a;
          } else {
            const v = document.createElement("video");
            v.className = "la-ws-preview-video";
            v.controls = true;
            v.src = dataUrl;
            media = v;
          }
          wrap.appendChild(media);
          return;
        }
      }
      const blob = base64ToBlob(dataBase64, mimeType);
      triggerDownload(blob, basename(path));
      setStatus("Downloaded.");
    },
    onZipReady(dataBase64, filename) {
      const blob = base64ToBlob(dataBase64, "application/zip");
      triggerDownload(blob, filename);
      setStatus("Zip ready.");
    },
    onError(error) {
      setStatus(error, true);
    },
    focusFile(path) {
      const parts = path.split("/").filter(Boolean);
      let cur = "";
      for (let i = 0;i < parts.length - 1; i++) {
        cur = cur === "" ? parts[i] : `${cur}/${parts[i]}`;
        expanded.add(cur);
        if (!dirCache.has(cur))
          requestList(cur);
      }
      selectedPath = path;
      selectedIsDirectory = false;
      selectedSize = 0;
      selectedIsSystem = true;
      const kind = previewKind(path);
      if (kind === "text")
        deps.sendBackend({ type: "ws_read_text", path });
      else if (kind !== "binary")
        deps.sendBackend({ type: "ws_download", path });
      renderTree();
      renderPane();
    }
  };
}

// src/ui/characters-panel.ts
function el5(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls)
    e.className = cls;
  if (text !== undefined)
    e.textContent = text;
  return e;
}
function fmtBytes2(n) {
  if (n < 1024)
    return `${n} B`;
  if (n < 1024 * 1024)
    return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024)
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function pctClampedString(used, cap) {
  if (cap <= 0)
    return "—";
  return `${Math.min(100, Math.round(used / cap * 100))}%`;
}
function mountCharactersPanel(deps) {
  const root = el5("div", "la-chars");
  const toolbar = el5("div", "la-chars-toolbar");
  const refreshBtn = el5("button", "la-btn la-btn-mini", "Refresh");
  const revertAllBtn = el5("button", "la-btn la-btn-mini la-btn-danger", "Revert all edits");
  revertAllBtn.title = "Revert every live edit across every character. Cascade-aware.";
  const spacer = el5("span", "la-flex-spacer");
  const summary = el5("div", "la-chars-summary");
  toolbar.append(refreshBtn, revertAllBtn, spacer, summary);
  root.appendChild(toolbar);
  const list = el5("div", "la-chars-list");
  root.appendChild(list);
  let lastEntries = [];
  const refresh = () => {
    deps.sendBackend({ type: "list_characters_storage" });
  };
  refreshBtn.addEventListener("click", refresh);
  revertAllBtn.addEventListener("click", async () => {
    const targets = lastEntries.filter((e) => e.liveEditCount > 0);
    if (targets.length === 0)
      return;
    const total = targets.reduce((acc, e) => acc + e.liveEditCount, 0);
    const c = await deps.ctx.ui.showConfirm({
      title: "Revert every edit",
      message: `Revert ${total} live edit${total === 1 ? "" : "s"} across ${targets.length} character${targets.length === 1 ? "" : "s"}? Cascade-aware. Cannot be undone in one click.`,
      variant: "danger",
      confirmLabel: "Revert all"
    });
    if (!c.confirmed)
      return;
    revertAllBtn.disabled = true;
    revertAllBtn.textContent = "Reverting...";
    for (const entry of targets) {
      deps.sendBackend({ type: "revert_character_all", characterId: entry.characterId });
    }
    revertAllBtn.disabled = false;
    revertAllBtn.textContent = "Revert all edits";
  });
  const renderRow = (entry) => {
    const row = el5("div", "la-chars-row");
    const main = el5("div", "la-chars-main");
    const nameRow = el5("div", "la-chars-name");
    nameRow.appendChild(el5("span", "la-chars-name-text", entry.characterName));
    nameRow.appendChild(el5("span", "la-chars-size", fmtBytes2(entry.ledgerBytes)));
    main.append(nameRow, el5("div", "la-chars-meta", `${entry.liveEditCount}/${entry.editCount} edit${entry.editCount === 1 ? "" : "s"} live`));
    const actions = el5("div", "la-chars-actions");
    const viewBtn = el5("button", "la-btn la-btn-mini", "View in workshop");
    viewBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      deps.onFocusCharacter(entry.characterId, entry.characterName);
    });
    const revertBtn = el5("button", "la-btn la-btn-mini la-btn-danger", "Revert all");
    revertBtn.title = "Revert every live edit on this character. Cascade-aware.";
    revertBtn.disabled = entry.liveEditCount === 0;
    revertBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const c = await deps.ctx.ui.showConfirm({
        title: `Revert all edits: ${entry.characterName}`,
        message: `Revert every live edit on this character (${entry.liveEditCount} edit${entry.liveEditCount === 1 ? "" : "s"})? Cascade-aware. The ledger keeps the history so reverts can be undone individually.`,
        variant: "danger",
        confirmLabel: "Revert all"
      });
      if (!c.confirmed)
        return;
      revertBtn.disabled = true;
      revertBtn.textContent = "Reverting...";
      deps.sendBackend({ type: "revert_character_all", characterId: entry.characterId });
    });
    const squashBtn = el5("button", "la-btn la-btn-mini la-btn-danger", "Clear ledger");
    squashBtn.title = "Clear the edit ledger for this character. The card itself is NOT touched.";
    squashBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const c = await deps.ctx.ui.showConfirm({
        title: `Clear ledger: ${entry.characterName}`,
        message: `Permanently clear ${entry.editCount} edit log entr${entry.editCount === 1 ? "y" : "ies"} for this character? The card itself is NOT touched. You won't be able to revert any of these edits after this.`,
        variant: "danger",
        confirmLabel: "Clear"
      });
      if (!c.confirmed)
        return;
      squashBtn.disabled = true;
      squashBtn.textContent = "Clearing...";
      deps.sendBackend({ type: "squash_character", characterId: entry.characterId });
    });
    actions.append(viewBtn, revertBtn, squashBtn);
    row.append(main, actions);
    return row;
  };
  const render = (entries, workspaceUsed, workspaceCap) => {
    lastEntries = entries;
    summary.innerHTML = "";
    summary.append(el5("span", "la-chars-summary-pill", `Workspace ${fmtBytes2(workspaceUsed)} / ${fmtBytes2(workspaceCap)} (${pctClampedString(workspaceUsed, workspaceCap)})`));
    list.innerHTML = "";
    if (entries.length === 0) {
      list.appendChild(el5("div", "la-chars-empty", "No characters with edits yet."));
      return;
    }
    for (const entry of entries)
      list.appendChild(renderRow(entry));
  };
  render([], 0, 1);
  refresh();
  return {
    root,
    onPushed(entries, workspaceUsed, workspaceCap) {
      render(entries, workspaceUsed, workspaceCap);
    },
    refresh() {
      if (lastEntries.length === 0)
        refresh();
      else
        refresh();
    }
  };
}

// src/ui/combo.ts
function el6(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls)
    e.className = cls;
  if (text !== undefined)
    e.textContent = text;
  return e;
}
function fuzzyScore(needle, hay) {
  if (needle.length === 0)
    return 1;
  const n = needle.toLowerCase();
  const h = hay.toLowerCase();
  if (h.startsWith(n))
    return 100;
  if (h.includes(n))
    return 50;
  let hi = 0;
  for (let ni = 0;ni < n.length; ni++) {
    const idx = h.indexOf(n[ni], hi);
    if (idx < 0)
      return 0;
    hi = idx + 1;
  }
  return 10;
}
function mountCombo(root) {
  root.classList.add("la-combo");
  let items = [];
  let value = null;
  let placeholder = "—";
  let disabled = false;
  let isOpen = false;
  let activeIndex = -1;
  let listeners = [];
  const trigger = el6("button", "la-combo-trigger");
  trigger.type = "button";
  const triggerLabel = el6("span", "la-combo-trigger-label", placeholder);
  const caret = el6("span", "la-combo-caret", "▾");
  trigger.append(triggerLabel, caret);
  const pop = el6("div", "la-combo-pop");
  pop.style.display = "none";
  const search = document.createElement("input");
  search.className = "la-combo-search";
  search.type = "text";
  search.placeholder = "Search...";
  const list = el6("div", "la-combo-list");
  pop.append(search, list);
  root.append(trigger, pop);
  let filtered = [];
  const renderList = () => {
    const q = search.value.trim();
    if (q.length === 0) {
      filtered = [...items];
    } else {
      filtered = items.map((it) => ({ it, score: Math.max(fuzzyScore(q, it.label), it.sublabel ? fuzzyScore(q, it.sublabel) / 2 : 0) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.it);
    }
    list.innerHTML = "";
    if (filtered.length === 0) {
      list.appendChild(el6("div", "la-combo-empty", q ? "No matches" : "No items"));
      activeIndex = -1;
      return;
    }
    for (let i = 0;i < filtered.length; i++) {
      const item = filtered[i];
      const row = el6("button", `la-combo-item ${item.id === value ? "is-selected" : ""} ${i === activeIndex ? "is-active" : ""}`);
      row.type = "button";
      row.dataset["id"] = item.id;
      const label = el6("div", "la-combo-item-label", item.label);
      row.appendChild(label);
      if (item.sublabel) {
        const sub = el6("div", "la-combo-item-sub", item.sublabel);
        row.appendChild(sub);
      }
      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        select(item.id);
      });
      row.addEventListener("mouseenter", () => {
        activeIndex = i;
        updateActive();
      });
      list.appendChild(row);
    }
  };
  const updateActive = () => {
    for (let i = 0;i < list.children.length; i++) {
      const child = list.children[i];
      child.classList.toggle("is-active", i === activeIndex);
    }
    const activeEl = list.children[activeIndex];
    if (activeEl)
      activeEl.scrollIntoView({ block: "nearest" });
  };
  const updateTrigger = () => {
    const item = value ? items.find((it) => it.id === value) : null;
    triggerLabel.textContent = item ? item.label : placeholder;
    trigger.classList.toggle("is-placeholder", !item);
  };
  const open = () => {
    if (disabled || isOpen)
      return;
    isOpen = true;
    pop.style.display = "";
    root.classList.add("is-open");
    search.value = "";
    activeIndex = Math.max(0, filtered.findIndex((it) => it.id === value));
    renderList();
    queueMicrotask(() => search.focus());
  };
  const close = () => {
    if (!isOpen)
      return;
    isOpen = false;
    pop.style.display = "none";
    root.classList.remove("is-open");
  };
  const select = (id) => {
    value = id;
    updateTrigger();
    close();
    for (const fn of listeners)
      fn(value);
  };
  trigger.addEventListener("click", () => {
    isOpen ? close() : open();
  });
  search.addEventListener("input", () => {
    activeIndex = filtered.length > 0 ? 0 : -1;
    renderList();
  });
  search.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (filtered.length > 0) {
        activeIndex = Math.min(filtered.length - 1, activeIndex + 1);
        updateActive();
      }
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (filtered.length > 0) {
        activeIndex = Math.max(0, activeIndex - 1);
        updateActive();
      }
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      if (activeIndex >= 0 && filtered[activeIndex])
        select(filtered[activeIndex].id);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      close();
      trigger.focus();
    }
  });
  const onDocClick = (ev) => {
    if (!isOpen)
      return;
    if (!root.contains(ev.target))
      close();
  };
  document.addEventListener("mousedown", onDocClick);
  updateTrigger();
  return {
    setItems(next) {
      items = [...next];
      if (isOpen)
        renderList();
      updateTrigger();
    },
    setValue(id, silent) {
      const next = id && items.some((it) => it.id === id) ? id : null;
      if (next === value)
        return;
      value = next;
      updateTrigger();
      if (!silent)
        for (const fn of listeners)
          fn(value);
    },
    getValue() {
      return value;
    },
    onChange(handler) {
      listeners.push(handler);
      return () => {
        listeners = listeners.filter((h) => h !== handler);
      };
    },
    setPlaceholder(text) {
      placeholder = text;
      updateTrigger();
    },
    setDisabled(d) {
      disabled = d;
      trigger.disabled = d;
      root.classList.toggle("is-disabled", d);
      if (d)
        close();
    },
    destroy() {
      document.removeEventListener("mousedown", onDocClick);
      root.innerHTML = "";
      listeners = [];
    }
  };
}

// src/generated/default-icon.ts
var DEFAULT_ICON_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAfkAAAH5CAYAAACCtkfkAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAP+lSURBVHhe7P170G5Xed2J9l/9R3dXV7rKXTldlcof6fJJVZfjnEpSrrRT3aechKrYubZj2iF2bOMT37AS+5hgJZiEIBJM7IImRChuHBFzaSsYFHwJNMINMiBj3TbSltCW1AixOdoieAscEJYsaW/t79R41hxzjTnWM9e73u/79k2as2rUet91nWutOedvPs+8rP/sPxthhBFGGGGEEUYYYYQRRhhhhBFGGGGEEUYYYYQRRhhhhBFG2D88/+Tv/ueTvviHJv3uH5Xf/7nvP8III4wwwggjXIGhwvypr3zTwbNPffvB88+9/ODC+WsPnj9/3cHz595y8Py5dxwcnL85lvgf25596fNPf+1bJ/gP6I8wwggjjDDCFRUC7gA7oB4gP3frwcFTDz779OMX1nTuD548gLBvwP/C+Wsn4H/xD/k1RhhhhBFGGGGESxiKK/6PBtwB6YOnHvyDr37uggtAP/+VMwcOeVcFflj6z750WPcjjDDCCCOMcBlCAP7pr30rgHzh6/+/LznUKf3v2zJxn2rdB+yHZT/CCCOMMMIIlyQAuoAv3PJute8jB7zDHqqW/bNPffuA/QgjjDDCCCNcxDABHu75px586onPLsCtwnbq62fvP4D43/fNtIA92uyf/N0/6nEaYYQRRhhhhBGOGCbAn7vG294V3AD5s2cfCqDvEuHv58iEbbTqS2/80VY/wggjjDDCCMcRFPA9GDvE95Va/l4B0GX03g/3/QD9CCOMMMIIIxwpqIvewU740nrn8rnH72tEkH/1sbsWcNfjVKw4+PWwbrLqn3v5aKcfYYQRRhhhhEOGuZPdbsBTTz02wx1QpxzilG5bnEsse16vBf25awboRxhhhBFGGGHPAHd4zFxXetFrRzi1qgFmteABeYKb2559+MTBU3f+1sFX3vfu0DO33Xzw7IN3xjacxysBDnsou/YE+vPXDdCPMMIII4wwwsZQZ7E7OH+zw5WWtYLYLfeoFDxwx8HX33nDwZevedXB49/2soPP/9m/3uiR/+k7Yxug/+yjJ6t7fg3y2lbP/zPoR8/7EUYYYYQRRtgZppnszr3FJ7pxS1ph/OXTn5ngfvrUwZeuf2tA/MFv+SsV6gC9its//if/wsFn/vYPH/z+hz50gJnxAG637Hk9r2xwiXgivsOiH2GEEUYYYYSV0Bsq54AF4BXI+A9Q/99//eUBb4Acv6F7//r3puL2h7/1b8QxZ372jQfPnXkkrqGgpwWv0HdNoB8W/QgjjDDCCCOkIWuHh3VNkNY29gJ4AvfZh+84+OIbrw1Qw0J3uN/3v/ZBT6FSgOM/830/dvDsvZ9q2urVY4D1XNKa5+8Z9MOiH2GEEUYYYYQmFDf9Owh4t5YV8tU9f9cnFta7AxyQz6T7qFV/6iUvq+57d927Ra/Ar230MTveAP0II4wwwggjRMjGw/es+LCun378wjO3/3ptd1fr3WG+RQp7eAPu/La/cfDMR24K0H/ps+ugd4t+DK8bYYQRRhhhBAnxVbnkozN0zS8s+AfvDIvbrXeHN4XOdSrfrrDH+XBegB499HHdNYteO+Ex3mPCnBFGGGGEEUagFX/h/LXem17hru3iGC4HINOCz+DuUM/kxyjotZ0ew+wQH1j0PdhrnGfQjylwRxhhhBFGeJGHNSu+Av7MQ9Owuacfv/DoT7+qDosD5B3SAfHv+7F1rUCeoFeLnqDvQV5Br8JY//FRmxFGGGGEEV6UIbPiaQ17RzsAHu5z7WRHqBPOp/7Oj4YWUM+0Yt1rGz0tenTGQxzYRo/Z9eiud9DzHsoY+neMoXUjjDDCCCO86ELPiic46aYP6D9wR1jVR7LgMyWQd4senfHY6x5xgUUPyCvoGWfviDeG1o0wwggjjPCiC27Fawc2b4tXN30KeAf3HqrWf2LNcwnA49qoZGDYHuKY9bpH/Lnk/eD/6Ig3wggjjDDCiypwfnq3fBXysJSxHhY03fTe0e7QFryBPn4n1ryDHpUMgB7w7rXR8z54XxPoR0e8EUYYYYQRXgQhZreTcfFqxSvkaRUDwJzNroH7MQC+0YrbfgH6R09Gh0AHPd32atVD4bZHR7ynvvJN/jxGGGGEEUYY4QUTdHY7lQMebnr0bIeb3N30FxPya6BnRzw0H+CDOPz6HdvnHfh6f6N9foQRRhhhhBd8mOaoX1rxCngIH4yBK9072x073FUd0BPy7IwH0GPOfMS3N4be3fbQaJ8fYYQRRhjhBRvY4c7np3fIc8gc5pNPrXiH83FpA+TVokccEX9a85isx0HPe8Q9QaN9foQRRhhhhBdkYIc7B3zT4Q6/Hz1ZYboA/GWAfAZ7xA2VEMxzD6AD9A55qFZiCuTDoh/j50cYYYQRRnghhflzsk892LPkacV/6fq3hqW8cNNfTMBTAvoe7CFOlhMd8R64owv63JofX6wbYYQRRhjhBRSmr82dv84BH/BTV/3pU40V30DXgXwxtAHyas2jx310xJOP2Tjo/X7Dmgfoh9t+hBFGGGGEF0KIXvUH5292yFc3/WP3hRX/5Zve1kx8c8khT+0APWHP9nl4HxB/gt573DvkJ9CPYXUjjDDCCCO8AIL2qs8gTxACnmrFV9A7hC+F9gS9Tn2rgKfY54D3PobVjTDCCCOMcNWHaQKcc9dwGlta82yL5+x2z9x2c53djhC9LFZ8Ioe7Qp7t8/j97IlPBtDZPu8WPe63teYxrO7Zlw63/QgjjDDCCFdlmNrjz71F4ZYNm/v8a167GDZ3pUB+zaIn6NHMcPpHfiTG+OtEORno1aIfbvsRRhhhhBGu2sD2+MyKR0c7gO+pR0/WL80Bmg3kHbiXSx3IE/TaPk+3fTYjHis2BP1w248wwggjjHBVBh06p5Z8teLPPBTgR4c7HzZ3FMj3vi3fW79JnTb6bPw82ufptn/mCydS0Kvr/uC5s/eM3vYjjDDCCCNcVaG46q8B5Jsx42cfCrc2XfWf/gfXNB+iUaAuYLsifj42k++7tzQuiVW/cNs/fl+d374Heq34jElyRhhhhBFGuKpC+SDNWwByQl7b4/H/6w9/6lg+RONQz+TH7JTGIflNuKtFT7f9F999Y7jkFfJroJ864Z27ZrjtRxhhhBFGuCrCNJXtuVsJMp3GFpYu4I+vzbmrfh+4Uw70TH7MJvUqG2LNq8ueoMfymdt/fT+3/cG5W59/+mvf6s9xhBFGGGGEEa6o4O3xtORre/zZ+w9+/8u/e4Be9amr3qG6Qw70TH7MTq01G3Rc9u62x73Sbc+OeD6Wns9ndMIbYYQRRhjhqgjT+PjnXs7x8Qp4Qh696wHHUy9JPkbjUN0hB3omP2aTeqAXl71Cnku67eGpwL075BX0fD7VbT864Y0wwggjjHAlB7bHqxVPVz3Bhl7oOja+C9QNcqBn8mMW6l03i5PE1UFPax4eCqx79pG7G2veIb8A/eiEN8III4wwwpUc+GlZ71WvkMeY8hTyDtkNcqC7fP+9lMVJKyQd1z3uS8fOf+mzU9u8u+3xTNhfoVrzYya8EUYYYYQRrsQwueqffSmHzmmHO0IeQpv1cbjqVQ73NcCvbWvkcTLA9yBPtz1GDzx7zzzlLXvaqzVP0M9u+zET3ggjjDDCCFdgiPHxF85fq+3x2qs+fj98R7V2G8A7UI9RDv5dlYCuEshnsFdr/nP/9PXVmndLHlJLfu6EhyF1w5ofYYQRRhjhCgqlPf4dBFbmqn/mIzc14+MJyMNAfguoG8ALlLce26xL4O6Q1054uMew5u/6RGPNa5u8gp4a1vwII4wwwghXXMBYbx0fr5AH3Nge75PgVFgmoD2Uyrl6gD/0tfwcCeQza/7Rn37Voqd9BnpWjsYEOSOMMMIII1xRQdvj3VWvlvzn3/D6aI8nGHeBV0GdAlsBnMA4PSY7fov8WJMC3tvmdV77bBY8ddtDY4KcEUYYYYQRrpig7fHuqifkMT4+oCud7nbBViG9CvtEO/dLrteVH5uo57LHSALM06/z2nvbvFrzULTNXzh/7bDmRxhhhBFGuOyB4+PV7aygj993faLpdNcDrsO8JxznS/7W9T3Qx3qH+ZoYz+RcVGbNs23+6++8IWCunfAyt/3cNj+s+RFGuGID3JeZfL8RRnghBB0frwor/sxDAXzMAgcrfmt7vEN9J7ATa3/XMXuDfg/IqzWP6W7x/9lHT3YnxqGGNT/CCFdoKCD/o9EBCe2T+NzmhfPXYl7qafncy2Pqyqe+8k3IuAP6I7wQQp2v/rmz96jLWd31+M9JcBaAhzbCfQ3aVHacb2/O5RDfpeSaVAZ5ts3rV+p6Q+rcbT+s+RFGuMyBYJ+gfv46WDPRO/bgqQfP/cGTBxS+vAVxW+wH8E/zVf/RAfwRrtYwdbo7d423x9OSDz39+IUn3vwzMeWrwjDg6BBNesZnwF7b5vv0dNyQh3qgx71j+ewDd6y2zdOax/Mb1vwII1zGEIAPq/3cOwBuFGRRwJUlRdclf1dLh9DH8dN0lgP2I1x1ITrdPX/uLYS8pnfCHr/R+YzzujeA59K0CdA7IL9TyXV3ys9hUsh72zys+TM/+8ZmgpwM8vocx7j5EUa4DGEq2J57uY4LPv+VM80HJxTwEDIvXZcO/WrdP//cywfsR7iaQniyDs7frOlZXfVM+wAx3NYE4S7Y9sCtcOeyt29Pzf7JtVeVnE9FyGeg5zfnn733UwHzHuRpzdeyYYybH2GESxdKT+JrdEywijDXDFuHEdnSLZ9q2Ycbf2TqEa78wElwtOLqkMf6L1/zqnyMvEO0A9MM5AR8tq2nxf7lenW9x8OVnNPVA71b8+q2zyA/lwvDmh9hhEsSOB7YAa+WugpjY3XpGZlyi3+C/fnrpk56w6of4coMU3v8/FEa5gUFPWEG4O0aPqcicBXka3LQ9rTYP7n2qpJzunqQh1DRieluT7Qfr8ksepYvU3kQXr5RFowwwsUKpe0xLHgWaJBCHRkTQF+TZ+QM9vgdnW7gwh9W/QhXaMgmweGy5ounH7/w1dvmOesJwQaMDtJEPaj7/y1a7J9cb6eS80IK+Az0nCAHs//hOfXa5lkWVNCP782PMMLFC5PFgjb4FvBqsYRr8rEl1F0O9kwEPQRX6GiTG+FKDPwojX95ziH/tVtuDDf1Ppa8yuHukOdyb+AT1sk1d8rPZepBvmmbf/hE5PGeyx7iM52s+fG9+RFGOPZQxwHbxzfULYnM6DDfJc/MDnkWlhPoi/t+1ORHuILCNAnO1B7frfwWyKNn/WEhT20B+dq2dD8CO7neTiXnVfVAz1nwTr39TfF8YM1nLnuWLcOaH2GEiximjkXTbF4Kd/5mZlQrnh+hUDnkezV3hz2vU741PTL5CFdMmCq/7UdpvPKLeSLgmoYlr/CrMHRwrkghvwv2qQhmXx4iLlV+DZFDnku0y8Oav+U7vufg2QfvjOfUs+a1DIjK/jS3xrDmRxjhOALn5FZ3JDMclu6qp+K/VAZY4HlNfU08Rs9TQf/01751ZPQRLmfImrAIdyrScZkIB1O7OvgOA1aH/C7Y1+1+rksAeSiz5GnNs6c9rfmsfNCK05T/4dEbTXcjjHDkMI+FXw6V88KMmbOC/95PxeclMV83hN/PPnxH7It9sG+WoTNpJoewLobUDNCPcBnDlD/OX8fJn5g+HfKw5H/vxjcci7uecsAT8r6uC/dMvt9W+Xk6kHdrnm3z0dN+R9u8VqLGVLcjjHBMgeN/UYhxohtmtlqInXnowpdPf2aC++lTMTc1MjEy7sf/5F9oFG1wf+dH42tU2BfnVNCzUMyEbSxEq0Vfe94P0I9w6QM73fUqvkzPv//l3z04/SM/EpBH+m+s+KMAtgN1V/f8DmTfvlV+nkQOerfmMa8/nqGOm3cjoLHmx1S3I4xwtKBWCuWQZ+bDf1jryLTIsFAUaC95WSOs43bsC+ueVj3V65CnBSfjgPXR836AfoRLHOqUzskkOEyvTMvIO5gIR+etPxa4diz6TH5cKIHxYp8t4nF+rg7oFfJsm8dvtM0r5L0M0PJnTI4zwghHCDrBRwDd5qIn5GnBo00NljrGviLTetsbLHjP2NgXx6BD0nNnHonMy5p7D/QKfGb2KcMP0I9waYPnEYU8hXSM5X8680jADTBTi/ZIYC1ymPfkx4UcxL59X/n5OnLQuzW/63vzU57n5DjDmh9hhL0Dv41NN71CnoAN2KKzzPVvDVizNr5VrMHjWGR6zH6l7vutw+xYuE5j6TGGdmT6ES5+oKeLHVIV8Ey/aJLC7ydPffp5pvcF4I8IV4e5Qr2Be7lOtu444tGcZ4cc8hD7K9BNT+H5eZNerdyjA+6w5kcYYb+gPYZ7FjwsE2yDix5WOgqvzILfIhyHWjzOg/MB9MzQa6BX1z01g35Y9CNc3KDt8W7Ba9qNPPPg7eG5Yqe7BeQ5Zt2huUEOd1dv//ivcD9m0Mc1OoDP3Pb83jzKAIL9mS+caGBPVciPyXFGGGG/EO2MxYqPwkna4iECGL+fuf9TFfAovBzezMS9TO2gR00eVj1ddlpQ6rh6hb6CnoXtAP0IlyJ4e3xNi8XFzPQaeeUjNzU96zPIL2C5Qw7zNfWOW8A4uc7e8vvqyMsDPBs8I3yOF89xDfK05stw2rcM790II2wMOg+3u+lZkCGTobcwMiOtE4e2gr0nP0ZBj3b6zKJfs+ppzeP/aKMf4WIGHx+vFrxO/BTzRRSPF8bI6/A5Bb2DeE0O8K3KjlXIc+nX2ymtICQw7ykrBzgL3jO3/3o8S3fbq7RSP4bTjTDChqC9hb1HPQFPq4VuegLeAa4FmGZoF49V0LOdHhY92+jVklexAqCZf4B+hIsdtD2ekK+VzQTyT37ghgbynkcUxK4FmJN1W6TH8beDN5TEYVV+/B7KIA+X/edf89oKeVrzDvnGmh/D6UYYYXfwIXN0z3NZreXH7qtA9kLL4d6TH9Oz6DGeHtdnZl+DfQ76MWHOCMcf2B7vVrymTYX8F994bQr5DMQu3+eoYh7U3wsl8Ujlx+0pz/vQ/OGaO6oVj+fooCfkoTGcboQRdoTMiifgtRBjb/qeFd9kYi8QOoVCD/QoFAF6jqWnRQ/YO+Qz2KMA5oQ5w503wnEGfpQGE0GxQhlpTqd1fvRkhTwmwkF69sot0n8DYO/9XuSgPor0mp4XV/NuT37snvK8zw54X77pbfFM19rmZ8iPb82PMMJq0Lb4ALu56VlrxtSTyIgZ4CvkvRDI1MnomuHpuospLx+4o8nw2gnPQU/Ys42+znU/avojHEOI9vjyURpa8jXNdSCPiXAc8pr+GwhbXnEwH1XZuTw/ehx2yo/fQ17JpycP51W4r0E+QD8+XDXCCP2g4+I147gVj0lvtLNdWmh5AdBTktE1szPDw5qHJcT2eWR8t+b9f8RX+hDMvXBHITDC0YJWiHtWPCFPEAGkvYlwMvAifziEHcyHlZ871jl8Pa/ukh+/h7J8zw542XA6/nfQjz44I4zQCb2P0BDwYS3DYnn4RB0yp4WVF1qLAqAny+hcamaH2BFP2+fptnehcKV1v6jpw6U3OuiMcMTA9niFvAOekGd6Zb7RirHDzsF7nEJ+45LX0ms2cfF8uo8SiG+R53tAHs8LlXuUQbTi8Vzdmm864I2v040wwjKw0NIOd9qhKAqs0hYP97l3HloUWJ7x15Rkdkqtebjvwm1/1yeajniuRUErnXMq6MdUmCMcIej4+DXIIz1GZfnkLYuJcNJ8Y73sHdQK5Gwdj/Hl4jch794C5kfPo/soAfgWOeRZuffhdJk133bAO3fraJYbYQQJ2r6okKclz+FpKMyQEXda8YcpJJIM75mes+Jh/RrkqdqzuTQ1NKB/7uw9Y7KcEQ4TpvHx03z12h6fCekQ80k88aFfqJXjNUsecni7uI/u36wreSqDuJ6jdy09x95K7merPL/TmkflCHNmMM9n1jyNkbkSP/L2CCPUwPZFBzwhjwyF3+jhvssaYcFyaO3I9Dp+HnHdBXoI8WdhQMsL4gQaozAYYZ+g4+NZgXS4K+QjX534YOoBc9AxD62p5rNk/0V+yiz1ks8W55UOfn6OzUruZ6uyij3zPJboeEvIU+6yr6AfM+CNMMIctMNd5qpHZsJ61KYd8ppJFwXJYbQj0+v4+V1ue4U8vRG1ULahdQP0I2wNPl+9g10BT8g/+YmbIs3uY8kzTzQgNsDrMbq/56u6DvvL0q917Erub02e3yGOsNH+OGugrxX44bIfYYS+q56QBxyRkbAOGZBz1GfWyLEVFpLhe6BXt3244r/wyQXcXZxEh5WXatGPoXUjbAxzfpna49dc9ZHWHrk73PUY751Bfg30micU9GuQr9uYj+wczbakQnEssms06q0vyvI8nhkq9ognjQ6XQ37qgDfGzI8wQnXV69fmCL/IMBjn+8RnLzx97y3dXvXHXlhIhufSIU+3/RfffeNmtz1Br669uUAYoB9hd9BRKEg76qpHGnTII82FJf+BGza3yWteaPKU7UdoN+Dnfp6n9Bxy7mPNt1Tv+hq/jjLIQ5wcB02GeObM7xno8V6Ky36MmR9hhF6veoIQmQfre73qtcA5lsLCMrxmfAc9ave3fMf3HPzBQ9MkOYS4g93FQljb8OahN6NQGKEfSn55y66hcxDTW3S8e/PPVO/TTshTnjeSPMJ1FfJc1zte8iuXTQXhUsjv05Tld3bAe/SnX9W47BX0bs2jIjZmuRzhRR90Glt2tmPhRVc9/mOsqn8m89gh38nwXGqmJ+jhXYjPUoo1vwX02vO+uu3HGPoRdgT9BHOkmwTqLuwHOG225CHPG1vUOX6RN+1axwp6PYff00Zp+eLWPPI8+uJkkHdrvnjorhku+xFetGEaCrScAKe66osL8ukHbm++GX8pIe+Z3yFPtz3G0RL0WyBP0LONvgH9GEM/QhJ6Q+c8XanoCaMlz7Tr+aeR54utsk55zJOLvJlcTyF/sfPxmvSZOOjZAQ/PEiD/0mfXIT9c9iO86IN+cY6ZgrAD/L58+jORYTCtJHvVZ5BPC5LDyAopl0NeMz6seXbCY3voLthzH+2Mh+NjaswxznYECz6VrXa687SlkIe7HpY88lAP8seSf8xt75Cv55c8tdje2ebXqefx/8csz/M0NAj5rz/8qQb0C5c95sMY09yO8GINE+Sn9ni14umGBOSxLvtEJjMhC4ZuQbBRvYLG5Zke4tz2qIyoNb8F9D3YjzmwR/Cgn5bdYskz7T156tPPs4e4Qr5J24Rkkje2qAvrFXd995hdLvwkX+6lPc7j+X3RAe/hjzaQV9C3fW2GZ26EF2GIQqu0LyrgUXjRkkemQWZ3Vz0z4aIAOaR6hY1LvQgKeRSgWEdrfKs174Vya9GPz9OOMAVU9nQq211WPNNdpKmHT9RhYD3Id4G6UV1gY7tD2/Kuy/dpzqVK8udxy/M6PXeff81rK+QxfDaD/NwEN8bMj/AiDF5o0V1fMwg/m/npX4vCKYN8UzB4AbCnvJDx/57psxq+WvOIew/yTz0yydezUCbsdWjdsOhf3MGHzrEi3IM80xJdxxnkHfSeJ/ZVkxf9nOptK+s1j2k+y/Khx8/z5V6SOCy2mbL8zvnsn733UxPUH56WfciP78yP8CIMOglOBnlkFqzDJB5w1XNqyQzyXtjsKy9sdhUgWcbnBDnR075Y4uqGd8hjkpIM9gp5nKOCfnTeeVGHbOicpytPR1jGfmceueCQ71rzSf7YokX+Meg355brubL12f6eJxvJNVJ5/H27ySv0tOYxAx6er3bAY9mloC8d8MY0tyO8uEJpj79Ge9YzYwBwhLy2x/cs+UWm3SAvSDJ5ZveM75mfQ+qe+chNq9a8Ar4Herr7xaIf36F/EQd31UOaZnzGRaY55KtnT59aWPIO+cPmo15+8u2NCFp3x2tc7D/XLa7jedPOX5eu3nqT5nPN7+jEiGG9hPwml/2YvnqEF1PQj2y4Fc+hc5jtDhmLrnpmtKNA3guItf++Psv8mTUf3582yO8CPf5rAa0W/Qz6MVnOizHo0DmmB01PDnhNRwH5uz5R+41kgNf0vW9+0jzl+StbF8cUyGr+yuKi+THbJ1vvcavK9vN1ibJ8DlWX/YkPVpc9nrkCngbLcNmP8KIM7CkMeLHTnUIeS4w9R43Z2+MPA3kvfHZJz6/rsgIgy/xP33NbFLC9DnhrkNdCGsejoAiX35gs50UZ/KtzDnmkHcrTDvIRh6Cyycsry/vmpUyeV3ryPJSty7Zlv9NzMk76W9ftKS1zNL/TZX/mZ984eR539LKfXfajkj7CiyRMM3edu1V71jNT1Azyznm+7aNAPitofN2+27UAUMjX3rdveP3qcDoWygS8F9IsqNWarxbBAP2LKnCWO3XVZ2nJ045CnrNFalp1yNdlkofW5Pljl9JrGlyzda7uOREv/Pe4Jueo+/m6ogzwFLwjWOdwzyCvLnt/vyOM8IIMUxvj3B6PgovubWYQzCy1Nj6+yeSeoTuFUC0IOtaBb8+UFQKa8as1/8Dt9Z4o7Q2tcN8Kemhy/WG6zAH6F3qoHVSfO3sPIa+Ah+Cu93QDhRfo6ccvoI8ILHmkzR7kq5L8s0uePzItriPKtmfrNiuJ42KfjVqDPMqlmO3yIzdFPkfb/Drkh8t+hBdJ0DZGhTwLMGYOtG3vctXXQsR78EoBpPsz83oB5IWKn9+PzwqCw1rzPfVAj2czW/TD/fdCDjrLnVvxSCMEvLfLs0KJvAVLHulRIZ9Vmpt84pBM5HnD84nnF//fk+7X+73vusOqB3jN55hN0CHPMkwhP1z2I7xoAuesZ3u8Qp4uRmQUZKytkK+FS1IIMcP6b9+eaXH+ZJ+sEKA1j8IW93cUyGewb0E/LPoXaqCrXgHvkM8seYX8M7fdvNOS93TueSnLV1vkeWWL1o7trb+Y0rLH8zk7M+KZ99z1UIX8cNmP8GIIOme9Qx6FU2SKT/9adX074CEvTHaJx2THeqZW+fG9/b0AIOS/eMu7Fta8FsYOdpcX3IQ8nlkF/eh1/4IM6vHCu84s+dDDdyzSC/ZBmgvIJ+76LD+leeMQkPdzunhdXXp8NC5+fG9db/+FcB/Z747WIO8u+51z2Q+X/QgvhlDGyL9FIU/QI2MgMzz5gbnT3VoBsEV6jB/vGToT91vb3wsADlnKJsfxWcoWhTWWUnB74U3Qs+Co4+jH1JkvqLDWq75JJx3IB1yefvzCl65/a/RtWYN8L73vo115RPOKXmsL5NfO6/FY2zckYN+0/4rbXl32KMM4MQ6HAbs1P895MbxvI7yAQzZnPQsxZgy0ZzvkvXDYR/tk6DWtHa+ZnwUArPmv3XJjFLZrw+kWhXan8HbQ8xnWmfHGhBsvmMAJcBTw9d1Leum1yyMfIW0AQOzAqoB3qLo8D7k8T3je4Pl5LY6SyaT7u/y8vfVZnHbJ7yWTPi+HPCv0WD776MnGXd8D/XDZj/CCDz58Tt31zBQomBTynvG8wNklPc7PdVzKCoFqza/MgKfD6P7goTtCUXiXpcO+KeyLNR/P8OnHL/CjNgP0V3dgvxWfAKdryZc0ohVBtsk75Al6T78uz0NZfuJ+/O3wVqEJC0Dk0DPEC51rWQHQPORx6V2vita5dLZNlbnns3WmNdAj7iir0MGR1vxa2/xUIR8u+xFeoAEJOyyU587eswvyHNubZXovdHZJj/FzHZc880N1ON29t2y25lPIJ1Z9ZtFD82dqh0vwag2cLIr5YtVV34E83fU6FLUHec0jvt7X+XaFn0MdQj7mt+yRr/E9CuSHgN4jJw6++O4bFxD163TFvgL6ewO0qV33R3n8PJ8D8l++5lVT88gmyI9e9iO8QEM2fM4hj4wfme8lc896z3SaQXfJj/HzHJeyAgD3gALurte+bmHNp2PmpdBeQL5TmLtFX0Ef1sIA/dUW9ONNW6z4cNdbuoAIebfk9wZpR7vgTrDjs6zomPbMgx+LeCGPI85fefCD06dav/q5C6fe/qbYl/l9Z/ySDoH7Ar6ex9cl2gV5VGSQ1/HM11z2yKPDZT/CCzqoG1IhT9BHwXTikw3gswzvIF8T99flcWutAKhtdg/cMY2ZFWueoK+Q71lpBvldoMdzrD3vR4e8qypMVvyyw10P8pQCnmkLaQEucUCe6THLU55fdmkN8PBcAZ6w2J89ecsMvYc/GmCnAvAPfGCC4ad/bTvkHeo9+XGZNu7nkPd8jvuGNY+puAl6B7yCfvSyH+EFGybIn7tGx8hTXz/zUMAJtf41Vz3lMO/Jj7sYYjyZ+bUQAORRAMQ81yvWfG2bTwrwhaRS4AU7YS+uwdEh7yoKvQ53a4BnmvC0QMjrtLYZRPfJMw46wh3XwDrAvX6VLQF7zPMOq76I+znkPY5VDvOe/LgjSOOk904h3sjjGMmAZ6697CGH/OhlP8ILNuiwILfiaYUio8DVt1ar90Jpl/Q4P9dxKisAIBayuE+15g8NeSnYWbgTBuEN4XXEPYhmklGoXNmhDC+NSrACfifke+ng6ccvoOPnGuT3ySMOOQKew8hgydIVn4nQ5xKQD8v3478cHoC1PF/lMN8lP/6QWoM8xM/PIt/13PWq6CQ7vGwjvNACx8hnkEfCD4v+nTc0lrwXSFxulR53sdUrAHA/7IGr1vyRIW8FvFsPhPxUqJQZ8p76yjcNq/7KDLtmuOumD0sDEPMT0iNnjnTIe/5YyycOOHXPo3NfWO9mua8JgA/gP3bXwVfe9cZFxV7z/UIO8l3y4/eUxsmfA8XRA/hEdlRcBPKZNT+57FHxHnlxhBdQYK9h7SQGnf/KmUj4yACwPHoz3UEO8V3yDHsx1SsA2AGPNX2F/AL0XoBvkbjvCQa67mvl6ez903fpxzC7KzJop1QH/KoVL+9fIY9zPHHvrwWEkZ+YFjVPeV7x/OLpmUvAGO38ODfd8w5xCNeHfB2WaI8n5OEFyPrheN6vcojvUu94/a/LRPossjyOuCOP6wdrvNKtkJ9c9pitcnjXRngBBf1splvy/J19mEYzmxdKW+WZ9mIpKwAgWPMoFDGX+LFb80lB74VLa9XDfY8v2f3uHx2wvzICK8Duqj8K5GFZK+QVUEiru/KHQ03b33E+AE0BT4AT7mtCZzta9MjzHD/vcWykMN5X2XG6Ts+fiPHR+Dnk4a2DV4ND6fAe6Lr3fDhZ88NlP8ILLHAiHCRwWO8B+Kcfr23yyBiEfJbRHdyHkWfe41avEKA1/8U3XlshX93qAvru0Ll9lHTCctCPTnlXTvBhcyngd0BeAR/pCJXmL3yytnXvgrznjSwds/09AN9pf//S3TdXkOO3/neFe/99705d9Vn+r3JA76POcfoM/FnoM9Fnk1XkUX4p5Omyd0u+uuxjTouR/0Z4gQT2HM4seYIPmajnrvdC6TDyjHvc0oLACwEOZeJ906XOgiAKhaNY81Lor1n11OS+n616f18jXJrg89SnkPd3bO9bK3WEPC35LZDP0jHTsHawC4iVoXHuhlcR8Ap6Bz4qCb934xsq5BlHjavHqyoB9ULZftm6zod3FtfsVH6o2i5f8nMdZdCx5ktFG3lvQH6EF0agtULIV2u+QH5tKI1nwKPIM+5xSeObFQQsKNGbmJUatpvTmj90u/yDty/XCezZAUiBj/eA9VMnoGHVX46A500Pl3a4U6t8H8hTAXnptZ5BHtL84GmX6VcB//T9v72w4HcBvgd5tsf7jHye/zW+jRJYV5Bv2cf3FfXKCX82Wf7meHn/Kh1B37jske9GBXuEF0LQjkUK+GrNP/34hcc+9eHuUBoH9VHkGfc4pXH2goAdlnQ++1q7Z0/co1ryCexxThb+CvqAfZmfYHIfnrt19MC/tIHD5rbOcJeqA/kvfeiGnZB3OcTYoQyAj3HtSQ/6XYB32HM/QBDX1K/ksQOex1fjncbfge1QX1Ny3Fo54c+I4pwYGAactcurNR+ePM5+N9rlR3ghhAny82x3hDyWtOQxp7X3stUM7bA+rDTDZuuOS1khwGFHYRGVXu902QeEDwt5wF3l2x+5uwt7rWywB/4YV39pQljxz597Bz1aC8BvSQsdd/3Xfmc5/jwFpKVZplsCHv8zwO8Dd4U8l8jvuA4hT6lV77D3+FZ1YL1Zdj6WCVnZsAvy8E4Q8shzrMA3lXptlx9D6UZ4IYQJ8vlsd4Q8CpJLBfls3XFLCwEvOPE53cxlTxDv7bYXwGed92JdgUYUPLyOWvalUx5UXPjxnfpRAF2coB3u8OwV8g3gs0qbqmPJP/GhX0ghn8HSwYVjai/6224+lIs+E/fFOfAZZvb+d8ivifHP7iOVgtzh3rPay/7ptk5zHIS8je14/vTMZZZ80y4P79moUI9wtYco0C6cv1Yhry57AA+Z3iGvGasH6MNIz6n/XWvbtsgLAlrz+I3CPLPmCfkurL2QdykU1LInNGSpln2tbGgP/PqxmzHc7riDd7jT9vhNFjxlkGe6wodftrrrdRsBHxPdfOgXuoB3gO8jeAUQP1i+Cnn8phT8iAt0y3d8T62EMN5+L12tgL5n0a8pAz3j+/QDt0deUsC7NY93VEe5jHb5Ea724FPaKuABld//8u+Gddub7Q5yUB+nPAOvbveCYaWAYCGghQE76OAzm2rNo3BWt/0moO+Su+/1t3TM47XVs0CN4XYXJ+i8Eamr3t+jv1t5jw3g8WW6px+/8PiN10U628eSZ/oEUDHcE2DqtcE7uF1fvP19i3UKeXyhjpCHBYzfFECJeCEOT9z4z2JMPtz7Xz79mfgOBEGf3csmed7t5N+e9Fk65Dm7Jco2//RsWPc2pHV8lW6EF0TglLYofNRVr+Jsdz2XnIP3KMrOl61zLQoGuvukoOC5GH+HPAoCVGZwv7TkIYf8kUHv7fQqAYRbgt5OX92KYxKdYwvaR8U73DWu+p7sHWaWvM5bvxXy2Jft8NlUtQ7rnnqA53oAG9f4+J/8CzV/oC0bFRMAMj5mI5YvK55hDLzmtasev63SPK15dqsc8Ap5nRSHLnu2zWtlerTLj/CCCQXy71DIew/7yOTfNtXgs4zrwL1UWoB8l6wgoLQwoLW0awY8Qt6XWxT7OtypU5/KrcMCDLbTa2E0rPrjC2WGu/iOwyZXvb+rDuRpyRPyPgY9y1dMp9iPrvGv3nbTworfYr1vFSAPmNNC1+sQ8F7BwLov3vKu2gSxVnnp3acq8nSyfouyPE3V+QQM8u62xzvHexrt8iO8IEIUagfnb1bAe5s8XHOwPJD5skzq8L2UWoB8l5ICQQsFWkw6Ax4tuZ7Lfh/ANzBQqPO3KrHu1apX92IF/ZhE50hBJ4ZauOp771DfU/K+9BysNG+ZTY7/sR8AimazDPAKeVjkKof4mrg/prb1igO38br1k7QF/IgbmyCYl5iv/P6ye+RvL1s8v/o6X8/zOeChKMMwKU6Zh0J72Gt+glj+jXb5Ea76oJB3a56JnXNYe+aCHLqXWguIryj2TwoILxjYe5nuVYc8Qc/CfBfksX2xjwOiB3rCHkuDhxZKbEccVv3hg4402WnFZ+9MYS/vKY5/9GTAhJY83doOQU+X2IfpEZa1W9HHCXkHuh/Pa9Gq5xLxQsc7dm5zuDrw/Z73kedZl19XxT432vmOkKeYpyrkS7v8yEcjXLWBs3oxUbv+05lHIvNk7nqHLP87iC+WHOK7VI/bAXkWBl+99T3H0gEvhXwGix7kVQYQt+iXVj164A9345bAj9FEhXcN8v6+/H95P2rJxznOPnTwH+/8RAViBnkXrXj0eN9lxSukHdC7tM/+7qpH3NCG3wO8yu/vOMR8rNfw60KIH+L5+x/6UEDcIa95CdtHu/wIL4hA96TDHQkcSxROyDQobNwKdog6TC+29Hoeh0z1uI41z8KALntOntFz2S+su45WIZ9BY00dS7Fn1Y9x9dvCPDa+ncZ2AXmHu7+bDuTpFdK26x74mCbZFo99vH2cgHfIH4clz/PoUqUWPSfOiYqIDK2j2Ebv69fEYyh9Jp5nVQ51F87tM9/hO/Pqsme7PMvByD+jXX6EqzWgYFv7OI0XSlsA70C9mPJr7lI9zisrCejZAe/ZE1NnKQX9sUPe4bFL3LfAxCfQYY/n1qofs+WtheiAWuaLcMgT2PVd6Tvwd9KBPNz1eBdP/s57mw5qGeQpWvGf+6e72+IdzJkc1q6143uQx3frEUc0KaBizHHzsJh1Cfn9Id8xT3r+U7ECgSXXaSWAz1D/98SZ76olL5BXa77pfDfa5Ue4WoPO7IUE7b3qIyPc+p5au2bGPCzkNVMft/z6O7UD8rjfGDOfdMCr7azHCXloK+QpHmfD7VBIBVgKrGjhF6t+dMpLAsfG85ktXPXlXdeREQT7HpCPyvOJD6aWvFqtDnl80AY98wnWnhXfA7Rrbb9d21Roj0deAsiRVwhyDKWDtYxe+tRTd/5WTBmN5wPrP37jeWLEQRE68sW2e285wHPCB2UgDN9Dv6AvX/OqyI/4zYoD4a9eAC4d8BAqIigvUNZtgfxkzY/x8iNcpcEhTyED0LJHZltA3oGZqMJXhsTo8jjUXCeJg6vZrwN5BT1n91JQHhb0m+TW4S7RmhcxXogjYc+4V6selslw39eg+SDtVS+u+oC8Pn8FvEFeXfUQ8pPPdscKZQZ5pD0s95nZzsF8nPJrIQ7oRIh7iJ7/t74nAA1Y4yM3qARwTL93GNwlHkOxN39MKHTyloMnP3BD6OvvvCE+iwv4M49rHnbhmWLJD0D12uVbyI92+RGu0jD1Jp6+QKdWvEIeNWlCvgFjAlEHakA1gXq2bl8113CAb1UH9Ap5WCgYM+zWPAoCt/J62mTFU/uC3oFvVr3GtwE93PfPPvXtw33fd9V7Ja6x4v3Zb4S8j5HvQZ5WvA+bW7PiXQ7po8rPjzigfIAhwLjxurr0Yw4jnt8rAe4JgDAEEJUpBzwhj+f65KlPPx9NWjKMTkGvkC8V4/F9+RGuvqCQV0ueBR1+o82Ns3NtBTxUAdwBuq7v7aMA78mvy/19XaoO5Al63LO24RHytJCrNe+gPqoykOwSIcNzGOixVNDP7vvR+5696mnFr0H+D06JJe/P3p4/lEFe3cm6zCCPPjFqyRN6Ds+eHNTHIT2vwpxLhXn23wG+jxT2XDr4Y1jfPbelFj0hj+YDvI9qvZchjvyP/IF0QGMHU3+/2PPJCFdhUMhX93wp5Pgf7Wv45OS+ljy0BvF9IL84X3KtQyuBvBYKtQPePW0HPLr1tlrzPa221ztMtigBzU7QR+/hF2c7vbrqFfAZ5PFsG8gr3B301h6P8wIgPnxOAa+Qp1vZ3dyEncN8TQ7piyG/5poY/y334ZDPYF/BLiMQ0HSglSh91sjPPozOIe/WPDxfL9Y8MsJVHNYgDwDgP6xYQh6Fz1bAQw7sngj5Huz9vMcqs+YJey0UYM2j3Q8ue3yIgwVAA3kH9EZ1Aa8iUBzomRLIu1UPhauynTznRTPMLkaVzKrT2NJ6U8CzErbJVd+BfFQKn/hsfLJ5rT2e6wkiWP3qqifYHIS75DB2QB9VPGd2bo/LUeSg70Eeng80c+BZesW9ekjefWMKeXbEYx4n6MekOCNclWEX5AE1hfw+VjzksM7Eczb/7Rx+3mPVDshDuH+s61nyRwH9JshTDpieFPSUWfVaiFXQw1p5ARRkLcS/+Ifiwz2owDz9tW997IP3/7gKblikfwW8W/Gw3je56q2CpZAPoNz6nuiJnlmXGeQ5AQ5htsWS7wG2B+HLpV68fb3KAa8WPT0e0Unv9l+vTR6EPPM0ny2+mIfyDc+XeRhyS56am7au7rwxwossZJAn6Pkfw1X4Bbp9IO8wz+SAV8hfdLhDCeAzyNeP1tz+6w3oCcujQH5v0ZrMrEqHjh+bgJ6F2ey+P3fr1CHvyi3MUognID9zy2feDt114+/cC33o5z/8ey5UbvhOMysez61a8wXymBZ15/NOIH/2A/9qFfILa/P296VD5xx+mRyqClFfdzmVxcfvReWAr+75Anm14pmXNT+zKYQTXSnk9TfyBd4bIT95u0a7/AhXWQjIy9ChywH5bJ2f66KpA/is9g+XPQoP/zJdA/mLAPpum30GebcqFT5cGuhVhP3lmg53F7zdEneIO8zf+7p/f/Cu1/xK6N+88n3N8oZXvuvgnf/7exfTFjvkGxnkqwt/B+TjfE8/fuFrt9y4gHxmxXPoHIahuat+C+Qdmler/L4U8vpcFPToWc+8m+XnKHPwHY7v+7EF5APu5VPSbs2Hy35MijPC1RYc8tRRIe/g7mkV8huuc2QlkNeCQa0tdoRCAR7t2aUQqIXBRYC8QybWK7T3Fc9t7fRqucwWPSfOOR7QL+At4M6s710AV5C7AHEFvMKdev0//oWDz516KAp63vsWyAPw+0Ieiu+t25faCHRNZ7Ti73rt6xZD57h08GVyYF6N4n2sQZ5j6NeseMKd6/GM+clZQh5t8YQ8/yvkUR5Gc9ZTX/kmT9sjjHDFBof8miXfgNBhmcjh7SD3da6t16nad382CXQA76Bn4fvEjf+sWn8K+2rNJ7A+Di1gDzlgHOqZ/NwGe0IJhd9het43MN/hPt8X3q7feMOHF+sU9Ap4iv8B+f/4hTPVgt9lyQPs8ewPackjL8FF7J9j7UEe7fHH7aq/WtWDPJbqpsd8FgR5lpcpPvPoJ6Eu+gJ4zw8V8s+dvedKb8oaYYQmRGEcc9fPlvylgPwWbb3OoWVw74FeC2DMF4B1bMOlm/diu+whtyrrNof4Vtn5vWDDvaEArG2R0fM+rPClS12s8R7ICW8Fs0Ma/7lOl75uTQp3BzwEN/3P//D7Dt7yz6+fPuRTKmk9wPPZZ++AkF+8k/I8ec5oBjnz0AWkHc45oZDX/+z/gU56ANhRIL8GfN/3SpXfm1vyFJ43Z99jHva87JDHFzYjD0tFV0Hv1vzk3Roz341wlYXsAzXHAXnK4b2P/Fyr8vj5796+K4B3yPc64F1WyFMO8a3i8YkLn/cG0F/44hf+z+iJ/vy5azKY72OBr2kLyF0OdnXPE+wU/gPy73jTLx6c+4MnawGu7xEFPdrDIX/utOhdXnGK9IDx8WXOeky+Eha6fHPdrXiuw34AmkJsH8gT3hnEfT/d/0qUxpHPwCEPK/7sr7x5er7mnctgz4oVyjhUZB3yDegF8lHhHV+kG+FqCz3IE2LIFMcB+d7vNfm5VpUAe6Ed+zngHfIoGOBuRXupQp4W4HGC3kG+gEpyzALgPWUd9jqQx32i7RrA7LnUsc3Be7HEaznUA+ivvmlhvRPsXBLyP/wD10WbfDS5cGx0gXKoPA8+bwI/g3999nwP5TnWcz39+AW4kpF2CPke6PEf6c4tVQWcA3qXHJaZHK5Xihi/HuDh7cCX/TDJUNNvaCVvsy8E3jfef7j6zU2vIujrfBJ7NF+NMMJlD9PXt87dio5BhDyBjwyE2vG+He962gfyfmym2C/J0IeVA94hr4VygBfPSqa4rYAXyK9CeUV+3LFC3kFPQBnow8o5+9DBJ9//0UsK8kwOdIe7u+VdAPvPv+L6Kljy8T3xYrX/xzs/cfDYpz5chf8TzO8KZeCH1LKv7wH7FcBHxeHpxy985V1v7EJeQY/f8J4dJ+T3kUP2copxUrhzqRPfcKrgtfLAIY938ZV77oj56xXytOTxDmnRN+3yo4f9CFdbIOTVksdvfKQGGYqQbzJNAtyt2gJ5XENBr+D342OfJFNvlUN9DfAQO0bhU5rsmV0Lgo4V34XyDjnkuVw9n8M8k1vyerxAPtorT5+66IBX65zLLQq4rwBewY79Pvy+D4b1/tyZR6aPMMF6R6FOt/pDdwW0AXhKoU/wQ9iPMHCLvz5LnPf0qabTXc+CV8gjTTvkFfQO5q3SY/nbz+egvVzyeCvo/+CBD8Rv9qZHflyz4j2vY198JCjeZ4E8oe5LteSnHvZj5rsRrrIQ03oenL+ZljwKP36RDpYcQHqckKcc7Bnkm3V6fIkH990lZOxs3S55AUyxA150qDp7f+Paq6BPhmAtgNyRAz2D/RbFvg54Bb0CH79xnFjzSAMAI4Cp8HVIH1YO7S3aCna453GNhz7+yQu/d/+DAXYAFwKIacHTcuNvfX9The3EZMk/fCLA3rP6uY97dQAIpBGkW0De05ILkIfrGR+m0Xnr1ZJ1eGfqVQiydSoC1qF7qeVxpmjBx9C5j9xUAZ/l8V5+pyWP+et7kFfF+6yQH53vRrjKgkOeoOfvKwXyus3FDO6QPoq88PWCGJOaxBfCbBjODIcc0q61bUfVTsirJW8WPWD16B13XCAsFbQO6zXpMQ7sw6gH+eg1Xyz2E7fcGjCvYC/vJKxszmQnhbkW8Hxfy3Z3fG2wvN/yG2DPoI917KvB9AEYubveXfdMW7EsQ+gOY83rPgpI3QfWMMeX63oC1qF7qeX3AmGiGz4HpFHkUzyvw0A+ZhQs89cT8uquV8DD0xMdMyvkj2/+iBFGuOghvqX9/Ll3APK04ikUTsgUVwLkPdNmmXeXUHj6f13nMO8JBQsKbLQFooZPyMM9W0G/1o5Oq/kiQx6q194D8lHonT4VYAZAHbSXUgR6/V3+Nx3pXnF9bEelJMAOq0t6yKcWuojQV8j7O/P13DYty/kfvDMmzFHo44NGsBjhHmbfFnb80qFzFODz7/7UXzm46af+3pEh74DHEmDHZ1gf+MivHnzshn9xcMf739nAXWF/uZTdByz4xk3/mtc2cw4g/3rZ4NJ8nkGelT1XbY4b09uOcDWGAvm39CCPDHE5IA/14O7w3hfSRxWHQulwOlryjbt2gzW/tu04VM8v47n5XysbjC+giPjDGg7LWACry0uhrLd845ovcEdckX4BeMK9Qrx0mHOLXZcOb30n9d3IXPb6XOskOQ9OrnyAPqBf2vgBUwD7bd/0l0Jv/avfE/qX3/3joVd//0+G+P/ffv9PHvzb7/rBOMYB76Bfk+/HiXXe/4brDn7yL/7MwQ/86e8++M4/8ecD9ICnVxRcDuKLKb0u4gwLHnHEPeE+MD0w+wohPzL/98oLLzeYhz/9+rctIA9pM05V28N+dL4b4eoJE+TPX4dOZAp4TvmIDIHM1NSUE2hvVWTEDZDn9Rzk+0LdrSVaUr7fFtG1SsjDZc8PXTQd8NCrGhC5BBB3ZddyePX2wTJAdfpUM648tAL5bN1RVN3xtNzNRc+4odc/wB5wL8+8GQbH9yBWmhbmvs2fUe956Tr+JuxnN//UIx9xw0Q48DKgf8O/vP6XDv7hP/rnB3/7u/7Jwf/4//7p0Pe/9Bervve73hoQBvi/9ju/XK1Xb5/vybefe+w/BBh/413vOfiJv/aygDvOT8HbgGMcrmtyKB+3CHcKkOe9PXvylpoXNR835VNHWnYgD2MorLbJO+TxHh3yk8t+TG87wlUUYmrbHuRvazu21IyUwHtfOdgzyPO6XCIzE9K75G2eCmhC2qHNgoPHZ4DXc8AFiyWsN3bA845XGSQupjIA6TYs6cYmlGI7oYchcx/8zWrFuxzIDZiL+N/36Wlhscu5tKJBuP/Kv/6lA3Smi3R6+tQU7zJcrYrrknZ3h72/qzXpc4zf/Axt88wx7G4GBCrLgANgH3E++1C48QH9v/cjb6qw/1/+8ptCgP1f/Us/c/Cv/8Hrw71O0Pcsev+vcIcnARUGhzsrEmhawP5qOTvUXQSxLo9LGg8I965WPJrIWCZp/twFeTcQkI/h8o9RRQJ5Bby+Q+9hP6a3HeGqCQH5C+evdchjNrCvfvyXa7tXk4kSaO8rB7sCnnJwQ/AqoHc7BMgifpD/RkHAzI9xx8zcsLwhrEMv5riv7/ux2Jfw9koAt2X7wJrncDoU5uxwVUGSgPhiqAGPg0kKMMK9wq1A8clTn34ePdHh+v65v/9TtYe6ji1XEbgQAb2Ad2aNC/wzqPN/wN2sd/QRINx9+JvCnYAn0HvaCvZd4jMPaz6gP/W0n97/fD11A7PHNu7l7t/59MFrrnl7gF1hj//hTv/CJ1PQZ/8Dil/4ZFjoqCRkcFfIe+XAIeuAd7g75P3/PvJrq3BPyLfIb14BZz7fB/Q4B/J9ddcj75T0oPmkpheZ4jbmsB897Ee4WsJkyZ+7Bm1NbsnDTQZgHhfkK8j3gDwyI4CuVjTWA9KoiQOw6ECDzk1fed+74/eTn7gpXHywguDmRCamyw+/wzoqbZT4HZ2R7r0l2tdxPpwXcXTgK+ApDosKt2yZAa/pgGdtufvKYZJJQVP3lWsr2FloYSIYuJABdVjuWEIAPdYDphSsZSwxeQi2w00Oa5piZUDBv9PyF3gr1PVYtd4Rt+qaN7jTmlfIK8j9v0qf2WHUPHcAHp+jjfcy9cCPa0pTgnsbHPZw58NlT+seQjs60iqsc4cy/0e79Rc+GZY55uWHa96h7qKnwKGuS1/nOg64q/R6uCf8jjn83/wzFfDHAXnkXeRxeFcU8ngnhPwC9BgOeeah0sMen2IekB/hKggT5J97OSCvne9gyT9z283Hask70DNphkTNHdA987NvPPj6O28IkKNnMAvGmJL0semLaVBYPF/4ZBQK2obpYuHoYoWAAvS/+MZrV0FPax4VDP1sKYfjTNbcEtoOage27+/rXb4ff9N6BGhorcOFC5AD9IACh5vpWHJO88r7wW/2MCaU6P3BcagE4Jxo+wX4YXW75Y8x7F4J6IkVB7i0GTc+U4K9trurNb8D8lwX1vYxQT5//mWmPL++QD6ec/nNph48T3wdDxWvV7/x+rDm//T/PFnjeK6w0NWFTyAivaKnPOCOYxzoLlj48BKg4qCVhkwKdeSTp+//7ermd0gfRbyGXhvXe/K2/yPyGCv7yHcOeQW9llX8zfXcD+dB+RLz1z/80ek9miXvkMf7AeTHHPYjXFVhgvyzL0Xt1N31sIgB+cN2vKPVvi/g2d4GuAMkAdwyzWpIIO4F0mHVg39Y/Df+s2pFOORpzcdwuvIJ2uhwpaBfgbf/b0HR/tbjXe0x0ib82H1htQPuEH4T5ApIdSXrb1WFbPJJToW/gh+CFQ74w4JnBYBWe60IlAoAAf9Lb/vVmJ0uKhMCbwVj/FcrWSA+W+oTaHvy537cqpPpSNMI41wrJqxQlfZ7PE/cNyrdtO5h0QP2gDMse0Ax2t1LezWe6xa4U6gM4BysLGgeoAjdp+/9lahYYB0qEnhfOAfiAWtbIe3g3lcKeVrxmNUOHsU1wGegXxPd9TEEdgXyTV5oetiPYXQjXEWBkFdLPoD18KciMxwV8g7zNRHyrGmj0HPwhjVx7y0huuEPKy1U/BoKesSFlrtDHgUQKgHP3P+p6WMkKx3wjiqHe1MZKO3u8fv0qWq5QyikwlJPrN0qgadanASTQkrl8OeS/RMU/irEB00A3jzAGerCcmIhm8SniW9HeCb+/7jfiXa+a36HJove49Wo88yR9lFpRL5EhQcVn+/9mz8XwAdk/69/9HNhUQPwa23vmQB5T/OaL/A/ZpV78GPReQ9ARxu+ngPufuRBwvm4IK95EtdH2aNTAq/JYa7S/XguPOdem/zCmtfPzo4P1YxwNQX0FOU35dWS50xdnMSjgn4F6PtC3QGv1jzOhcxFq31tGJG7+Xydb2dh4oUK5JCHUAggPplFT5c9ZilTl30D+sRaP4zUanfQKxAbuJd59RdwccD4OgVPAiFWGOjOh9S6xzZdQoij7sNnxKWKHpzF9ctvtYh7lRfet8L9okDe5ftU5W78ep+mAD1gU3rmw5UP2GMIHi17APdV3/u/LUC+JnSuzFz1bKpCswAqD+yZn1UiYNUjbziojyrNlzg/56f3PJdBnzDPAK+gZx7Gs8czXoM88xXTabTLY6z8GEY3wtUSps/NPvWgzl0P60E/NeuQJ9QXoE7W7SO2n9Fl/9Vb31Ot+QzyDuujyAs8hXy49E58MOKUWfSwNNBbHwWAu+yPA/I4HoVNBXuZyKbZVsAAy4tt7VPB1bqsHYR7yYDbWNTscCiw5++6LG7rBriMvxSyuAbPUa+pcXB5PIvW7tef8ZG0CnbdXiBf3PhTPDqWvt1bAP/MQxeQNwH7973n1+OTuX/2z/+tFMJr0p717IuCJcCNCgDH1PfOi31gxSPfKJgd2IeR50tcB3kPc9Xja37wqmk+zGDvyix5VMzh7Yr+PFKBdsCnkB9j5Ue4mgK/Kb9w15+9P8CrkIcqkI9oubu0gwx+IyNGp7uz9zfAVRB7gXBU9UBPKwed8QBztyygXge84wQ9p58l8FkoAehwfQPwAbeYcQ3bOwA5qhT22jau1nOBOZ9B8yz4zXWBfQDd2vub68k1t7jrHfA1XmXpz/dYtNOSh1rQz7+lJ7fKQQ/wYBKXr37uwn8680i027/+H/9CwB5yIGeCqx3nANiRZvA/myynJzSx0Ipn3nFYH1Y8l56XeVMr+md/5c2RFx3oW4ROfMizhDwrmQ73PuTH1+hGuIqCfm5WIY9CJLXkbW754wK9uuvpssdQOWSuzIo/DshrYaLqwT46Rn3kpgB6Bnl0wMNz4+Q4jQV7SMgvLHZz0QPwsNxRWNN1Pe0/Q5Swd/BdLCm895WfC6rAdwu+A/us0qG/eS1/1kdWD/K99akm8K9V0JAO0YmS1j3yLNrtMXxO3fg9wRJHZ8jeRDlrQjMQ0l0GYgf2YeR5MROBjxE3AP0Waz6DPJ8lKs949g73DPKowMcwujEhzghXS+CX6AAnWvO05JEhdkH+OKXWPDvgwXrWDnjHAXgWJmuFSgZ5gv7xG6/rgl7ns28gfwioLAAvnesCVqdPBdwJeG3z5fUUag6LiyGH9qpKWyjjiiWfFwvXNbFSU9dpW33nnj0OXOfP/tjk7fWZ/JgyQoJLvwcV0iOWeG4Ke06u0+t1vy/cYenHF/4evmORVzRfHbc0P/r1AHrmRf3Kn0Md0vWAPPanJU8PGZ61A15Bz46k45OzI1xVQT83S8jz07No/3J3/cUEvZ6fkP/yTW9b9LLPMnxPLCi0wNDfa+pZ9ChQYbV7Rzxa8zqcTtugl4X5bqkHQGEPoAHu6CQ1u+dbC95hdrHl19yliC9+l3vkefA7K2S3Su9Zf8/nn8fJa1wOrQzY/tvEr9al8vOHZste7ye8HKViE8B/bPrELVz5mGfgb/3gNQff/je/bwHtfUTA4xrIO72KtgP6KPJze57k7ygP3vwz4fVjXkSZpcDnb/7//J/96wF5PDeFvKc5VTxnznpXJ8QZw+hGuAqCfomOkEchAVChowtqvZfTkkdFA+3hbslnhUxPa4XGLjnksWRnJcRTLXr8xqdCn73nk9Hm6e3SKKwPAxS1MnAeWCDRu/meO57HNerX0ByeK6C7GGL7Misa2X00srhCXriGdV7G9uuEPZwkh+uwH936ep72+iVuVhHiMVmcN2kN0r6tAH5SmQp3sW36SuDiOtLsovGO51/uP+6ZkzoV2LOTXs+qXxNc+miDx3mZHzRv8DfzmMP6OKTX8HVQ9Jd58GMHT/7Oe+sEVpDCXfXYN/+FAD2aOg5vyY/vyo9wlQR+iQ6TPHAWM8Aev2FFK+Rrp7gE0EeVtscr6LFED9usXd6BnCkrGLyQ2KUe6PFVLO+IB9DXr9PRirce5cvCe13Vgn/0ZIAdgA8glIlsdF+HQAOCSyBtU/b7cPG++J+/UYnRyXQwle5vvOHD9YM2mDAHk+pgOBm2QWgr5jS8HGfvQ/MU/PE8F4Bfxls9KavaAPkZ7jPkM9B3z9Wo9ApPKit8F7hHQAx5GrDHc8JHcRzka8IzR5pTD1oGd/1/qcU4sfKNibz4MRvAnJY9wQ/Io1zDM4lx8gZ5/Ne0AuF5Mk2NWe9GuKoCP1KjU9vSkse3mzPIZ6A/jt72GeSRKZ/8wA0La95B3FNWIHC5VQ55xiEsCOuIh9/Qsw/cEdNmVsjv4bZPXfSPngzXfO1gJ+3zzbEFVrq8VJDvgTIT75Hxgzci7vP0qYN3vOkXD677qXce/MMf+8WDV3z/vz647rt/KYSZ8VRY98ofenuME6dwHCoCsF4V/rDawuo/+1CFPwvy+qzKt+D5jpbvavd9rWkJ+daa3xf48eykXwPfAd8HPRu4RyxZgcdzwbNCu/wW6x7uerwTdPBE2l/LP57fLpZ4LeZPLN3TBiMF5Qhc8zotLiCP34B8WPIyJDWea4E8//P5NZAfs96NcLUEfqRGZ72jJY8hYcgMDvkGzPbxGZWuc6BnyiCPzAkX3GHb5bVQOKoc9gQ9ChN2/oHwG5N4cAY8Qp6dyrywzsRCB/DzHvQo8Gc4Ld30Cl0H8ZGlvdmtVztBOS2X97Qm3A8gDJhgsheHuULe/2f7Kvx/+ofeNn0+99U3hUcAkIumjmL1x8dHxC2r4rojAb4Aegn4lXb5THa+OGd9zv7MZTpduRda9oQ93PhrY+IpbIfrHmkQEO3lKYfxxRSv53mT+TOs9JO31Al1OE33V/7MX46ypX5qVix5CPPzqzVf00MZGjtBHrPeDciPcBUEnb/eIY+2ZWSGNchncM8gvwX0mcueHf/Ukj8q5P3/VnkhwngA3trLF0u48QG8pgNesRJRYPRgr4VNgO/x+2YLHu3Rpa12aW22Pet71t2qDNr7aIrHNle9WvEoUPEbS4AXncVghcMdz6/WAcwQQA1ov/YnbozfgPf/52+9Jax9WvwOfQU/pFY/zoFr1Xny8c1w+RJZ3Jd4YPDf72WnBNIO+L0hr6C3c6vq89Wx+CuwxzPncLpdlj2segy/w3k0LzE/OogvtTLY414xsRY63SF/wpL/8jWvmuauL5Z8fZ4lLTINsL8L7hf5vLbLj6ltR7haQkC+TG1LuNNdj0IfGUMh7y57B/th5KDXawHymB8+G0rnEO6JBYD+9332kRciEDr+sMc9Qc9vzVdYiBXcwlmXswB1AD560J8+tehgl1nzDt+jiKBT6DWWTbkXhfsMlgR4icLdXFzOOJd2sAvwSic7bXPHEv/5+Vt4AFgJqK77DvQV/NwXVn4MESvnpzs/4rSA/Pb7a+B7VMCb6jfseyqgbyp8Nq+Awh4VHvTE32LV43kDhsxLurzc0jzK/BkW+4O3xwRbyJsoZ+IrdJzxruQjPFPcV2bNNz3sMbXtgPwIV0MA5Dm1LS15tsuvDaPbZcXvkh7rkHeXPSCPr8G5y97h68oyv/4+rBzyXLIjHq0FuAhjliyZHIfQ4FILGIUH9q1j4E+fKgV2207sgFdVEIvUmmvWlxEAbHPkhzj4cRlAj+mCvwldHI9CMOIeVuR2yEclRTrf1f4HK8OZtBPdIs5l5j9A/53/+3ujgx6sfbXkHfRcunWPe8N9pm330jyySQW6h4F8QKfIt+1SvVaMKLCKIGEvaQL3C6/Gz7/uzTutemxHB1Ck/Sx/XQlSyEd58dlpiCGa19AUqZDH/fN90ZLnf3pGNL3F1LYD8iNcLYGz3tGSJ+TxH9bpxYD8GuAd8miXxzhY73y3y5r3TJ9t93VbpYCnYgTA+94dlgIgjyX+41mGW9Bc9g7aWqiUSW7UgtdC2mHu65rC3ESrJOIBqxWFlnwRDtYse7SzVzsE9zmsN0yBCmHCFXzEJObJx7nqTHy06BPYmdRtH4VruU/dptt1H27XCkB0hERlipWU06di+Fdm6Sv0tRJA4GNfuKX5VTy8Pz479VxM8fJKjf1vwIse9dsgr4A/DOSpej1rzmE6UNhzfnykgR/9yWu7Vj3c9kijmo88v11uMZ867OO+T58Ko4Ewb9IYLHk+c6lcLyA/5q8f4WoJOiEOXXeEPCz5tbHyDu19lUFeAQ+hkgGrOD5ScYyQP4oU7ioUCujoQ9DjPhzyCmbCt8KxAJ4fmamFzMMFcNWKXLa/ewGu16HlG73LzzxyAfADxBx+KMAVhFqwB/je8OEAJ13nUxzXgNcX70n/K/j5P13H33rf4gEg8PWeCX1Y6hnwXYQ92qzRExvnIRT4bPke/N4aJcDdAnnosIDH6I7FOrHsGe9aARTQI63CysU9oyKHd69WPcCPtMMOeFeymFdZbiDOUFj1Ne+16ZGqFYCH2zb5CfLnbh2QH+GqCQH558+9w931sOoxfK1nyTuwD6MM8oS7Ci7wbGIch68qy/DHKQc8CxMUDOjLQGv+qTt/K54nLSd1m+P3VJDM09QS8GrZxr4ONYGbFtq6JPDYho3CGZZ4dU+L2zpzYbOt2l32vIelVXtxVYEvFYAG/CIeQwucwOc94OMuqOTApb8F9nwOdOET8u29d56DwdYBfMm0eHYT5DQ9AvbRWa3AnlPlEvB4Frh/hajmMc93l1OeTwF4Vnh5z4R5PBv0tLchdNSA/AhXbdBZ71iQxxhvDAG7/debYXTqUj8q6BXwhLzDXa356IB32zwe9nJDHnLAsyBBPDlmPiontOYBIFrzhH1xnauLnoWxWsgZyKCAV/ldC2t2zDv7UMAd7awV7K+4ftERTcGOJdzzdFVDiCOtZKha4AGONo5eOB5FdTSBLKsy4JdKjy61QCfso8AuFRfcJ6x1PJeXf/ebusDHejwXfOoV76haelap2AL6iy1a8liqVc/nNlv1fFYT7LHU5xQVJAwdO/NIwB7PCP0dkJaR/pmvdHmlyPMoLXl6eVj503cUeSaBPNNRA/mnv/atXpaOMMIVGTghDnvWE/LR+a5M30pr/rggnwG+B3lUMnB9WPMxZh7utgS4a9JMf5zKIA/huaF3PUHftebx7fkzj1ygBY8CpAGXdc5zwC/gXgppAh4FM4ZH0Wp3y13h7u3QOn48zifXYxybuBYt4HYUAU62Lpvytc4el8RHn2X2zNhxD/f8yQ/+ZjwHNltkoMd2uP2RT/hceK7VZosExhdDdO/33PxaUYp1zTObRxAwjdb3f/pUNFvA+0F3PdI685ZD9koQ86m66rUpp+YV6ePBZa3EmbseywH5Ea6qMI2Vf+7lmOQBcKeiEDt7fwN5b5d3eG/VPoCnMEUl3ODPntjWu/5SyCGvwrA6zoL33r/7ysaazwBfLXgFqVqmHanlVY87+1AML8M0pjGuHECHBU8p8F9xfXSyY7tzdUeX66qnoMK+A3iu36wCmcW6FTBl0rjE78zSr891ORMg7ovWPQTXPHrnf+/f/LkG9nhm9IjgmcH7hWl4cTwhz2s0ng29T4PxcUshr+L2BvDNs0XnPFYop0oKnw+fUVSKSpr92A3/IjxPVxros/ypkCfgCXmmESy1UtuD/LDkR7gqAyfEIeBR2NOa92F0R4a8eAPW4O6QRxwAzBgCUyCPDOzgvZRyK16XsBj+7Xf9YHy05m3f9JcOTr39TbXzVoCzuOjRsx0FRwUotQPuCin22kehhMoZ3M+Na94BXzqeoWMV4a4FuV8HcangV5gaSFMLtsrbrwuYFvvZ9hUp5FeFfQ32+gy5rPd/+lQAHO32aOqAZa8eEFr1eM7h+aJFWM7TWvR3NR0M/R6OS97Zrgf5bJ/4H5WjAvqyhDQ96PNhHw+AFd+XUMg6eC+FenkTcasVbwF8UylOvqOgkMd+w5If4aoOnBAngzxc5BnkQ2aZr8FcrXaIHfnYk16//exwR3s83PXYfvYD/+qyWPJaoeBvBzt/n3vsP0TBc+2f+c6Df/ndPx7Cb7jt0SwCi56AVwu+WoAO2Y4IeUIGwEHv8eqe78Ad4ILLubHcBXi18KttzaVPwALq/n8N8okKXOpS1yvAEut9iyJuVgmI+xPgY50+Rz5LCFYrYA+vCCx7WvWEPdvpUVFiv4XpnNrrfn6nvLcedI9TDnkq2ulPTf0qdIljpuc2dQzU56PPDkuFPcbL+5j5yyHNmyrmSzQ/ffGWd8W+0UTDfCRpmWB3yONeB+RHuKrDNCHOuVsxTtYhj4losmF0Pcg3SwN9D/AugB3XBNjh8sb5YMFvcdVrhnf1CoaevMDQdfhNqDvkURjc9FN/r2nbxW/0bIcFFB3s0JOXvesTgO9SAKlY8AQ8OkVp+7tCXq1PbXNXsEOL+JgLvgLyKJAHiLikdJvJ4X0YLa5jqs/ULPtoYikz8MGNz4qSuu8xCiFc/cUjw/Po85ie7fT/UkI+W0+4V/AXyFP6vPxda4UFbfh03wP0qMSi6cnz2cWW5lfPt+Giv/9TMbQVXrWoaJfKLaRpgHBXyPPdDciPcFUHToijljyAD8hjfDrd5wS0Wue71AO8u+chWOz8ohv2gRcBljvb05iJNUO7sgLACwO48HC876v76HUyuQXP/3DTo9DDhCFsv1XQv/8N11VLggXIvgoQSccoAAgdon707/yrFPAUrHe8X7ZHKtCWsG+BrXB30Nf/4uatAiyydSrfbvs4sPeRX6uuq9ea7lPvWZ8JPR1RyJ95JMaPw02toGffBnZaJOjn87bX6QH4uKXXcItele2L56TLiDveN/Yp9zKBcKoEoeKKdnqk/V7euhhay6sc6QIjAU198ARG5bbMQknI474c8Ap6poPRJj/CVRs4IQ473wHyECAPIHIOewe2A93hrkuFOl3zdM9jCaij/f8r73pjHSqHTOqW+1a4r4mF0bP3furg6Xtui05ybLvTQsKvkRUkCngsURj83N//qWrFc4nhWejprhafwztVcZtmQgGUWvACeqxn27tamtm5uNylpXXX/q/wj6FaMuFNnX1NYJScv9le5PBWgHN8M+Xr+dvPubimqAKsTB7DChUqV3iHADoqVoS9gj4sxQc/Vs41AZHQx/8MrpcC+ioHvcfJ41P/W4WPMIx+IeK+h0W/b748rLJ8iXz9xXffWD9MAwH2CniIeczhTmllb0B+hKs2cKy8Qx6/kagxrSwBTUteAZ5Jt9F6xzqAHB+K+Po7b4hZ7OCCf/ITNx089el2GBoLCIerQ3dfyOMcKIQAXFjbcKHDugYIWUCxx3tYAiisv/DJWuHwwoRwZ89dnEtnjiPocS1Y0qg4bQY8JaBnwYRzAPC/9LZfPfj7P3hDCngIw8IAJVqkPA9BH4V2AnctyNfU7MuOWwR+cff6uXfKgNSDe2wzwLt0vxRavo7jpeWZ8HkR1FH4F6ihvR7PGV/Eg/C+o79DHUu/nF2N6sbB1h2XMpDvkp+Dx2Kp6TKGpz10R6Q1WPXIR9r7/mLI4Y7rIR5wyaOcgUcQ3kE0/eE3pulG/qPbnXmJ7zQTtinksRyQH+GqCxPkz1/nkCfokWHosldgr0FeAY/2MEAcGRHQpPudVrCD2gGegd8z/BbxuCgIHjkRbld+T9sFKKMiAKscFQFa/yxICH4usQ370k2voMc6wADPE/suIL5RBDMB33SyE2EdrMw6/az1Iu9Z8mtyuLt0P10GGJLzbVYC+YUI9dKpzCHvwF8Vv0ZGyEklSD/fSgjg+cYY+/d/NCpVnP6VM+SpNageAd5fBtQeXI8ivQ6ehV5Tt+k+fg4qnnl5v/HFNvwv6ZLPBGmPFWbtfX9c8rIBlXJc+/c/9KH6RUjAXSGPES7RBCnA5rt1uPcgPyz5Ea7KMI2VP3cNII+2eAIerq1dne8c6m7Jw12GD7XgXO7adpA73DOYH6dlAOACvoA5C+eesgoAhf+QHwPh850o6OrkKWL97CNaHlHwfPVzMZZ7YcEX9zw619ELE9fsQH4CDcdztz3oVUugl/ZlA/oE3TtnOJql7+ddVQaWnjqQ93O4ejBV+CEuAb3GOzF3qiMI6MIH7F9zzdvjvbOTI4GhsOd567LjJr8U2gX8Zn++Zzxjq+Qxrca9lmaNrPd9lq/3lZYbiCOsd0xAhfIGQCfg+RvQj2GsmMlTIK8eFgd8BvlhyY9wVYYJ8vNYebXkAZQnP/6ehSWvbvsM7lWYyOYNr198KtZd3w73HuSPouzctMJ7kKbU9b5VqBDEd8oPacGzcFFA41yYyY5twWq9s3NdeGASa13XOVS3QHgBey345QMfAdgCA27Hcss1GpXzL6DucshzffKhFpXDbJfqvdTnMQGbQMA+CnuAHh4VrKP7XitYrIDF+e//7Ronj2embL9FXMuz8/16Su83k7yf6VlrM81dtTKKe/Xe9/CEMS9m+dPXZeJ+WOKcaPpD2YR2d1ru2omXkMcQOrXkPS844DPID0t+hKsy1O/KP3f2Hu1hT8jDxc7Od+6uX0BdYA/hmGgLk4/LAHiZNe8AvhjSAkJBj8Jni0W/VQA82sNhwSvgWbD3pFBHZ6ZwKXIa3MfuCzcov5Pu7vlwzeOd4aM0YrX34K7Q1YI6hbEU7o31xq/JFQBM3y+f266bCoGfc6MWUO8JkC+/F2DqiHF3wLnqMXxWzf20LnxsI+yRpvDZVkysg3U4F5uL+Jzi/IlF71rbtks8dpeHw49xNc8b75a/JX1pumPFNJsl77BivkX5gc51nBETMPd5NhTycOkT8vNHlub36HBnRSUqKwXwFfLjAzUjXG1Bh9GpJQ83O9T7tvwuyOM3Kghfu+XGCnptj+9Z8Z6xj0ssYPxabNc7DtDzc5wV8GVCDcLWC0Fdz3bCul4Aj4+jqAWPJYAPq5Gd6/RcXoGgmzhTnQRFesTX3vAGOLfi6zlKRzR4LwIS3HYYK16VAWZFDqZMDsF9Va/D+DVT2s6d8zCZDt4PQI/OnbTqoz9H3N/8TnDeXvx66yMuDyzX07vB39m5dj0P34dqnncBPeIfv0vFtKmcFouew+ywZDu953X/n0khDxc9yiSUTQ54ChUAwJ5f1tO4Eeh8Z64a/wH5Ea72wGF0bsmzXf7xG69buOx7kOc6teb9U7G73PWesY9bei2CH0sUvhwCdxgB8CjMFfC03rl0uEMOaBaUhAWGwKGtVydh0SFbek6ei+ebCuB5TLBDtHG30uKDRQ54FDfyVJhPFQC14qtr/vSpgBk+S4q2aMzp7gDw625WBhdX+eIafzuYVA6zfcTja5zKc5n6NEzPmM8e7w7PAYBDBQ3eFlQiURFiWz2eb+/8uk7j7vegkFewq5r9y3+/l2x7vU9/3my2wfkTT1QsC0i5DoBERZqdWGOYm+VHz6e+3Svm6O+DcimDfHS2K/NvoByKkS1lCB3zo1ruEH876BeQH+76Ea62wGF0yAhuyYeL67abu5BX0Ot/hXzPmidks0x8McVr6PX5H3FDj/pd7fQqQBeAD7d5aYNnAUG4O+AdyrpdQQ1r8Lqfemed7AagxyxrACtnrovzi+W0AGVHFcJisbPzHArhKPTDBS/78FgW9KdPRU9/3DsAhopHBUPP/b+nIh4OGlcFvXkgjhHykJ5Dz6nPhj3p6/t/9GRU/NCf4h/+o38enp6w6h89OX2giM8oiZ+e37dRvHfu45a8/vbz9Z6NrqeYXqD6/tVjJF9YDMvZ0jo9GQA92ulRydG8l+V9Lxu4D8oP9KbvQZ5CW/3nX/Pa6UuQ+HSuTEalkM9+p5B/7uw9gDyaOb0cHWGEKzbwk7PoYa+QR6IG6JEpAHYfL++Qd9hjP7rs4fLnEDpa8j2XvWf045Zfzz0KyNgY874F9Ap4WvBaWNBq8AIPItjVEmJBiUISgAfQv/+lv9i0v2M9LX2tJLDwWqgBkFjldVlg8fAdMQ0oOjRN/0+Uwr18f1wsOJwHQMdkPFB4FR4+UWFSQSGViUMrsya1k11xnxPyDieXQ3KL/Hg9T10X8Z0mvCHguYQAOQjeHniMOKaeFv10n1P8m/Nm10ruS+NHOeyna7T35dfw86dwF8Az3cby6ccvfPn0Z8I1DqiGRQ+V33wGgDxgzz46mjf9t+dV/gbkd7nrAXl0zkO8EAe35HFPCnUX9m0t+acexPc+BuRHuKoCPzmLBKxWvC6z8fKZ2773H6CPGnXHbX8pIQ95waHCOlr0DnWVzkuPggvHoCJTCwixYrXQd8hXsVB85ESd7AaTrCjgcR3uEzONFQtqhvyy7X0BSNNUeJ+YrPd7bpMOdHc1++jwOcAJsKpj8uEBAKw4dro5dwLuPeTxzTQDad2Sd5ht1do5dF38Ls9qgsjUMY/vH88V7xaAR7oB7KLTJJ4/mkewv55fet779dak+6s1j214Xtl5uE73i23+PtSCl3Z43Bf6H/yX3/gt4bFAZbQC/rH7Ju9TmUgI6RieH3g1OPkU86UvXVyPyijKoKzTHWfURKc7uPW10x0hz/tR2HPJ33hvC8g/f+4aeD+9HB1hhCs66NfoFO6wKKM96503LCDvQO9Z89wH7WSYj97HzV8uyPO66lWgVYE4AmIOdrXgsURhhsINlRcFPCFPa4AFhoqFo7Zh4nlzspvv/a63NoDHeloiavUT7l1LvoHlbL1XK08AH4W7Al7G1GMZ+58+FW3vaINXwMf+pW0/QEALW67pcdolh3lPBNUWyFMKtV3yY7Pj6jmLNU9PiFbu6jaAvVSUoPgq4aMnK9QhVo78GlsV1+m0zfu+q9L3YVY8wBcW+uP3RcXl//mnv/3gv/1T3xmgxwgTlCdh2dOiFwH06LfAGfIA+h7k8VvzJ5aAPGCeQR6ChY8yB/s55PWeNM/qf+YthTzOc+GLX/g/R+e7Ea66sNbDPtrqT3xwMZTOQZ9Z8CoeizZ+HTt/qSHvBYhWNLBEYbA2fp6A53z0BDwtBMLdgaWAx74EfS34igWPHuqY7x6Af8X3/+vamQ/WUAyRE8tdlVnxtXB2MNLdrRa8uPzDmi+d8ibdNR1z+lTED4CHJRbQAuCxrQDArfkGxr342Pa1fdZVRgioJZrAL4OdrnetncOl+7SQnKx6PNspnUzt1HiOaB6KLxTCfV/Ow0pCPRfOkdxPT3EOgbv+xvZdz6mK78Pa4LWCivSJiijg/qf/5++u1jzc5F/67F2TBX/2odiPFj2tekinlNbx9J5XVYA35qTvQR7rUWahrGGzo6ZxhftWyCP+d934O/dillB0WPZydIQRrtgQPeyfP/cOb5dH5uAMagS1t8tnVnws7dvyWIdMd8t3fE8MowGwCNZLDfkM8GxPX7PgKbojK+BptcuyKRxLAemWvAIeBT7GVAPwaArArHYcjscCtVrvBnoCREHv4KtLATwK1YCyWDdsgyeYFPyw1vBNevSmx3/eO85X4WHt5ZdKcW0ZL891PSmQfb3Lt+/az9vWK6AJegENoQfQx8Qx8RniqfLESoG+2+m/Vh6W96Bxdbj7/aw+JwM8fjceqMfuO4Clfu4PngzvDuD+X3/Tt8fyv/+mbz0A4FGGIA3DsmefErXo6b7nxDmAvINeLXhswzp8ZAplDHrQO+AJeZRT1YovzQu8Jwd8BvnIl+ishziij9KZhy7gHgD6xz54/48Pt/0IV02IHval851a8+GOgwX51c9dwOx1OsXtKujle/OxjwCfX56DRe+gVxA7nI9bCntkagDPvyKXWfBhofC71AVytSC0r1ppQawWfEgB//h9MVSO09W+8ofeHoVmWPAcQy8T5CjgWwisQX4GTgW8WPATrH1iHDnf6VPRye69r/v34aYHhJr7l2s5RC6V/HoLaG1UD97Ztky+f/wulaY5TUzva6oUTpU8QA4VO1q4cWwFu77j5fuu8uuK2Asfzwbb/Vk1z0zOqVa8W/CA9r+8/pdilj+AHe76AP03fPMBKoSoAOCesO2/+K/+8OyZKoBX0MOr4R+4USOAlfIYb3/PbdFXqAd5rI/hu1/9XHjbNJ3jnhzwWb6NPIt3UZokEMcbXvmugw/9/Id/bwb96IQ3wlUQdHpb73xHyHNc6mbIr7jv0VYGix5fowMoCF1dXiyxwOB/ZGoULHTPZ4CH/upfWlrwLAC5VGtA17PAaCSQ51A59KT/hz/2i2Eph2tT2t8XVjyXZunVgjkK7xnaUagHvE9MhST+wzqrhbrMYY8Cv4J/akPmWPjoFf7g7RPg2aGrgCgDSwOZBMyH0zykb7ltll9/H2X34jDvyY/BUuNMuMcz1yaS8n12QJG97/l+Y7tW7tgXQ9Y3aUDiwL4KWuGr8UpGKszxnCt8DeAfm1zX8DwR3oD6f/nHXhKAZ7s8BPhj2//rW//aAdrssT8qibCKM9Cj8on7p0VP4KuQfxH/z/3T16eQR3s8etZjVjw0GSjkeV8Ods27zK+Rx0qFC2Uh4o05Kn7jDR8O0J+55TNvH0PqRrgqgk5vSxc9lipYAd4u34N8Ju6L43AOZEbAHp362OnGAXwxpOdHocYv0jnUVdgOqwQZnV+fWxSCYslrQcLfC8gXobBET3oAHhY8AR8VBcLcwd4U6lPBzspEjZe46ed4toCvoOGEOU1BOJ8XhRsATzc9h33FOW261DW41vHs5lbfrhlWBNFyn1l+/eOSQ93l+/nxofquZpd8PNMCFrZTV8jw/ZfRDwEhg35T4bPrKOQ1Hvy/eGaavsv5a7PR2YeiYkrAE95YEvQQ1gH0WI+2+j/75/9WAB9piV4q3h8rvQA9OiLi/gF8Wu5qxdOSB+QB8wzyKFuwT/QrOirkscQoIzRXveL68GZBFfSjI94IV0PgzHdRw9Zvy2PSlZWhdIeBPEGPWjg/IEH33MUEvZ4XoMIwJgC8Z73TgkehRAuebfcB4U4nOy0suA8KGBQcLCixLtoq3//R6EmvgK8Fq1rvOwBfYd5YbWXK2gJ4QCNmpJNhRFPloHyRrhbucu5HT9YJb6I3vQ7JkilZHRIOk2ldidehYC9wFxAt95vl19+pAscumIsc6i7f14+v74zeHlrlZtUDcoAd3hkAiHcWVq9okT7KsrHq63OaLXl9Rs1/S8cKePamhwseLvqw4P/YS6oId0BdwQ5VyP93fy6WWdt83E8BPe8dS3bI45IVVTQhcnY7FaazhUESZRmG79VK0Jwfe+J9N8+1QB7NCYT8u17zKwP0I1xdgTPfabs84U7rvueyd6BncM8gz+89f+lDNzRtbxcL8hRAjck40EOe3wL378pTaEOkBR+FrM17Tek6/q4g9THx0GP3xSxo6EGPznaZBV87DPWsNXPTE/YKfVqKYRUCquzdjXNxn+Ke5zlwTOzz6MnJRfm6N09f1avjueXeK7wniCyAJtJZ6SrsHc4c9pWCpwVXvW8/hwBsp9zy3SCCO4O7Q93/VzX3UJpK7P3SwuUniwFXdHSrPdYFkhWWAvwmbdR0sXxOVZ0Oo4R8XO+x+yIecMMH5P+7P1dd8wA71qsU8lBY+9/wzZH2WWlQlz3voQd6Ctb+Xa993fQp2QJ3Al9nukPves0/+tx7gI/7Z4WpPFc8f/STccg3rvvR436EKznot+Ud8jGhBT7wcP+nDuWyd8jjeGRItN1jKAynub0UgIdwDRYUEApR9u6lmxRufPyO8bEF8L0CwQuOprAoBWW0ZQrkMac52uH/l788A77pIETLzCWT1VQ4sPDmNLT1v1nwdfhWiV+18q1Qx7IMmeNYblrxPI6gIkxTS7uoAbtD3i36LuChHuTnSkZzbANVdWF7JWl/0Lsc9jtV08f0PkP67sWqRds3JppBx0dYwIAsrNQAWHF3sxc4j2vST6n0tcuSPgTwC4mLnp3tUCbg+mhjj3Z4gTzW/a0fvCbgzqUKkOdx/FKjW/H13suIEwW9Qh6ueHwnXiEP0XBAe3xMZ2vNGppusjxdK8DyHnDviCu8Wf/mle9rIE/QoyPeAP0IV3QIyMukOA56ddn3etmrCHeHPAGPqW6f+vT82Vm15B3Kxy1eD4UF/rO9j3Prs+kA0CXgvYBYEwsNFrBuxaOgRjs8mgJQQKAwa45Zk1nyE7CnyWsCGgSdAB7gQWFFwE/HzAU5oTPd4wRS/GYb5DQmvoyBJwDq9dahtgB7BnkFvFny/mxDAsr5fC3kPR4LmCeAD0Dr+Y9BXeiXe+F7ineo71ksWgAxgFpAClc5YR/9Z+iWZvu9gHJON6VC4ZBPxPevgOdIG5QBGAkS7e2EPPQN39y15LnEdsRfe9lH5VMqNVxSDnrCHmkRICfkOcsdIY9pb6PMsvyjMHfVd8IppxkfzHt/5pHIC4A7pZAn6MfQuhGu6KCT4jjktZc9MtEuyGdiOzyOwVh5nWnuUrTJbxUKlJimll+DExe9FgY9EaZaYFBRaL//owF4gB6FNQufCbKlMHa4F8BXILCznFv1LLwfPRn3obOpRZzEep+O53K2JiMuj54Mb0Z8eAfrC3ijwiAWO4FK2C5hxriVeGeQV9i7JS9ArIA2WLaVhwTyDvRMCl+/xhHUhTxUn78BXiAf/TYA+W/8lui1TrgCmIA9PEKAPfJofBimwB5Qbpp7aNkr0PnM8LvsxzQLZZBHeYA4VUu+VD56kIdFD9FVDzVD6ZAvFPDlv3fGA9gV9EjXgPy/+1NTxzu66jkJTpwHz4L3Jmle82m2xP4Kedw7e9YD6vimhIKekG+H1g3Qj3AFBp0Ux2e/qx3wHj5RXfZbQU8XPXu9Yugce9T70JiLDXi9hv/GEpZvQA6FjFhCXjD05NtrgYElvjz2hTMHf/u7/km46lnIsSLRFPImBeUsAoyQLtcsvbNRGKKQYqWjqQRIRzvCvZ7rkbtrWzyseGxnWzyvsQovh1sC1C2QVxjW8yTX2gL5qIB4PCxOzbWOSb3nFHEsz7NKgBzud2kLphVPULLnOtapG595NcZ1E/Tuvt8hhzvFMgDXQfNBHTpXQI84uasev2nFQ+iYh+NQcQG8Fe6Mp0Kf/92ixzuDu56QpyXP9nh4N1hxpvB/TZpn+R4QL1a0aMn3IK+gHx+yGeGKDFm7vIMe1vwX33htWOQANye3Ieh7wKebHj1idRIcB/zFgvyW8zrgM8hDDnJVBa1Y8CxgOB7+7/3ImwL2XD+df7bmpvOoxZ4Dft42gQ7woKcg4Fy+ckZwxX4FogqYWrBxJECZn9571Md+tRf/evvzLshX2PVc9hmsO6rHrkA+ntMa6GO/5bmPouz5sN0+4qmAV8gXwATon358cteXjm0uWtGEPQAcbvzy1TWFdG1bV8+SbPd9fR1BjzjBy0OwMw4cTqcWPH5HPP/YS6blN3xzHKO96yvMC+gjbua2V4senWaRRuFVJOTdVR9lVUmvzFNZvuU6NtXw+WtcAHl4HjARzi7IjzH0I1zRobbLP3f2Hrrs6a4n5KMD3m03R2aCZa7WvIpgpxXP38hU7qZXwG+B8cUQ585WwENeGGwRwc1z4L+66QFOrIc3Ywb77IJXkC9/T0vdF7/1GhxfHfFgBaDErQJeLXo5N/63PeqntngAKn6Luz6D2EIOUwJVtOhlL/9930x6rG+bts9wp8WfxgnPITl+l3rPgUDP1mNZ34VDnjOslfnSw5KXCWVUXMfpZAFV7B9WffnEKs+F8/bg3RPb4WnFx/LMQxfQX4NNB1giHrj2H/9DfyRgz3V00//hb/neasXrbI4V4gb2xqK34XWc7//Tr39bA/kYqXP9W2ue0+eK50yQZ2L+1negkEd+2Ar5BvSjI94IV1rgeHltl6eQ6ZHRsQSwCXnvce+iFf/lm96WfpzGQe8AvtgCFGEhZIBfKxhcAcBSqKiFjnPRTQ9w4vkR8LVgKW2zs/hf1/s+k3BdFH44N9yZbsHHNawNPn4XWDMese7Rk9HbH4UarfgGSoRmArVGSTxdCze7W/VlGtZd2gR5j7fHJzluizKQ87+v1/1T0HcgD6j1LHmHPXu6w4rGMLXoiX/2/r3gHnAtn4gl5ONDVU8/XkWXvfash3WOa2J6aHaw0855+I9+BAp4tr2zWUEBr6Cv+xbo4plc+2e+s0IeM2jGDHdsZtOKk7XFr6mBPJqxOIz0FddHz/qQQZ6g529qBv1onx/hCgrTePnz19Fl76Dn52dRY1aXvbrtCXYuURlQK94/NXs5IU/AV2vC5IXALvEYHo97RqGEKXH5TXgCfj6/A5DreF5fXyD5yN1TxeL0qSj04ELF+XlcBvZ823TuKBRPn4p4xux28vlTbGMlxmG2qsX9lXUFugvQmxbnS7Rrf71GXe9xSo7bIoe2/vfnExUYfuIXTRK1QtN2flPII68BnLsg7+L+dOEDzMi7OCcr7BQAWzvt0Wv3xGcvIN2iJz3G5sNyR/rC+TA5FACvngXAnHPVUzgG6Z7uew6b47VCHaD7uoCuDBVEhQIV2mv+2F84eOtf/Z5w0cdnbZMhc0zr8T4sH7SSDpC4HpZlpjtMmKWQJ+gd7K7REW+EKy5M7fLPvdwhT7c9Mln8PnlL47In5LlUyKOmjbZ4HKfD1DLAX2rQA/K1YDkC3CEWKgA7AQ/XJixsTLyDAi7WhWtQvwG/C/K0SNpKQcDi0ZPR0zgm7Tl9al5fwBFwAUgM+GrpxH9A59GT06xetOKxvUxbWwGKayew6wrx5VJ+LwHvkC/rVqx5heguyNdnm2w/ihzoPchXL4VCHnHGcoe7HumH1jLByt+6LhPgC8hirP2iFz6ALpY5KhQAGvYlyNnmrktqca1v/Jb5OuWc/A2FBS8eAogWfPQVyEDPYYEmbMO54fr/zj/x58ODgAoJPWhVTZPUbuk7iArD2YfqJDgK+Mya72l8zGaEKy7EPPY2lE5d9jEJRxkz79a897wn5FHTpqsekFdL3gF/qSDPSWIIeGTuo0B+0uSeJ+hhcaCwROGJ67CtkAUKj1mepz2nVgAI+3AnlglrAspsJmDnOFrdcq4KFFN8cKZ8aQ7T2NYe9TxeQb9VvG7yewl4B335vQfkfft0Letw59uPKIe6S/cD0DGhVIV8gX695wTyBC8tc4d7JgUv/nMeeYBboYuZ8wAwrH/1G68PaxvHOMh5Xs5ax0ltXOxdXzv/PfHZCzEhTVl6/55oGjDYO+CjMiJwh6cK4n9cBx4GVKKjt37JvwQ80zyeOdvd+1oOZcQ5AXJ8HbJa8ua2d6hn4tS3A/QjXBGBQ+kc8sykdNljKBzHzDvkuQTg6aoH3KnLDXl2tIuJRMSCJ5yXBcAWTYAnbGG5wPVNN/1sxatFvetaCvblt8gBePaknwA/T+hSf5sq3IuFT6Gi8Pp//AvTF9Dkq3JrVvLeYhwWcM8gvxxmp+ea9+2468tzqKD3uByDekDXdRXmBfJ1BIHNCeCQR17j8K0e5BW8Dt+FpV2selTi0DaOfdimTiud+/bOuSbsi/OgUkvQx6dei9xYIOD1t4LdAU/Ic4mKAL9nj4oK8hm9ZcwnzIvMM54XWrWQp3eBVjw63kGHgfzoiDfCFRV6Q+m0PY/tewA4hq5wrKrDHuth8asVvwXyFxP0bId3wB8e7lMBQRHAgCUsDAK4KXz2cCFm50chB8Cj7ZwVCIV2XGMX5IsYL7iFUVjWKWwBLRxDl3cCuUNpD8hjfwd9VQ/yJc7zUjwhHpcjiiDPIM/fCvUF5BX0dNkL5NkmTwArdB3wGZTVosc2tdSzSsNxiB3/YqKnpx8PC94hr9Y8IU+wqwh33R7p/cz0IS246DlHANr/0U6voIf4PmjRe35o8kY5Br8RL36UJoM8/7vozmdvfIJ+tM+PcMUEneJWXWy05pH4UcvFb3TAyz73SMhzWIu2x3ubfA/2DufjEOep5/esFe5HgzyPvyuaAFAQodBBIYHnpR92YYEz/d/lqp/2oYcA58G5OY4dBRr2CSjz3BWS01LPNVnw+vnZeZ56WHhwfWqHO6ieJ4HcPlIIL+HekYN9BfAN5GtHq4sDd1cGeQd8VwJ57QVPyANkamEDpA72TA5fPc7XZ8rOt+VY7INKBEAf80EU0GsZopCPfPjYZDiodd9Y+MWrAZjDekfFB+dGHwCIM//9xF972TTLI64jw+iY3pt8hffleUMgj3NEe3xx1TvMAW5sR0Ubwm/kIVS+dX3Mef/qmwz0w20/wmUO0xS35292yDPzsUfusyc+GSCnNe+Kj0Xc8q4F5L13vYJege+QPqrWOtrtC/m20GitbEKYVjb3Y8Hj58rUWh7FbV960uMzuVNP+rsK4MukOAGN0ukuOWeco2zXwg/nRXzrDHflujNADw95wleXC5h3FPs74Ncgj3tU8Jb3Un8n8Ttu7YL8wppPIM/8BrABYjruPANwTxmAHdqHlZ/br4NKiXb6ozVP9z178KtibH+Zjx8wZyUH3iXkKfQd4FftcB1tigBgAXuAPqx+jpdfmQyn5glWeKMtf6pQI38BzAp5WPXsA8P+ASrcA5dsVoBHD3HHuQB7gB79nrzMHWGESxp0KJ3Xwgn6+Gpa6YCXWfOEPL40p5DXIXRrsD9u0APw6GzEAoCWN5ee8XsKOKJAr+tmdzCseBQAGCvMb7dXKy85V19tfHAOxBPnhocgChnAoECdcImCqsCuAV/RtF0+Q4vjH7k7rJ86w53eXwHXUSA/HT9b2vtCvp7D4J5dA0s+7+l5TO+WU6Hq9oul44B8Bf3TjwcgAHmCzWHLz7nqJ10vlRzsvf/oAwDYI/8BerDE8R/3hm1I0xQ8ADye0+Piv/fo1/+API5jRzzkP69gZxXfCneBPNIJ3gPHxwPyADyassIzh34BxUhgM1w9n02CFR64AnvcMyx7uPDH+PkRLnuY2uWffSlc9pklT8gD3uyA59Y8PxaBxA6r3zveZePl3Zp3UB9WvY52hJ1n/lWhMK/LCe6ACaCOGjxq+hyzXj8M0ylkMnE/t0Jwbgxv47zfC3dkAQWXXLc4v7jwAzKPnoz2+OhVj17NpeKQgXRfOdCzdWtqzrUD8o3kXeHd4N031vxFtOp3QX4h3A+WpbOXWvKAPNvkM8BDCnmX73uxlMFdtwPE/CIdtuG3gtt79Gfi+X19QP4bvyUqC+zwhwor82Btny/9TzyfTfm3rLP2+J/+obcdvPYnbpyneC79a6bj5RPB/lEpmTEvVGbrg+BtoDU/3PYjXNagX6WjFZ+57LHEJ2UxnI7WO5b84hz3A9xRMdgKepeDex/VjnYcLvfw4TvaReFdCo3qBTh1R2RkWClwpWthEArYLM+VS8fQT9PKAvCAMKwJ/NY2/gr1AhkFYU+s2ARcSnt8TGOrE+BsgelGHQvksa646/38Kno0KmgL5KOtVkYNHFW98+wNeYI+cddfTZDPltk+vk7jqftoxaEHd1YK6K4H4OHexxIVYlTu3aKPPFXycM1DAmj8xzGoJPzwD1xXKwvIG9N57DsTsqyAl/OpUUHY471iBBPKWC93RxjhkoXJZX/uLdrLXt310fkO7qqz9x98/Z03LFz28f/v/Og05K58m70HeQrjtfEZ2uMEPDvaxYxYpYa9t/VuYgHPCgOteEA45o6vn3edvw63RRXWxTsQhVHpqY+hSSggeP2AYDmGUHOYz1CfrfoM8rBUoikD5wJEEZ8EYIfVDG6Nl8Cc91//H33YG0GLcwHw8W2C8kx7gN5Heg7+3gX4hauegMcygTx71xN0DknIwX45IH9UOdAd7rtAD7HtH/mcbfxw2+O9q0Vf075Y8sxvBDj211kq6X6f8hqnzWXenpvrtALgoMcyhuWVzoTwkh5cOH/tcNuPcNmCzn5HK96t+YA2OuA9fEe45mnNqyUfVry567mO4AfYMWHOmZ9948HjN163sOYd3FuVtcNPmVmgmsB2TQTqbHFP5+eHM6qbXiAcMNhVsajWvvQTKF+Ww1C8mPe+nJv7zh3RHKC5ND60ZgBAuDpxD4BNnHtPwLrl7f/ndfoBmhnwulT5dXapwrY8o8njMfWVgDcHvxX+h4G9gtyPPxLkO+56NM8AZg5GysHu0v10f13nvy+XWJFx0Lsc8liHoXQQPXaAPCrHAD09eDXfsgKt0BcrHkPx6JHDdm06C7hr3pZyoYG9u/Bl7H2A/tGTB/CUjs/SjnBZg85+p6B3lz0sDgAa1ju/G6+96znjFY6JzHbvLbEew+s+/Q+uiQoCrf/TP/Ijx2LNsx2egJ9d9DNspxp5AtzNmoCMggHuwXAJl6FucyVg9zWW26eChd4BnJtu+gAx416gCcB4m3VX5VpxrtIej5nu8JwY7zj/Rld9BuXe/7lCshTvu1FyvUwV7gSsfQpXXfYKdz/O5ddZ29e1gPkuyCeWPCG/5q6HHOwO8R7w/fe+yq51HNoFe4U8x+Vzlj1AntY38gzSd80/BfJaBkx5ae6Ei3wAwKPSDhDXNv3SRLfMq22+bVXOr7Bne3216M/fPNz2I1y2UGa/C5e99rIPWJfxrLUD3oMfO/j4n/wLDeQhWPOf+6evD6En/me+78cC6thH98Nx6KwXk+c8/NEjAZ6Q1+FyBG6bAdvMvlU8HwoAFCjoJayd7WI/sYjVewB5QcG48bwBidOnooDieOPYFlC4c9perOHmOrSWU3FbsUJwrvLt+OjMV8bzz+ffbkk7sNv4iAj5BPZ+zn1UwfrA3GwRBXqx5gl5ddn3zpFpyz6qBch3qfTsziAPdz0Auq81z/W6zNb50s+79lvbxaFd1z6MHPAOeu10B8hHmzc/Tyvfg0f+bPuzzGUA8zKOQ17Qjz0xr3qeZR5frGvOPedvVbXmH7vvAGXrcNuPcNkCXfbey15d9mrNrw2nozi3vYrrAX1Y9mifB9zVbe8QX5POS69uM2bW1Yy7onn/Yu2WT1HOrr0CmR01/v71556+dNPHF+GKlV3bAwu4HVTQEu7zvhXy+F0gjwItprLFMwrgwB2Zn7unNVhXqLvKet8/RCt+ozVf4UrIlw/BUDgPrPj4pHACeYd0pq37UQuQFy2sebyTFcijrRkw61nyCnbVlv24Xpcu344l4oKe8vAAIX4AI79M5+fe9XuLHPAOebbH04qPZ8gP38g34dkRL96nWNwAPK14joOvebybV5lWt4nvWN/zbM0Pt/0IlzFwYpwe5Al6QB7t6rTmAW7/aA0/XONT4Crk73rt68I7QMjvC3pOWxu1+TLMpa1Zlw5mBvs0E2sG5b4lo9KKR6HA78Q3vd4Dxvw4yvKczXkBQ62IlMIGnX9YKFU4B0yLZS69zRWYDviqcq3Yp8xXD8jzAzfT+tLmmMBUr+ciuBfre5AXa96P2Qp3lUO2tstHgT6dM2uX7x5v2rKPyuHeVUkDLPgd8khba+56hbZL98FSLW9dr78dxHouLHEsAM+x7oAnmpTwHz3cNZ5+jjV5fFwOeYj3grb4mIBGyqZmGFvp1Y72eaR1uuEV8ti3lh3ROXfOo02+LemlVp6TfJ3JIR/xKtP1hjWP3vZjbvsRLkfQiXF6oI+e9mfvj4wGS5xt8w7zNQHyOA5ufUDeh9QpyNegr256WvEBdnPXT5lXf7cZcvl/du8F4B+/LyxgfuaVw3QqtFcqDrp+/l0sBxQEp0/Fl7ViWButeACxWvEF+B3gaiFUBaiW4wNCj9xdZxLDs4rj2GGoY8mvXm/HtoV6gIdoZfn6jvS8DWjlPnrt8ioHtWrXdtcC5mq5c8nKplh3DnkAjFBzCCocMymYcTyafmBxc8IZPeeuc0Hcn9PJErQULHqC3o/dV2uQ5/3oB3Gi+RCuekJe2sBZIUc7Oyok+M38CgG4+A/AR15QKGsejrRp/6kkn6sU8nzf7G2P+EZv++efe/lw249wyUNvYhxK2+bdms9A7tJtaskD7hxD753wCHiHvXa2q8Di0Jg69IUwmwHbg7FmUFYUcB614qOzHceXc39azcm5aoYXaRx4XlrxAEIFFdvLcU8J7GKfCtEW8rGN1wRkHrk7KikomKMiUSzbNUs+0659e3CP4/YA+S5lMM4gv9Yuz2N9eVh1Aa+QL4X+AvBlCB0gD+gBogo//nY4KiR5HKAOS5s90AFF9PPQyWm2nBdwBVT5CWWFOS18nrd3jq1agzwFyHN8POe4r8+xesbmNne2z6P3PNI88i7fFa35mkeT5r0Q05M0geF4z+MufdcKen3voxPeCJct0GWvX5OqveUL5GnNYx90rlv71rwDXiH/+TdMlrxPluOQd9hjyZo4e9PXDFVd9ktXvQLW1cJYzvHoyYAFCgu1Cvy8PTVxKADiepwPk3AEfGvloVj56qrvWNsseFLhmiiUSs96WDZ1EpxSeWCctqoLeTwnAXoos+D9+fh5NgjQzOAa21jJ2The3kF9FDFu9dmzgsXfxdKEMshjzDeseUDaIa9QzuCI3ziGUEb7OeCL9ZxTHkDmMXq8n5MiyHE+VEIV8vyNygSuuXaerVqDPJsecD2UOXx2sSzPlJVhPOdwj5eRMBjqCsjjP9IFt+H3fr3pt6l536uQH2PnR7hMIVz2F85f6y57HU4HsQMerHkAG9Y8YY62eKgHerfk1yDv/yF2tpsyN11tBfYCaLfi1zTvN497jfWlw1q14ktnuwBFch4Xr12Xct74EEf5RC0BEduaNvkZmg6pzIqfRC8AQXMimgOi0125hzh+T8jX63ZgvwQ8Kykr7vo9RagTrmo9N/tauzzX87dDeh9lx1fA67Pnu7bCnq5bWvCAOy1uAI/t6ApxX6oAQlrWsHb5zXisZ1s2AImPvuC3QzUDP5Y8jh0CuY96DLD0+BxWPdDjerg/PCO14Kkpf7UQJ+RRVui0twS8vhPmzy3lRCY91uGu79wrd+iENz5gM8IlD3DZc8z8GuSRaLWnvVrz7HBH0HOpkMf+Cvnsi3UKea5L3fR01SWQX2TCTkbmPvPxU496WvF0czcWcHKeTAE5nvvUNK82Ch10ZIpPvpZ2frXyZ0C2AK+wW4BdpPAvkIclz+lem7gnIF2TAruNj67XeJuFv+KVWJPCnJD3dfqMcJ94d6gM4j4JZ8ohvY+y42scJJ2xkCd0AjKP3Rd5hjO1sRMbrWWFsILPgajCMQA4IMg2eAUnIIlrwMLvQd7F82beAYgfnfG4bFV2Tw55bY+vQ+fk87QBTFrxJb/zWWM9PwWtlfTYVt5JvCda8bUfz36q15PZ7lyEvIN+DKkb4bKFMs3tO3S8PIVMxsTKcfPPnrylsebdiqdlT/hjHXrZK+Qx9t6/XJcpppItY2Ortb4C+TWo+/9p3XRMQDez4qN9WV3Dy3Mvzstj2FegzH0PK55D2qZzFiuYxygws571XUterHiB/AS8qW28VlT2kMK6iYO2wZc4Vfg1oJ8hvI8aiK5Avtm/M489l/y9r2JYXOn0p3GLJe5PrEOkoQA7QFQ+JwtrG80zgLJ/dQ2/HbYKXV0qJHdBHtv3hTzPj7ihAgLQM+78xvvFsOLx2131HDoHj8cC8KUcCMCWSbBCBHppj1drfi4zWsvb827Nv6K6Xipv+lv/o5xcg7xa82NI3QiXNOg0t5klz8Sq1jxmwXNr3qWWPCCP3vmA/LnH/kNAXl33ALrCHhUAAJ7fd/Zac2u9t5Z8llmbDJtY+QRxY8VXi7wAKCkUUhXLEkta8ZgrG71/URgFMKwPQbVI1ToViPv/TBU8BfK0XqZj94fuAuYdcd96fULeKiV+/p4I0l1q4vrwHXO7vDRR+Hn3FSHP68W1cT9yfbqFMZZbrXV2YAM4AS4HO8HmoPXfCkZCkTPB4Tps06ewnUPgvClgl3A83eWw3AF3nMs74x1Wfo+QAx7bUclQVz0Br3BdqGxHfkM+5udj2Rbf5tPcIMjKjMV1DPCMG+PngFfIT0Pqzl83rPkRLnngl+nUimfixJJfpYPCmn/4RACc4+AV9OrCX4M8QM6luu+xRPsq53QPy0jcYz0rPsus3MbfDdglI7PNvE5fSxDvacnPmuOEiopOfsPtrcWrLm9xwVfQLqE+azo24FisblRY8LwCTDy3VCYaQPba//dQc1wB/HTt44F8tq45Ds/01B1RsKslj/UO7n3k16zP2dz06EiH9AMYElZsKyfcXQScQ5ZLl27HOTlRDCxvtsnTyudseg5xvc7adp5L4+vxOYoYB38meGa4H9xXlD/4ZvuekI/yonjlpmFznIBp6a5flAfN9in/uuWuIKfqtWWbNjVUz+gTn70wrPkRLkvojZmnRa8JmtY8vlAHt722v2ci5AF+fpZWpZCPaW8/e9c8kQvnp5f2tRzw65CvGZZfddMae2mLr1+ZEysehYODOM6jwCdkHPI4toxZR6/6OjFNxKO0EVbQG+RVXciX+ChMyz3jfuo9yzUcqHFsAnmu36rmOIF8u3476BdwTYDPc4Zi3v+58x22ObD3lV+XkJ+f8yT2t1Co9+RQy8C7RTiWE9cAiKhgoB2b7nVsW7PiFeL87/swzvvGbYs8LowPPi2LygvKF04oQ8g7aBeAp4rbHmmBo2Rqnmwq4W1ZQS+hi+d1mIfKzHaII3/zI126noCHRtv8CJclaAc8b5un64nWfG2bP/tQzFePeem9o52DnrPk4QM1PcjjNzIRxrui0ILrE9drAE8tIO+Q1cwsFjktsFJjj8K8zGvdWPEGzgVMM8hzqZDHud//0To23uO0lJzfrrdUOSbi146z53Cy6Rza9r8HaBOY9+TH7iu95wyy+l9/83jeOwr2eI/lecR66TOwVQu4m5q0VNKPwhywpzLIZ2B1EO4SzwXLHWBkMwG24VoOU4cqjtPzKdw13tiX2z0Oh1UWHwAeS7rqoy8O56p3uGaA5++ynm579rFh3qsV7aSdnmqsdLkOrfKYhe/px6N5Bs00MEwgfg4X5SPKy8ySV2vey+ERRriogd+Zd8izhppZ88/cdnO15tfgzm1nP/CvUsgjIyAzsu0abYHI4CnkG8ArzHPAR8auVv28PcDy6Mm4Ljv4oYAP6NATIBBSGOl/B9Z0vclSR0GDSgu/X00YTdcv1nVi0Tv8lvLKwQx5LCvk67mnYxZx7cghviY/9jCKcyGOiWveAcztzfHY9+GpcpN1vttHDnRX7GOWHwp2VOQAKodkBnkH/GEBSihr5UKhnIm97wFTgJ5x5bHwAsArgIo2mwL0eh6HfcVzOOT/i//qD0feBzxpxVc3/RrofZsAH2mB/WxmsBcPF99faQ7ktQh5LKOy8Ph98X4hQBwVOsQTTTN4VhyFwPvAM/tPZx6J8hHlJMtR/KfGuPkRLkvIZsCju17b5BX02AeT3GRue7rpCXsIw++ilivWO84FyP78K64/+OkfeltYvrTim5p0/ZysAt6XLdx1Xxb8LKADDuWLcD4uXqFJODpoHVT1+vF7Gq/NTnc6+9wWyPt1fN1y/7Is90jQzceX7QmY/T/XbZUfe1hF/BKoOui5rh7HTn/wzNz/283Md/6eMqDHOTpj8T0O9flLU0/A4LH7AgBqvWegP27IU3oOP68KcQLAYfUjTQLknBIX6ZQeAVSyOZMe9lfQH1Uaz2rF/3d/LiDPXvULV30P9L5NAB+ALmPn1ZrXyplDnWUOLXAAGRY6ng2hjucFkGNdfOnx/R+NMgRLjGhgJQugR1nHicRgwbegn2bBG23zI1zSUD5B+w615L1Nnqpu+0furiAn6Al1F79Dz8rD0/fcdvCxG/5FAP7nf/h9IRQuyBB6Ldaqc6i7dJ+2QhCFfv2i3IloJ19ti6dLdgHZxJIXwMcxgMDpU9HLeR46VzoNFrjXfRPLvAvyxbZJER/O+BZfthO4r7jqFdQKbod5T36+o8jB6pDXdc1xfC8PtE0VmXAeX8f1fg2PQ1wD/7UdtwAFFVOAk9Z8puOCvIKSy564HX0GYLmzxzzyGYV1BLsLoPeheoeVxovPABUIAB7/a6/68sW5aNN2iCvofb3vU8bP16G4iWseUjc8fqPCBnCjgkOwA+CEOpYcpgjYU9yHlan4gl6BvGpy2WNO+3PXDGt+hEsask/Qeuc7ZB4FPRLtV9737mrNO9hdt3zH98SY+d/4+/84PuUKwP+bV06A/6W3/WpkNDYP8Fq7Ib+03P1/gLC47qPAPn0qemPrsCvsU2Gv8KyAXcphEdcrwMW5AfkoYJqOgKx0LGG9riXked0J5jPcuK0bzx1ymKfaowlglxhHh6vvp/s3CvhOz9z33aJNkFd3PadXLm5eDNUCpNBpdAvoezB2MO6Sn8fFawJKDnjAzKHuwjEAF87j1z6sNG54VoA8e9VHhzV+Ox4dbx3eO+SWv1vzhHrTVl6mgsa7Q35FXCC45QFugB3b2PSm4jrdxkoR0gPb4RXwWEYHvDGn/QiXI2SfoPU2ebWw6bbHEDla8w52F0D/Kz/26oP3vu7fB+Ch637qnVGoRKZABhXQt4DfAvlWFYj8Xaz4mN9dXLvVcpfe01QP7BVOBcAEBisRnOVugsPsqvflYTVdO4dtFt+topWeWe3+/6ja93z1XURFYwl5VtT8uF0i6NdgH/vSU6Nu32I9opLK6WYzuK9Z88cJeV4XbmaAHUCHR0kBvgXyFK/l198qHqtxjKGGBfLwgtCSpiV/GMhDWkHAEh0yozJPa/3MI/EBJ21bZ7MFrXFa6xAA7iL0uaRwPEbT6KQ+6rJX4M9fqBsu+xEuYcjms++57GnNh9v+xCfrTHgOdRcg/3/9o587eNdrfiUEK56dgdjRLzJsATxd3Uu4u1pLWSE/Fcylx3mZ/MateAV1PaYCtQ/LZhuuWa6BgqJ+VraMvee5K6Q3Qt6Pc2XxWYvzVu0L4KNon/g2kK9DI0/Mk+IcAvJx3gTsasnXZ2ud72r7/CMnwiJFYe8W/S7AKwgdkmtygOL8gBbSn8Pa1XPT63Z+fvaw8dO4UWrFw72NvA/wqRUfEuvcly63/vGbPeFRoQGEtcMcrHV2MlTRFU/IA+Q9OfShgPw3fHOci5BXwOvv8b35ES5L8Pns3WWvljyteSTYL13/1p2gR5u9Qt6teI4xpWU0W/EF2ImV3Yf8DEZdTys7PnwjoGiWFaBzBcCBUMFgFnPAoEywExO0lO+610rGDmjP511fp+t7Wov3LsU1jgnwvXhsPb8f30BeJgPCss4TkJxnlxzuGeSnCts8CgN5IPIDx1MX0AMgaxa9g+8wEPVjcV4AjG55LL0NfqvYVs8pef3a+0rjCQgS8vXb8U98NiBPK17VA7pvw7HsDR/9JN7/0cZaxzsBuNnxEDDHOrapYxthD3DvgrzDHufBs8J9ZZB3oZw9ePapbx/W/AiXNGST42SQhxUfoH/4jmlc6JlH4nO0GDvfAz0qAb/64/+kAr5rxRfIT1b8DHAWrEvAu2bITwUyvzs/ueo5O1pMXUqXL0BSXfME/FbImzX98InI5JwEp1ryiFt6jhzc/n9t311au4dMh7lGT/qM941H7xxUPFtuF5e9H79FzbkTyGOfDPJVMrYb4EJnN7foAbo1yB9GeixBj/RHS30L6Al1zl2P4zmxDq9xlHjyWFrxhDyuQ8jXZkL2rhe3ewN3h35xxUPwnqFtncPbYLHTKgfI4abXznLYFxUB7Iff2omOEM9gTwtef+Mc9E7gGcL4Ucg78Oepboc1P8IlDm7NZ5BXaz4ms0EmvesTYa3vgjzb4m945buigIlEjwxb2uIPZ8m3UhgSVjhv/Uob1qMQr9b7uhwIDoZmncwhP8V5nl7Tj99XR4Gvx9Pl5/X/h9WW57hL/j54rqYtXT5Ww21+njX5+fUay/3KZETutieEHrtvFfSZCEMH5Jr0OP1Ntz2sVgKcEFdpRQBwA6gId1rwGqd94+dxAwDVVY/rR4dbg3xPDnY8Y+Q1BTvuGzBXsEOw2mm5q+sekMY5aMXjeOyDZ+dwVxH+OB6/OVoA16jDAaV/k0qt+TE5zgiXPLg1zx6pasUr5OmyRM0VH7ABzB3whDxc9atWvE1lO0H7cJCvx5XfcNHTiq+WWlKwZ3Ig1AKfndRYkSjt2DGHvPXcPw7IH7d4b9r+XtcdM+R9/b5y2Oo6hTxd9tn+a/J33ot3rGcvewE9027AqBTwnGMeYPtv/9R3XhTQO0gpQBrXYhs0LVZUPCACHft6swLP2Tv3PuLxOG/PVR/lDIfPYZm1z5d2dgjt7BzmBrgCzK//x79QrXZsI9wBeq3AQLg24c5hc9gX0AbcsS8teg6dyyCPc7BigHvCuTlKSLWYaKyx5jGcbrjsR7iEIfvWfGbNE+5RyOGzrfIBG7jtIYU82uPZ2e7fvPqmasXTeg9JxWHNRV8L4ATwDvkomLVjFiGPc2wAvRfyayLQ2bFvis/h2ogPq16cfb3fp7Zz+7FbtevYw3gisnM2FZJSedJ3TMhvBf3iWay8/3kbv1YoFV5tNy6FOUAGqBD0hL0D3mG/VXpMdh7CnvLJerxjnR/P9X6tLdJzEfAU8n9YvGLFZ4DHf8IdlWc8S07SQ3c8gAzrW612rMPQXHSGI9yxD8GOZkakF3oB8DEpwBvD7thbnscQ5gp5rsPx6pmI927z2mewr9b86IA3wuUIas1z9iYHfQP54rZnJ7wHv+WvNG57ddXTikfmDYunFIw8V22/XoDbCt/F9nZ42nyeu+IaGE5Di7W66gn5jtveC/imsLehZhMA7pwrE6XTXahMxOPnuBjqxVvX+326/Ng19Y7V+53gju37Qz5Tfd7x3ooX5cE7w1vDipzuv+vZR7w7aS3bd6oQSZOQue0jXZtFD2tPQQ85VDPAbpFD2OX7+7GU9hfw8/pxu8RjwoL/xm8JENKK59h4lBcEuEJewY4Z5GgtsxmCnejojgdoCXYIVj0Azf0BZFjrKGcAd8xmh+thvg7AGfFBZQBAx3S4tOgRf8QZ56FbXl30uDbuR4cCEugZ5BX06rLHjKPDmh/hkoaYHOfZp76dH67JIO+qQ+oePbnoaU/IA/DoUR/jSJMvzUUBK9Z7LWiTAjiFvFla0/lONIV/Y73L73pus2gJlJ5qxaEU/BXy8tGb49axgNLgvNS2a+gxvq3d53gA71LIo0KnkFd3vh/XaJGWdt/TdM2ynZVJab5S1z1gRtADCIR8rxOeA7oHWd93X225PqRx0HWZfD+2wxPwED+Xi+Y6tskD7IQ+tsFqB3RphdNqB/BhoWMbwY51WNLKx31h/wB7gSmtdH5UBqBF5QD74nx/9S/9TEAb+xDyuC68HTg/3fO04LEv7ykmvirt8IQ7y0XtJEjQqzU/OuCNcNlCmer2Lb22+Uw+pE7nsUdHO85uB7dWJPgE8L3CNpMCXgFSLbwC+eh1jSlf2eGOlmW1yHYX6C51Ga9BfidgLpH82fVlz9LA3HtOa+v5jH3bURTn9D4R5V2jUtc0kzBNJedptifpbrEvr2+Vv9jf2+nL0K4o7MV1H1btH3tJ15p3gDtA16B6MeXXzsT9sKQFr+LYeEARVjqeC612CDBlXwGAGuUF4Q6QK9gh/Aeo2TYPQOMLcSiHUG7R+AC8UTGgqx7rAHtc6wf+9Hcf/L0feVOAG5Y8QY9zYh2A3wM8jq8z3BXIo4LHih47EYcM9LM1f/7m0QFvhEseqjX/3Nl7CHm2NynYkXj1f9RSHz4RbfDaHo9pbGnFh6t+8b34tiDWQtYL3PhtVryChJBnm2ntUb8A2u7CfFGQd/ZfQJ4TtXT2vxhipaJXsfB77vdJmJ9n/b/Do9GTn9u3H1YO+XjW0sMe6SqegwG8Ec/n69VjxPTm1xcPTt1HPFGIC/OHu+453AofaNnVPp/pUkHd5UDP4K6AV+tdpZY8lwAoYQ3LmBCnW752hPvgb9bPOP/xP/RH6v4ANt3+/LY7hfcAuAPO2E9d9vAYoD3+O//Enw8B7lj3E3/tZQFwXEsBj6YA3geuj/PERDfipnfAs3+Qgr6Wp3U++zED3giXIfSseQe9fq0uprt9+vELp97+poN/96f+SgD+vX/3lQF51MpRe49MwB7JCngvfGuB7hASK16BXgvlAqjmwy101Ru89oRPVvjHOpwbX0a7/7frh2ImyB+/FXtY1Xjy/qUDou/L/acloS9WffKe9JiLqQasZR3fMSCP/hdHhXxNX1nay+Ikz6iCPrHoCXpAI0D/Dd988F9/03bQu7V8seUwz6T7odJCuCvk1WXPNnnAHr8J9zphzfs/WuFOK55WO5s8AFjAnZ93RZnkcNd1qADgmaOSgPX6LXgs8cGs97/hutiHngRcP+tkR8VXJp9+PCbyUk8nOxJPnYfh3ZlAT+hzX6QFeB1KL/vRAW+ESx/UmmeHEQW9Comb67nvh/6///jg337XD9bPyUZbPCx97ajkPejTAjQHfBTCLFAV3uxIB8gDujp9LbetFNhr6h0X1yifP52syg1twZdY/hx7kPfnM/3eBvlLKcZnfuaT14aQx8djHNqNcB5fl0jvf05ny2aMWMf+ITVtlopsKfiRRyJ/PP34BQCs9jg/pFV/qeRgJ9y5zTvYKeABzXqf3/DNtXc8QI17hoUdVnr5IIy64+ke5zh0LAFdwJ0d3Qh0la5j5QrpAufHsYQ8hPcB6x3XwX0Q8LTgES+14CEAHxUVvU6FfC3bdK4PpKXWmo+y8sxDF6AxA94Ily3wM7Q6Cx7d9kzYXLKDHv6jEMNwlZ/8iz9z8Krv/d8i08Atx0zgvei90FwWoK1qIVqteIf45M6tbfHsUNdAvn/NNRF+9b/MiEawTxWL5e+e9Fhd5/sdVrx+30XfEb+9XgB3nHE6itRVz3hhifZ4FOYV8HyODnUc6x4kmXypTZslPZk8TnN8StpiGpWe93TdQ4AEIKad0/ax6i+GHN5cZmCnCODMeo+haW/4cANpiMPT1C3PDm/4j/KCVjsE+GI9wK6Wu4KdUiseSxogOA7Q5jwWADyAj+tqb3wOm8N6dN5DL3wFPMf4a3kXlvliGPCUpmqaKVZ9baosTTjVmr9w/trxCdoRLnnwtvlIlGbV0/VE+GMJoCNzAPCoBUfGwphYFnY1EywLyGXBmcBHCmiHfT2XdIirkN9RSB9GAU75/nm1LPe4xmEg79tXnx1hfQjI6zF+/sshbQun4nlj/cMnwmJLrXjs6+sq3HPIa3qZ1X+3c/rjM5TZ8TgfRJm6FXkF0CJkqpv7CrDq16x2Sl3zDngAEx48fHES0ooAP6IDsNMdD7hzUhoci/1g6Ue7OIenlc5tW5RWAJ747AWAHW55vAOM1UdzASsd8DZyvD3eCYwUdpTUuNd56Qvclxb8lA4bwEelr7jvSxMO44VzjU/QjnBZg7fN90TYs80RmRw96lErRwZDRmC7VIV0UlD2lEGmARJhr2BXWWHt5zqsKuDv/+34r5Cflst4u7ZCvkJXP55Sftd9SoUmftePuBiwWekxiFeJK/9KhTyfL9bVZ14gH9PbCtib5pMG6Bns7XoF7DP0+5Cfj9HnWdJcgUDkkwJ6WHEAGEDHDmAEJqz6rcPcDiO11HXpv/mf6+h5yOAOwXsXn5N+9U0V9Ap5gJUWO5dqtUNwh8MwOBa4i2C5s6c9rXc8d463hxAnXJtx4v1hfwCe89JngF9WDOX9C+ijHCTk6bJ/7uw9Y8z8CJcl6Lh5BzuFRM9xrqgFI3PH5DevuD7a4pGYIwPQpQXIJ4XjvmoLUslQDviLCHkChjCN36XzHa6bwTqT7+f/FfCuCnKBe/fYDOYuv4ac+3Jq8U5tUiJ2vmvmKigAj/dePUBqtaslr9Cf5QW3x6unJk0Wi147Z4VF98RnL8DzhXzzc3//pw7Qs1sBehSrfs0i933XjmPnOAWxwx0VFMxqGYAv36eA1F0PwToG2AFaWu0Q9sEzQGc4lCMAn0N6Xyn08RuQBsBxXUAbUAfg4XXEb3gTsB3bHPAo39hUoF7MrAmyV8ZM6WA5pG7ugDfGzI9wmUL2vflGcGGdeSgmsEBBFZ+S/e7pgxC9tvh9CsueZjAp5GUMfAfyfp6jiKCZQDtZl+wLoPs5tF3ZdsI7ruPgdZX79vN0QZ6J+2bn7vTCv9RavFNdCuTnznczxFvI7wn7Ukh7fDIxTdT/Cnp2yCugDw9XGUcfHjBYlK+4vlr1h4H9Loi7HOpYx2lw2V9Aga7CPogvYA7AE+4APn/jnHovejyAC+u5To6zwSLfSwWmNEDUekf5hOcNyMM9D8CrN4XxQ8XDAY/35m56lmtMj/Xdu5FRRhcxjnMHvGnM/LDmR7jkIea0f+or34REyDZ5Wu8onJBBojb8iuvrxDdo4+KsUyhsa0/jjhVfM4VYaLs0A2q2skJm7U2ZjFbutoJ6q9SC57rJXTxNyEIr3+HryrZz3QK6PYkngefgvVdY75Kf0+Rx3CW+G1/vyu4/U/tO5wI03gNGVNxz2zSNsfb7WAD8EJAvoN8iT79z2hTQs42+gB7zRyAvoXkLLm0AE/kJsK2A/MZvObQL30HuQHeouzK4o88NvyyZKbaXb1XQOobQ3g7QAqoKdx1ixn4L+wpAptAGj+cKNz2MDzw7PFuIlSn8RjxQhtHjkAHeh8op5DXN1Pcs5VmbDpbW/Az5MWZ+hMsYwm3//HMvR9tRzCj19OPVzUi4U/iPmjISLjICEj8Sdc0MSaG4D9wr/Bzua5Df4/z7COAjxHFt3GPMsieWPfbrgV6397Y5aLsi5O+5bYZgWe/7NVD3/yvyOMY9J89l3r4b8PvI32Xzfsu1HPL1N8+zgLsrAXySbtfk6a2mU1p8pbd1hT0qwKVPC7+GBtDDQkZ++ov/zf8ww16+bJeBnL91CWAR5JSDPJOCHf/Dzf2K68NSV6DTco++OKU8wPAzAJaT3nDcOcBZZ4rjxDEJsA8rAh6VB8AbcYZQgUK5hCUqGRBm4IQxgoqHAh7PJybNsbHwbsU3aUbefZMOpDIaabRMg8z7JuTLmPm3DJf9CJctTJ3wzl937tEHP4OMEe4utL+/+qYKeLbFYzsKLRayTY13pVD0wnFNKeAN9H7McYnQVngT7Jx5jZBf7CP3eVyQ5zFxzntua6byrefoQX0j4BfPuKOIS2mbjGuvVAT82FDnvek75bNrClAsS+c7xmFSmeZWQM4e0LkSwCegb+43iauvm4+zr9ipRf/45FqG9RsdwoornLDHNKwOXvTIj1nm/thLpl7v+F1mnTuM/PyoIKBDHfK2trkzr8NixxLbAPbfu//BOlUtp5AFzNhvB+UCO+H63O5HVbj6Hz0ZFQtOT4sKE3vOaydHPOMe4PmlvDXANxXJlXTgkA8R8gtrfkxzO8JlDHTb33Xj79wLsEctvgCe/wl9nd2uLTzzz68q+FTZPlNBWQp4B0SBhB/r58nW+XEZeHVbJsTJP3v6zP0TJJv9BPJUdg3CNeKIeyvArdsgOVdULO7/7YOn7vytaT2P4bNxaDvIfbseJ0uP6z6K46VwzN5ddg19N/N+5rIvXx1ERUfT3AT1eXhTXwnYE8hrnD2eHmdPbw3kDfT4jXwDGMLaxTAzNH0p7JHf0EGPcHIoVwH+vuTvHWBHZQLwxrUAb1ruaq1DmMlS3e7qfkczXYV56SOxgDs7IdKaPwLwozIh3wkArGG1c+w7gM5e9YA4KgF6z1jimXLqXe1FnwGekPd0kJUhCvjYZpPjDJf9CFdMQCe8M7d85u0f+vkP/16APYE8MhMyCNviWXhuKRB9XaYKrx7kdxS+CpEKC5Mf43K4MzPH8qG7JtCYqz4glFwLqoWBg0ygGveV7J9ptuaXgF6A3OGeQT7RDGp+4rfE3Szeuo7725cGGyXPP65l52ueUyk8FfLhso/pRXnNGfJHBf1cYK+nsyyuc5xxbJkkRaBBiz5gUtz3ABLakNkGTtgDvlgHIANcBPgC9h0p4ABEnIeueI5x1x7zBDv+A4Scf772hn/0ZOR5hXnch4C8Ar0s670S7oe07umeh/sdzwLNFGj2wHPjzHW4R0Cez3MN8HD5O9wzwFd13jcr3q7puOlT2Ar64bIf4bIHDqmr1rwIsEetGeOA4xvzJSF7JsiUFe6aUZp9HQyJ/BzNsbiWAMXlx2RK4c5MrUO5imUNaMb1k+tBa5Cv/yXOC8gDyg/cMXkNcE1AHm3zhJGD24Hu2+1ZLtYJsFX+nKoUkjGnwfI6oeRdxO+yzc9b92XTAArMO38rviiGdKgVTXqVjhvyfEY9pfHmOfzrdQWECnu4uQFUuJoB9ddc8/bqOifwCX1Y1gDx3/6uf1I71DncIax3a53nINTVcmcbOyBKa52fjG5EaBWAc32Fu6mBvmor7Mt34tmXASCHFQ9Dg5+oBeS5HoDXcfla2cHxtOBRwXLIN5Wx8t5qumjyyJQWa8Ue77mk0Qr5yBMF8uVe3GU/rPkRLltALRPWfO18I1Y8XHfIGCxcOfuYAjGTFuquCjRp412TH89MuDg2gW0vDj1lkJ+uOVvzNbPTpW7X02ej1+/FxffpKUAfnoWkTV6h3oF7Twtg6wyEpWORx7mF5PKcjfQ+kkpG9ixq2kDh+8Ad8dERQn667gTwowKe99gqSXMbxGc5wX7ZRq8WMCBASxXgqi7zH547vlEKfoAZgAbM0a5OYOt2zk7Jc7J/Dc6F7QAjwA7FVyQFxIt4doRn6+uqMrBnMrjza3J4Lug9D5Dj2QDwADp+4zOyWI8KEu6DY/PdmwG3PgAfM3MK4FnZagBfLfllemkgzvy5SC+ty15BH1+mi4lxhst+hMsY4LJ/7IP3/zghjyUKG9SYUQjAimfGZuI/LOChBeRL4d/TlIGW5+kBw+GYxUVhvSbuiwKbH0zB7/ljOQWquI4sYYEzLn7tNSkMQ9Y2T2u+Xlvv25+Zrett84Jtp3A8C8E1K55K3ofeZ37/AvnTp6bpS++d3MZ1COdOwK+AXu9hUWgvn9U+mo6VKXAF9oBZQJRwKVBD5zaAS8GsoKfU2qfFDqjD48ZOcviNCgChjx7p7DxHq53ueI1TBfMKzPnf16/K4Z4AHu50QBmgh2sebnjAHbAm4Nn+Dhc8rHTvYAephY/z6fwfAfkE7jPg57QyN0HNEGeZwPQZkrQ6HTfdL9JsVErHxDgjXAkBNUxAPtrli1vPrfg5k0+JmQA8jHhszSQuhwRBlJyLBTEt2brezunHOcx74jUic5ee3uzpziWAXjO/dMhjPPzaa9L4VkBK5QUVjTh3eQeMW3OOBOTNs1xskzb4Rh1Q4vgKyOX5F/L3a+968Qx03UN3REXzN3/6tQe//6EPRYHc9g3ZqmWhvYT7EvQety2qx7ISJC7hWGegR74i7AEGHemiwK/WfhH2QWczThnLobD8rjrbo2FN4hkS7ArentXevvPpd7aPr0vlgBfIA+6IF+JJNzzc8nTPE/Cc1Q6eD9x35p5HD3tUavBsaMmrFd9z1Ws6aZqqLM20ZUILeeajqNCV+4tKRf3O/JjLfoTLHNBmhHZ5FCYoVJBJYshcseKnTF0yfEnkXrhlcgDpuppJXA4Jh7zCRgtV/Nb2aDmnxsNBnsnjjt9hwT9w+9QJjHAH6LWtWdz1XH8Y8Vz8rdePvgHld8RRn02i5jmWdXE+fbYLOSS10FdALt9VI3+39qw8rnOcC4wfmiZAueu1rzv40vVvjQJ0nvmOBfNW4O8D+fn+PG67VNNiPIPyBTuDCvKTApaVF4IBsEeFDhDHUDG4r2Gxxxzx7//oVAGHqx1j04vQlo32Z4yEASDxMakYv16sZSzDwiRkd8I9kz/TVn6+CnmFvbjn6V1AuzpAzo/dAO7oTIfvzgP8/N68TxPM37hfnIff2UAZBu8FKj6AOl31fQt+0hbI17Ts6aQ8H5xXKxZ4T/H52TGX/QiXMxDy7JwDd1dkRsmkU6ZYFmoOx0zZ9sgcCQQcFLG/XtcLHj2ndzyzNnKNS091P8w0J9bqNIf9iegIFkPaqjU/HROd5NhZbgfEdqnCsICyri/j9hlPLFkArQEp29Y824W8AG+3a+G2U8mzyNa1cZvOH1b72YcC8AC9Qp5wp4W8jLMU3uV8c9yn57Zb6891l+LYcs1YqmXfEfIawQRAAMz47C7yIaxerqugNusYzwug/OEfuC4sYg6B82PUgu+951zts11A3SVxRBw4gx0sbc49D6jD84AKDX5jCXDDJQ/LHeURYJ8BHts5QQ8gzzIMlSEdG4/r04rX9OO/p//tfcb7Y35TyDfllVToyr3yfYzPz45w2QMh/9qfuDEKCGQY7U27Bnkmfoe4rndNBWAf8n4enit+e6HjBSvPI9Z8A+8kPi7uh7hMy8lyj/PTbc/28WLNQ9iHkNdrHlZxfgV5x5qvlkdyjjXVwgn/Vwpyf+YKwJ1agXlPhCyujQIakP/M9/1YnAuFdq9wzqTQnv9P9z3L//fvz+OaqT1GzklLESDw4XYCeSxRmaF7me5fVgCYJ+P3oyenbQXygDrarPm51bD41ZpPLHjI33GTv1bTxiw/Z0grIqWigvIFIOfYdwAecIf4/XlsA7Rh3SvcFfDwdBDw8GYA7Ow4DK8k3PvwblQ3vVjzc7yne8rSkqcHlgmaFuYlK3JzHwxW1MpQuncMl/0IlyVwGB3a5OHiQ62ZBYq7uGqm78DSCzuu53hb328BeJGfq5EWQInYNt6Drce7J+6LglnXAeThti+VidgHy9IhL/5vuY89xGujEInJebCe/SOO0E8iCqdyrmm5LLy90F+DYKbpmPl3pmZbtX6n2dW+8r53H9z717832uXDLb2jXX4J7El+31qA+755/KWn9Y77ya8znXeCAd3C88d2HPgKfhWhpfAiyAEVuKrZdo+Od2HN07rsWvIOc8tnvi557h5Phby759HBjp3o6J6HgYH1/NCNz2CnY+B1iBw9HPAMEPKw5nF+uuzrsyoVrPke+A766WlKU2061v/t85lc9oQ8LPlpKN25W1HODpf9CJc8sOMdeuoikzFTeJthzRSl8FIIZmDUbQ74Cqyw3DsWfQZIL2h8+w55XHepOa5Y7PhNtz1Bj2204v1Y19q2TFpR4bXhvlVr/rDnTtUpwPm8Mwju1rY+HHPBOUMZ8Priu288uPPb/kZY9Cg4w2VfKjxzgT0X2kuwzuebr7Xc3ruvef/pXnRfv4dM2fma+Brkp3WlOcIsfP1Pq54WfeiREwE/WPEYg4+x9oS8w30T4Ltqj+O5eN4apwJ6uM4BbUAcrnhO9Qvgw3pHPHWCG53BTqXT1NIdTk8GQA/rP+YD+OH3xTlh4etzasqy+vxzwGfv2t+jvs/4bZCP9Fp72Y+hdCNchsBZ79y9pYCfM0ZbeCl8Mjgy8cc6O3YuAPeA/BHl8czk+/F/uP9L5o7/D94ZkOeUs9GGTyiX334OX7dF3D+uLZWM2jafzFvA/f1cq+L7aQpAUd22hNZuLQvLTNzGffGbkD/1kpcdfPmaVx08ew+HdJbCOeJVLDH+XoB7Wcnw7R5HFe8928/Pu0kLYC61yHeJpa+w1jwLqAOogDw7oUVPb6kItKBfXn+3pPKXQJ79J3BdVDpgqaMHPAwJWNj8ehzc8Ygnh7+t9aDnl+SyeehxTUCecwkA8s29i2eyjbtAXdvpF++aHTY9bbfwj2PL+2Hcart8zH432uVHuMSBk+Egs7Etnlb8XNBIpigFFcGiSsEsx0yZoWNRdQC/b0HqUNX1W5QdUzvylbjEOmTqB6avpPFLcXTX+/Fc59fy6+1SXBPxeHgaTrew5u1Z7yU91gHPgr1s90KuEcfO6wxiRQrQxfUbq2iGNt31gPz//ddfHsCv1rwUzHMB3UJIC+j2WstCXOOn6u+f38eammPs+bj8GWaQ19+0WPF8AEO466/7qXcGSMOaFwBrJaF9blvVgrKeu8QH7ycm/LnzE2G9w2IH3AF5NAui5zx+03XPvkCAf3XPf+O3VMBjP2yPb8GXe6x9FR6bhscBpnDZA+46Lbd7J3nvfi81LS3e8/yuPW0s1mvnSrPmx1C6ES5LYKc7DFGhawuJs7ZfVciXDFEKqAxUmuh132mbTR6xVvgl//eVA9Th2tPaMVjHe6zu+3tumzrClcpJ7EfrWtroe/J4Z9JKRu0DwA6Acj3G2Y9PxfeDd6v/uW6hFnRMD/Wdm4U/F6CmpKDkdaf/cg2z5E//yI8cPPrTrzp49q5P1KmW04qoFN56LtWyEJ8L81Ck1bniOm+TfTyNNs/QnreuPwZN9zxZ0A3kxZqHGxydadFOXTvgsZ38yC57SxsCNpwT1jsACwsdQAfgYaFDADpc9XDNw3oHmGFxc4paBzx70MdwQQE8+yHENaEyigD3C0seQjMk7p0VoPzejwb5Jj2U84QWkB/t8iNc4jB9V/7Zl37+tz/1eQ61qTXeXuHphdauQq0oMgot9UXh3hacLj/XYeRw7am3P9YhLvgdyzKHPeIOl32d215gy/9c9uRxpRZDAvE86u/pnIue9luf19r7SgDfFeJpY4tXlRSUvO68roD5oTui+QiQR8c7QB764huvrWCrnfBwfNPeOi3ruewes0K8LpOmo+W+ybP2ey33u3Mf39/XrWr+nnnTzHZ2+vQqIA/LFh3w6Lb2tvnlOXdJwJh4Fzi5DTvQQYQ7e88D8NgH75eVAXfPYx0qAAH4UjYt4F48E1q5gecCHgx12QO0rATpvcfxhPKqu34L5Mu+MnKiNinEeHl8le7cNcNlP8IlC0hsSHRoL6IVT82QZ6aWTN4rsKQwa2FnBeeicHcXfpt5uE732VcO1p627B/xKrDlzHc6fn7fa/v+0ALwmUq/AH7vHut4PT/fXlpAfgfoi2t5E+w775fSwhL3gQIdHe4U8tATN/6zKEw5I2MtoGv8ZzAv7m8B+SSNurBfhX0Sd7/PSygFFgWwsJc9QOcue7Vot75jFaFYIVsqGQQ8IA6447oAPOAOVzzWc1a7iN/r3pxOUYuJb+BdZPt7UzbJ9Wo/A6ncoGIQowtgzZcRBljPSgLPo8+rgn4Bd0sjqyLkly57eBjGV+lGuOQBiQ2JzjOS1szTzJ8Umr31FYoJ5BcFZQIAbvf/XOfX64ngc8C6dP9M3EbLmhPi4L5q+zwt67LNz5HJ47sAeqZyblxX4xzHJ892Vc07XgN8b/2O9CHXyN4lNK8vcH5omsUNkEd7vEIe4ix4LagYr74VP12rFMgLmEvayyBv+2X3d2jtOldnO/NpwEra2gF1AJZT48bUtnTZC5xX32Wq6TnzWlzSigbI2f4OVz0E6x1CBQAQRgUAHfGyDnYAP6fqZQe7CmVxzyvwa6Wl9LJHcwAgf913T2Pta8dDzhUglRy15Jdw3wb5Jk1FZXceLx86fSrug1+l87J4hBGOPcBVj04gaCfSsaRLV71ncClkvMDJClMWiEkBmRaUCdB9P9++jxyoFYxyfxzX7+I9VpAW0GLJSXCaiXLKeeMaSft8Fp963q0qs+BVt73MwrdZ/n6lIFdo9tV//9l1In5c2jOY3utUWGL9GuTDdX/Lu6LAxr6zu3WOLyHPpaoBN9Oop9Vk3RzPiwR5/b1rnUitx4DX2YcCcIA8BLiqy56QW7zHTWqH9wFgSINoYwfAAfYA7eveHFY5fj/wkV8NCx5z6yvcdfw7hs7B6Ih4ylS8bnkT8o0lX+4JkMd52C6Pe8e6aMtP9ldX/RLu+0B+SrvN8ymQp9s+vko32uVHuBSB7fFoJ6IVXwsHFhY6BjkpVBp5AVS0KEATNfsn23UfX+/H71IKWbkPB3sDeLvfOmyuuu1vrxPlVIuecJdhdR4fj+MC5B1FxQK/m4/niGdAQLr6nPzeQg7ypaYCLfkU7ZqYViTN9CCPc6MZ6SvvemMKebTNP37jdQdP33tLwADzB9T4+DJRLcBXgJ5pjmfnmS6e5UbpsX7OnppztNY8oMLe5nTZN5BPe5rvVp3ERyDPYXvsaAcrnnPuA/qIB0BP17xb7xwfz/HvBHwFswLe5NY87hEueljxdNmjSYseAYLXIb8E++EgT9BrpYvWfHHZXzMgP8JFD5Or/vx10R5fasXqrq+ZulugyHbfT+SZwdXbv/6Wr8v5fr7OlQF0sa2A3ZdrgPdKwmRRy2dn3aK3cfNxjHTSUznIN0nc9mwqiEImsZRXVe9xCfRV+XlcWfrI1il4xZI/9fY3pZB/4s0/c4AKAECP8fMoRPG+onJar9OPXwr5XWoK9M5z9TyyRX6OrfLzCHxp6QKuGFIG130FZ4EiATm9Sz9XLoc8zwHQA/CANlzzuC7+w5rnt98d7hD24/A4Hf9O0DvUdwn3jQof2+Vf9b3/W1RA2C6vkFeDZhr+6XDfBnq8i+n3PPIknlHpZR8eiTKf/WiXH+GSBLQLwVXP2m2t5daafZluc61Q0XW2nxeGPe08RmCm+/mxh1EGev7uAZ73ymMJ2Qa6D09T38I9WS36e26rcE/jULQA+Jr0usWar6CnlyFxU6+qFE7zcoP8HD1ZOlnceykkKZwbheLn3/D6FPK/d+MbogMeQH/2V948gf6Ru0slx+LXiWcD+S3A35GGqzSPePpZk59nl+RYhy/yMcCmH27hJ6Rj26KX/TbQ106Wcp3Qoyfrh2IU4j2403pHZ70Ywivj3rHUuO0rADU+2Vva5REnHSJcVe4hntsa5Dn/w07NaXc6Z3u9gPwYLz/CxQ6Tq/65l8OKR83Ze5wuLHktfLICKZl1jYVfJHyF0q7CUSFvUPN9/DiXFs6+jaLVuxfk5d6buGKJwiB+3xlgB+iZ2QO8BTYOuHo+B7mpuuhN4ap/+ERcD1aMWvRxvfJVPb9eV3GfCdAz+bGu5Lll0kIynl/pXQ9L3SGP8fKAOyFP0D/z4MciDS8s+ojHHNdaGEtFqAt5xMsgz/j6PczXOqT8PFtUjiXkqcjLZx+KL7LFnO6vvilc5zoDXEBxD2u+At4gj3PRc8CP5KhrXsUP06BCgH3RIZCWLj0NeQVkKW6rcC/H4By4b3yoh+3yuE4KeVrxxwL5kj7Ks2wgX+5vjJcf4aKH0qv+HXCF1tqztOVVyAvEvEBpJK5oL4DieMIoywy+r61XkPm517QoqHug93vZKr2W3xfjXKafveP976ztfjHcTaZgnY6frW2Hd08N7HnN8iEdVixwvtmil74H/gya5yGW777yc/l5d167LWRxDNJoBnnMgnf2A/8qthHy1aJHWnnorslzImOfPZ763Ou6JN0s3i+fpcdf7qO5n13DCre8lzXZOSKtWbs8IQ+Ltg4nozXfzIdR3lNHC8hz3n22cRfIAuCYohbuenTG48Q3nNkOYm9/xKf2/Jcv5WG5eHcmhzyF+8MQPUyZ6+3yDeQhddU76PV+k3SQSyaL0l725QNBY7z8CBc11A53z529h5kqa4/PCsBFgeKFi7vUFUCaCcwiUun6emyR79vTopAWTS7zSW7Fr1ruLr+m36dY1xX0qMkXC7uxMsv5Yj3imUDdFZDnNUsBpNcD6FGw0IJnBcDj3ZUXqFyXbUvUTT8ragrXFcjDikdnu6c+/WsBdYV8Bf2Dt0eBOr3TeZpcuvIZvyyecX2pGNZ3qs1XSRrIthEQ8Q60otWTn2sflXMQwHGfBS5wXWMYHUDvndAIxvYdJnETyPu11KLHc8dX5wBuWOr8HCyWMVYfM9fJx2XYVq2VBJ6vjc8ynXGbwh7vOio4MpSu1y7fWPIKeb4zvVctw3Zq+enZeDaP3TfGy49wcQPHxkeHu2LFK+CnTFIKKEu4LEiy9Q6hKuyjv3sWtQn763l9+xY54LFuATr5gM5hIV+fBQoI3qfe96MnK+jjgxkc6laH7rDyMU1os1Py7CvseT0sHz0ZkA/QS/v8FNcl1BZaFKKiXdt1vz3VQL5Y4EijcMkT8qf+zo/GkDpAHnrm9l8Pi14hj/2f+NAvxDnY434B99Kb2uPQxMchH3HruOo1TchvQpHnWKSjTpo6rCqoStqK/Hx2+qobIU/YEe6EXfsOk/h1RFDG82WloRgQbA6sKqCrVnuxbrWDnZ6vSUuexpq4Tr8J+WiuKUMI0SYPwYugTRU9yDf3dijItxVVhXztfDfa5Ue4GIHfjocVzx6sasVPteEpQROGywScyCHUE/Y1yPv/45YCHlpAvqwLwHNdUpA18mu4K5wWDu6X4H/4RLhNUdgG6E+fCvg21gqt+V3P1J9/BY9AqICezQOsRHjcUy0K0UOo86x3qRaMpZCHNchx8gA89OQHbqiAp7DOQY8x9ChgCfo4Z3LNXVo+59ldz3WeLnr5Z5GWVtLVLmmc5nVzJUkhD7AD8Pj8aoxFN8g36bBREk+BX11WQM5Qq/D233TJ+9zzjE+JO+X3vYzjLJ4DQvnGoXQQrPrUki/NDnMFSe5T3pm/y77ES8TnwbZ5tsuP8fIjXIwwTWNbhs2Zq56JPStstDBZJGgHUEf12ENAndfepQwqu66HYxbHJYVaIz+PFgC03Ip7nM8oLPfTpwK6cJ3GfNpnHrngbfQoGOI4KWz8mcd96TpeC8ewSeKRu+Na7Iin98kCrd7r4n6WhedWba5IrEhBBcijdz2mtQXgP/O3f/jgmY/cdPDsiQ9WwPO3gx5u/gD9oycn0PP8Ao75Oez2PsQzlD4Omi71veg61yId9dJUIj9Xc966vfWGQIAd0gIhHz3NZYKZo0Be74EVM3oEQwS8LdU1r3BfXn/5XiIdc31cm/EsabB4JXh/OsUtmhH0vnuQV9DHvSXPvH3e029/XxEfc9mjHBjflx/h2EO14g/O3coOd4Q8M9lagcOCZC5MRAnUXX6+ei5zp8c6b9tfgbxmrAWsj6KkYOs9GxYCetyc8Yto0T96ss7ZDcsebZTsDa+FXC10/FknauJRjgvQP3oyhtSF2x6eg2pdzh/O8YJpOk9S0O6SHJuecx+JJY80euZnp8lwAPlP/4NrGgveBTc9AI/hdQ76Ka5zmqmw0PjvECtLmtaadyFAmN9H+64W722DNC34NZfrWsgjjwP06NEOyKOSGTMkqjW/cNdTTA/LvMA48drzvpP03A50V3NN3LO9Ez7vRR5v4jilG14zjJezD9WhdGiXXwwhTNz1Dvj5fttn3jzr3vs0yNOjEZC/cP7a0fluhGMLzeQ3ZsUvAN+DWVGTyAEuLjOVjmT1uEvsrj+Ukgy+eCa9beLiYwGP9QRLDPEqoOdsYLDoAXrCXgu7WvAsCpe2UPFChyBCgYK+ACjccF0dP884VShrAbuv/BnWeO0H/NhfIf/oyQbyn/unr4/x8A53FSx6QJ4C6L/68V+OQjaeCb0dbjny3pN4TXEroMEshmUmQ38n9d10odBWBptrrMRBIe/yODrkARgOKQPkIW2XP4wlP9+fvV85lhZ9XSagb99B9szb83sFa7rmfN0K+XIt3DeaJ+iyxzNo2uWlcpPBne9yvl/Xevpu3oNAHkuMcBqd70Y4lrDLiq9u+qzg6agmcoe6Ax5SS2MD1D0j+fZMi4y/orV9NVMvpPtm26xg4P02kMZEOQ9+LDI/e/+iEIpex8WtPFudc2HvhbzHu8a9xqN0NsP6R0/WTn8B+gI4LTCbwmpR0K9I9teKg8bb47kqPVdx1yvk8dlZb4/PlIH+mdtunkDPjwpp5UaetYrPSNNM/C+gr2l9UfhvkT2vThwgff/T//b3cl/tgHdHbZ8m5GOK285scu07TtJ6TefLOPE+KtgKdFnO1Mrb4jr9e4f8HTSqcSpph1aztcvX78vj++7l64V+zw76eD9dwHfiI5qOt0lxMDNj+b48JiUbLvsRjhy8R723xdcMpsDaoSaxO9wJeGwTyG/VPpmI6hYAuwqIFaXHJIVdplrQsjCvPbVL4YtnhPbSM49cgDsxXKhfOFPd6mrhzK57Od/GZ8NzofIQHa7KHO/VordOebVQKsudimfSfthDr+//t6iBwxOfDcg//m0vO7jvf335wVdvfU/THp8Jn/zF8ss3va0BPabBjU8CV9CX+Nb7mZ+ZLl04pgG9gq7jdck1P7MaD0uv+vyWxy/jp+ub85cOiHDZo5c52uWb9mlxcy/ecTd96z2Ixcu2eWmC0vScKnnOqm4ermmQaiGP+8N9sl0ek+Kg/PuDL3yybl96Msp5F/l4qUV8THyvKeTR+e75Z186ID/CkcLU2e65l2fj4qeadckcklG2JV5J7A54tW7Mkvfz1PPZcLdaSVg5RpUWABdD9qzWtCgQxIVfQf/g7WHFx1ezXvfm2iEvwJtMBrLlWTZxhUUPED16sn7is56/WHrYt0KFnhYvhGthmhfICqNDi4U0CkQUrA+fOPjy6c/EuHhAHkPoHOi7BNCjpz1Bj3nwAfqw6MsziGeE+5f7rPfD912k6axCXvuTJCBw6fkq4O1ZTBUvyCtN8/F+LhePJeRxzwA8BNg37dPsgJZCnuDTtN1WUCIuzT5+fP9c/owzdSFPyXUd8oAqIQ+LXis32legF8810C/iYZogXyquJV7xzOfx8mNSnBEOH+bPyZ6/OdqhzEU/1eA1QW4HSJPY3YLncg93Pbf1xP1WM7qJ++5zTCovkDaoLQxmqwfni+dB4JfnD/CivRBf7sK3uAH+CTytZRSFz8Z3xH0h9u5HJ7wKek6zWws0g53Lzy9yGB1KfHYF8kifaF4i5NHLfour3gXXvYI+XPf3T+7aOlmOeS4UKr6EWPDP1rz0g1jpaHpUbXrvzf6lEvHQ5LLHu4erHqCPdIDJaNjzu1jzi/de08dSLQCn6zAtRRz0P397PLN1jL/Mb7EK+noNGZdu8/cT8qjcaIdj7Dv3TWrvu0L6EICP+DPPC+RpzY9JcUY4cggr/sL5a5GYWHusFnw2P30vEyaq4CbUFfIdQK8pMk7neKiXubeev17DMujOzNoUalrY9Qs+yAuERtWlWwrIMgQO4EUB9A//0T+PDkIAPQqHAIcAfus7gqbzF2u9gB5eA7RT4noxaUix3qIQbcBflJx3qxT+vXfYSCx5WFmYTOUz3/dj0SaPqWwxy51DfIsc9LDocQ1+o2AqzOd+DBF3czvzfVWYY5bBe26bmgcwKRHSqXzu19PamvQ5edr3ffcR01ekyeLNoTUP2DeQbyx5pvF10LdgFzEO2bo9xPtXyC/SUb2GQF6seUAefVLYLo9Oh5wjxIfz+T3r/S3ysbzf7D17WnLIT+3yY1KcEQ4ZtLMdrfjGNadDRZqMssxomZqE7m76jYWUZ5YQjiH8Np5nqxbXsoyaygqvqeCfCxQWfvVZ7igQZok7OEBSXLSnT9We93Df13b68jW7en0eu4jvDGUCiftVOAno49z85j0rEzzPMUO+p6bQNsgjvQLyX77mVdFx7ol7DwH5224+ePITN9XOeJhcB16BAP0jdwfk495ZAJcOkBDGl2O4GZfxNUH2rocK5OtnhQvc497FS7ZVU/r3tLIjja6IkI9zlHZ5wB1CGmBHz1ouNJ1wM9h7Om/d9n79o2o/yJf0I00PuC+Ue3h3hDwrN2HJcxa+jsu+vb/lO6nvOnlPi3QtlY/aw758rMbL7xFG2BnCTf/8uXfAigfkWXPVtvimENKMkmQ2V03UKJT8gyk74BzHsc3el1ZohOxc2fmz6+j1mjgnGbLKCjEtPJaFnEBQtq0VCHrd+X7LktNxPjx9mxvtprDqAf1w39d56AlivUdWGlooe0GjoIcLE5YdfsekPNoJU45p/l9sibse8cI4/1u+43tiGB2s+Cd/571LiK/ptpsnYdKcuz5x8Psf+lDVp1//tmi+gEcDzxiVHk4HDAEMFex4Zkxz+n5Leif8mR8cRmlaEzVpO0kv2fFrab7uI/AlYAh5WPO4P5QNCqE5LbfAW6b/9vzHLc3fq5CHJE9Wq7lAnhY72+V1elu35Om9Uc1lUf5OsnWMs8ZPrfmoZNSP1YzOdyPsGWpnu4OnHqSbXq34KSOY9emZpiNPyCzU9rHk636aOcr/6RpL1+XiHMk1uvt2MqPfixdgWnDUTFoyqj632bqf5dfQa7XxmTvm8FwoHFBpwkc94Fr8ib/2suq+j0Ju4VK3ey5gDjDRmuf9Fbc99kEhA9DTogfoOQUsz9H8PgalBbRKClWkW8AYs919/Z3TVLabIS9gJ9zxDH/jDR+Ob6tDbKNF4Q+rlmDX98x8MlnDVtgz7WPbA3csLfpI03M/jCatJarpOUk3noa4P8+NJZ9tW7mgJV+Wj56MNEXI893Hc28seYd7H/R+H4eVxj+eXwfyflxI8mrz/qRdHj3r8b4xhz+9mw3kV1z2DnlcU5f+blzT829d9rjemBRnhL1DdLZ7+mvf6p3ttC2+ZmTNIEnC3KJaMCngDfSLYxzy/L1HhyU9fybfvx6XZVQvtBaSDF9mkVu69/wYQmFZSDcqhXrEpfR2nzS3ocPKxGc6McwOVme1vKWdPgo/a1POCv3pOvzW/F3VdU+LXtvom/OV6xxWWVx4343EXY82S7TDw5Jne/xOyGMs/IkPHjx776cC7IA6YU7hPyCPbRAs+niemFecYC/psXas80qp64E7ps58bJ8v6xf3l8jT7uLcmWx/fbYLyJd0GGny0ZMBdlrz8X153jeVWLOtlmk9lNzbPlKQQywnfJsfF5K82kC+gBtGDt413n8Mo6OrPrHm9V4zwC/eQ/Ku0/+sSBXI0wCbOt8NyI+wMWQz23mbWxTiWhhsyKRM0PHbC6Ud8nPVRM/zihfA98vk58/kxzTHJ5lyUWAR1GWIVWRQZM4H7jh4/xuui/9TgTBvb39P/3uFxBQPGeKEeKsHgwXVqU9F4cOJc179/T/Z9L5n7/BGcl98x3pu7kfQ4/wKerbR6z0tCle7zpp67yN7D7WiUyCPeephyQPYAHwX8sUtD6s9PsbyyvcdfP9Lf7FCHQU8LHlsU5c9hAoEJtmJoXWP3D273Qn7xpLXjpMC27DoT0zj8HGesj5gRchmhb+nXT9vts23dyA/7Tv37o5l+aYBIQ/h/SvgqUW6srQ9L9vyo0lreygDfFS0drnqIV6/xK9CvowYgJGDyg2mtgXk4bGKicEM8GsVd33+uJYu/b26WA5E3Mqzpnd1dL4bYXOY3PTTt+KRgCgdNscEGxnm/t9uP68qGW2RSM0630dtYm9hFzoGyPs+rt59VVmGrhlbPB+A/DN3f/Lgpp/6e9PvL5Q29Gr9LAu+HuT7hYW4V3FvtOgfuCPADsAD9HCz06pv3PeJ5a7/47cAnkucC6APdzXnuSfI3aKXAv2wintLCkeHPACMjncA+RrgYb0DrpjR7JU/9PYKdjyvmNL3zt+qUEfFAfraLTeG8BvXgTBlLt9lhXuFev89hkoeUbe93p+/l/ocVDiPr5NnVWVp359jPT/hUp/vNDESKjwQIM/+GNUQKICcYbcmyzPHAPk1wGfPsFGJV62s8Lv0X/hkeMTYPIPfgHx8CrdryWs+7ufbLarHCeRpfI2Z70bYFGY3/dSbPnpvFiueiWoGvYwDls/KaibiUjNcF/TZNvmfJXbNLDszrmcYv754GHxfVfc6XlBVTRm9Zkq4Ne/6xMF7/+4rA/Z4vuwo1xYMUghqvCvwpdCt4CgWVxTo8z4sqKIHuLjv0fMesI/hQGceuRD3d89ti/tcvM/a436OLysJOHczz31NI+U5aM97f4Z7arrPOQ0QEPU6peKBHvD4KA0gHpAvbe1uvQNYr7lmgjt+E+zcD73rMX99LG99TwW9Cx+zCXd7Hboo7e6Ir1rxLu53b3HbA/TFmp+f/+wRa57Fmvw6vt3PV/ed01tNc6WyCjc9IR8VO5YTAscmHS/keUXeIeX/d4jP6WiQl4oiPRKn7oj8g/QEK54fqlmHfHtf/g5wzuxdrimOk/IkmlDR+W7MfDfCrlAnvSm96dnRTq14upaZiDk+OM2cGdwd4irfx/eVgqlmDmaUlTHwu+QFXPbfj4n1XgP3gqpqhjyeGwoJWIJsI0ZlKnWXqxbXni17jU+si2c1Q7+F/RSfAP2Dd4ZVj0IabfWw6vmNelYGeG5Ceu0ZoyDkfeAc6IAWHbLKjHtxTWn/z9LLkcVzJpDHkLfUki+Aj7bWn3pnLPEcAK1w72PYXFHtZV+0BvrYBtCXytX8Pkohn4He88Bdn5jc9vAMSBr338eler4mXgL54h0JlXZ5Qj7mTOB4eRHTcFuJFcjru9slf9+JFuVN0X6Qn+PMygryLiGPNPKTf/Fn4p7XId+CfvG+IXn2W4RjpvO1bfOj890IO0PWDh+Zlm3x0t6EhA/3HAt1QkATo9emVwHOdbrPippEn6zbV2vH985fMxv+e2Fk0lr3fzrzSADnzm/7G7FUyOcFIQuKnkUvFoEWyAb4Gs8C5Cjs7rmtDv1CWz0n0AlvA/aRL6XpdfVc8/1P8a/wKUPXAHummSmdEMB2DrHCXJo24tydJpkKUTZVoIB+9ORkWQO+sMZpyRdrHhBFEwO+kw63PF3yDdDF4u9CvwP6yXU/x3lRyKtwjw9OoyI4MQ49CXGeMkFOvVdJm55HjiSPl6QjWrVYwpKNjneln4J6/GjRKzA1TTfpsqahHWre9RS3RRooQNc04+kptifHtvERyJe4R2Xt9Km4X0Aeywr57lj5Of7+XCO+nee+iI/dd/U0FMg/8/n7zo6Z70boBp2bviZYzmxnCRdLtMfB0pmHSuUZMRIlMxsSJhLyRpCrpsS9bKOLzCr7cJ3v53BwSOjxvt7PXc+/UgDN66dnwwIPzxaFBKZYPfWSl8Wy9kYvHWq2ykG+LukAx2dZ/vPagD0gBxc+gM/Z7PD+adk3zxbHy+/ZozP/xrFIJ/Et+lJYxjl4H9YUoM93UShrJdCgP93T/F4I+XhOaD8GkAvkG2jf/utREQGgqmverHXff7FtC+hP3jK9B+aDXeJ+WN77qep1WIDe8ofnm0PL42PpKa5XKvqEPJYLd71BMjvPnIY2SPNmiVtzjg7kcU/Y1qSn5Ng2PpLXijUfeaXM+AfIxz2ffSi15On1VC2fqzSb2Hreo99rXZZ+HiyjsRyd70ZIQwC+zGqngKf1zmFzTLhIxJy9qym0PZN45rNM1SRsdY975pcCTNcpEHxbrMsyewKH3vFc79t4Tc/AfmxkapkKNAqJs/eHlYgvoWGKVXQGw71pzZ8F4k5pPBdQl4I0CpdSMGMde/pHQTFdK55lcafDqkehDaveYY9j2dFyfg5zxzooCkK12stQPYB+/gSuPccO7JtCOXmHISkYY7/iYZnu9US8vwXkDeDa7k5Vt77s1yx76oA+3O6Ik8U5Vdmn9tBfAz3f9XFa9B6fJF3Rklx0vivNMw77WOdp0/LLJtU034d03INWABPI7zrHdD2BfEm3yKvII4A8x8ofC+TtuXv8Fsfh+dNjUq7Jme9Gu/wINczT1p6/uSZUGROvCZZSKx7/p8J8thK3SjNhU+CnGbotEOr+3J5Aeg0Qvm92fE+LuPI39ym/K+BLYRfP74nPXsAwKwAe4rAuPGsWJguY71K9bgG3wH2xb4jr5zizIKa1zo55KLxh2UP4za/bYTuOX8Ce9yD/43zF6gPoFQRh8a+Avff+FpKCcXoGBUx49hh7TuAa3LsQ3wVyPyZTAvoYe89OeD3YW+e8Coe7PtGAns+NgD92NfHqQP70qTopDjvfTTPfCYBWIL+AveR9pI3ZO2RK8mV994w/vXblf5POyrcBNM2kKvlE8yXb5dG7Hh3w8LuBvJWXjPPiPcv1F8+7/G/uy48plXVCfrLkx8x3I0jQCW9irCcteLHiI6Fqwi1WPHQUwKfamJErVPbQGuDXxMJB1UKtrE/iu4B8ebZw0QPwp/7Ojwbk0fmuTgnKwnAf2POa8nuCfIGuNQPUQlULXbtuhcejJwPsKMgBelj3mEwH/zPgs29BPX+x6LkeaQbucUivxWfqcN8JeBR6Csvama14LlD43XNbDnlCOoO7w5vb1uTn7oA+IO33YGCvEC1TRldwAfSMz/1zBSn2d0hvUe+4BYwc8BO88Hx1Uhx+tCXKD2mTD9D7ORzylv+ZnrqwT7x5kKYlXd+kr70gL3mndC5FuocVjx726GNTDaKkzGR8l89UgO3PX95DbM+Oi/O2X8sbne9GqKECXnrSK+CrJZ9Y8cjUzbSloSSD7KveOWS9Fv74z8y7lllRkHL/faSZTdfXaxOeWO9xZ7uwWDMYr424wEUPwOO75oA9Ot+hkhWu7H3g7vJ78O0hu8emsJ0s7qkQL/fKee5Pn6od9GDRA/T4+I1OZ6vt92HhywdrtGDGNVBJBOi9B/+a+B4XoDdY1ndzanKtPnvik7shvwvWvX23HJe47yvoEWcsFfIL4M+WW+x74oM1PpPrvkx/64DYIkIe16nrlkBxKEc6LZUovEvtfNf0sNd2eU9rOyAPrYFe00bEpcSf/7ls0ntJKwH58vx9n0bMM1IBDsjjc7vv/+jBD//AdVHZrWWlWfIa5+UzFWAzfov3sw75poxpOt8NyL+ow2Ko3BOfvVDnYFZXvQGeVryOf65wySCzrxyUJi/0ud4zSrPNIbArU9v14hwlwy3W0yWO9bqshYJkQPRpgKv+lndVwGMJyH/+Na+N586K05FA7+8jseQZ97kAWVpVtSAu0GEv+/hvwEe7Paz8DPi4Xm3Dt6/Uxe/y0ZZ4rmU7LFR/1/U4B7u+Wyz5nvgOYOEAij3IZwDPtvk+PfmxKo1DWdae92uQr9+GmN5l9LyXOOnwunhvDopMC+DukkG+pH2ka+18B6FsiH483vlOr5fEo80/fWn+3iJeK00/Vh4055ZrMk9GZf3hT8X9sfMdlvReuMuekF8+z1m9+E7Ppy3nuIzfjJuUMRDK9dH57kUcMsAr5FO4C+RpxTcgYoZIMthWZYnZ5QV+s71kpEVGRoY4BORZKMT5bCISLqeCzio3AvkoFOiqf+REfCgGVjvADshTgH3sU6B4eJXrRjzkvy71HlnQeKGvkBF4xL3L51ERZ8AcY+3p0gfoYeXzE7Qcd88heYhHPQeeqQ3R83fM578onHsSKOFaYd0AiD3AO6T3AXpPfg1XBnrGuwG8vA+FZLHoNa7aGW8BdL5ff8+NlvBppd9DJ+Sn9I20rZD/0mfvmvuYqDUv52P+UXkerHlJ//s+Ik83mmePCnnmH6Zh3B873+GeOQy2gt4tec1viTQO2yAv70MseWjMfPciDgL4t2SAr7XRTNI2u4BRZIjEkl8AaHdGnRPxnPg909bC3zLAIgOLmsy7Q/X8VlDq9umaYsn7PWinGBSEcGOfeegCZl0j2GnRo6c9Cmu8g7iudFTaW7i+r2MhlcWTz1oKFdwXx2grJKZz23MqkMb5CXNUApFOAHpAH0vMgFe/zFYKI3+faumHNV9cqvFMZOhjqqbQlD4HgLyC1QF/VKD35NfqiaAvQ+zqO4k0IP06ajMKLeM7Aux6LTRLMJ3Gvg51Bf5egC95rQB+io+AT2a+I+S1j8kM+XItSWe9eHg6zcQ04Xlb05Tvv9DatazMavLkFz4ZFdyf/qG3xaecK+R77vodkPf71vKmrvP9pAJSIQ9Lfsx89+IMDvjoaPfEZ2O2pi1WPApvWGbx8ZE6VWdJ9Exwi8whgNEM0wPjSqJ3IHB/bov9PQOLPMOvKc5ngO9CPjm+yXhlxq8A+D23RXu8WvBsl//8G14fz3h+XhdLbVyb5437TAo/3jvvu96/PJt4L2LhV5e99KoH6CH8Rns81iNOFQACIZ4P/6PCwXhpHK2wrssS90i3j9w9D5/LQE8Rlro8Dvl1MjWgz1z283h/BU0FPc8Bi75UFmoaLgCtlbYF/Jd5rqsalxI/GR6Kd8phdHRft1a8NQOFcsB35e9cpGnaAc/tfgzTix67kJVlfP7sfIfe9WiugjerWvIZ5He47BkP/c3/+nuWWPL09JTyJtrlR+e7F1fYAnivgbqi/fWDvzlNe5pamQbxBla+XrSSmDWzKeBjuxTodRt7zCYZeVOGlms54Am6TSr3roUyh84R7CpAPibFKe9g+Wz3kT531/zM50K3PM8KWIE9Cx6r4HA9nxO38V3ENgIfBbhY7/jNTncU51yoH2TBmHD1JPA93//b80xw/n4RJxZ4jHcZ14y55ruAJ4gdzmvyc7i27q9x+sg0g16dNIeQ5+9q2c9tw3U9LXpWFtADvzy/Bva+bKCxRQXIrIQI5PEe0853bsWXikJzPo+LvHOopi/P16JFHtT0muyvacePaaTlVHnuWBLymN4WI04AeS8zqTnP+fMs7eqSf3Q/X+f7MW4N5OfOd+8YM9+9SIK3wcNlTMDXYXOd8Z1VZYYnuuqjIO8BZPHbt5skQ3kG0MTumTX2F3edb1+TXjNTD/IEGkHWUy38SgEXGf2rn7tw12tfl0Ie7npAPj4v6k0heyl77vn2RcGqIuRLIaj33pPCvxbS5bjoXEfoEzDl2eA4uuaxH55BDM8swI8lj5ORFKvSCYgwReyaFU8IO5i3KDuut24PxVh6PPuAZPu8VHyvsR/a6HF8udc4R29++wr65NktVEZaNEBZQl572MMYQLkyebFKeoz3VrwAa2kPyuKmaTIR06Cny7husn+TvtdAvyjXpmcOyOO+USbiuw+Hgfx8bpPHIakA6PEN5Nn57uD8zWiXdx6M8AILPkwuwF4gj0wYvzdY8ZzwIlz1gFAk/hkeU4HDTKEw2aiakJNafdaZzjI3xPbcOCbZLzsmU60wJIBnodkrTEJxT8WVSsiXYYnqqleXPQD/xJt/5uDJj7+ntmnPz9VBvab5+ku127LnXMUClb8FsK5aIJf9a1t64yKetsc2jFkv+1SrvEJnev+Ee33mdUwzISETxJgiTgKfuE4P8j0oXwzp9bZIOtNN6SiH/XS/5T+aNjBT3wduCOE307tWlHr5bKF6zTa/zpXYskSTiHx2FpD/8unPTJAv70OPWVzHVeNp/5O8rMryJsuOiEdyDM7vaXohzTvxf4Y8PJsYRlfHylvZuda7Xp9pI7++yY91yCN+o13+RRDmqWploptiwRPyVR3Ix4x2WzrcLf5bgvVE3FGv8FmDPDN1k5mS/Vyecag1wAdwkoKkUb2fua0ZVjyGzsFi17Z4COD/vRvfEDr7gX8VkMezbwG9Rf48fVv7u3nOpbBr/lNSCPLeVXW/2gtfeoiX9nQCnYDH/upyrxU0AVJ00iP0y1h9bPO0USUgiXSA/4D8vbf0IS9AvSzyeCSqVn21ntVd31r11aL/yE0HX3/nDaGw6gk5TctJPms1u9I9bc3PearMxnA5++zs3PmOk0HNsF9ey9KgQz7Jv5k8b2r6jPv3Y7YAvubrpLx76I5w2cNd/7lTD9Xmtq2Qb66vz9ivbYrjFu+kteTHpDgv4BDWe3xN7rmXYygFrPXqoi9LHRNPK7ORJFYkYnS44/jnyERM5Jr4PaHuq5qAk8InyZxcHhbyEI5TYPG/g90BrwWJS60bZjwMnUPHus/87R9eQB697b/yrjdW4f7x3JvnvEn+TH17u1/6nLPnbesbsCfPM36zs5yeT87LbYu2dZ7/gTsC8tE+z05kMi99T3FfeP4lLeL5V8gnAG3kAL5U8ngwLg772lavYC+FO8Q5CfCM0Eb/kZui4ggPEWCPfg6xXS16BalCeIf4nKtKWzAMAe98xzgujsnSWpbmevsk0vxJRbpg3kyO0e07xXwVv6e8hPIRHe9QwcFv7XynPevj+n5f5dpNeSL7r8ry+/Rc51kGxxfpXqBBO9hhDmO4zLQNHnBvAO9t8fxtkGeHO/yvCZ2J0ZdZIuyt00QqloNnhCxjctmAF+fxfXeoOb7E0+G+C/JTPHVoUclwxVWPJYfOuav+i2+8toE8CviwQFFA7eWu1+fJ//190uecPO96j/K8/Bkutum5kvHJmTXP6/I9Rv8EuOxRePk5RdO9yG9CPtLXXRMw1yDv0L1c0rh0YB9WfUyeM1ttU56cm3Y0H3ztlhsD8khjX77pbdN89/oxovJ+mmfawJzNTnO6rulHgf/I3WG189vyKC9qD3tWAjLAU5qOdD3ilqSzNWkebdKjeQZiG9ONllu7ZM8a5eP73vPrUbFRyDf5sSknDnnden1ZWp6vz7qki/FFuhdQmK33Z1+KFwtXDQBP653qAt5BX/7DcmeveiRgFii1MC2wWCTEnhYJc942JXwDT5KJa6blsoA+2sh8vz1EcEfmTwDfg3zNsPpMSm0av/EOMDe9u+q/fM2rqqteIf/Eh36hHjs9s8xNmCl5tr5d3oEXel4A8bnEPSbPa6ekIFts64jwQfxgxddx9RpHP79AvoVRmR3Ooe5y2F5J8viV/w3sxYrne47mj9IEgrSHPh/s94Fjmb/ZjNIAuLbravrhb0k//qzx+eQ77liHvKexHco8PVWsACRpLM2nNkJEt23VVJGf81SUFfKBHpSRcd7yjYb6vBbnmfPGFjX7Wz6eJU045f1Fu/z4It3VH9DmUjrXhfWuUE/h7pB30Mt6JNra4a60FTMBKeT3SbBNQZFk7FSauXVd+X2ckId6oE8LjxrPuYMSIR/P6+xDYcVnrnoUvAH2G/9Z67I/MVlc0/PSQrYnz/AdyfNfPGOogL/e21Egf0gxjnie8RGbkr5qgW/vvkrcyHqPC6i7HKxXkdAUERY5AYp0V4YaOuiRBlGxjCWserxrNL9xmCMgKOlsCXqDfUmb0/Oe2t9RKYt2+Q/+5jS9cfk08VxWJGmupyRtNLL9NZ2m+TSZ58LF82SarzVPtMTnRENonueibC8Vg8wQWruWS++xyc+NWsij7Cku+2sG5K/SEHAP1/z569D2zo/MKNzprq/t8hngO0KnOyReTHIRFQVa96VWPmVadbEvE/JCljBr4t1VAGjhvijop45ZAXkUKF4YbJDH0yGvhYYXHpoJaQXVzIYZ4O76RGPF67z1sKwAdbXmAfwYL83vscdzc6hnWj7fheQdLJ4xZD3o/TlB8WyS9ceiEo+4RhlPz3b5ul32a0SY8P3hPXCimDUl8LzUirn1aaGLdJ3uq+sC9PfeMln28hzZ0XHyjNx1gDka4DlCZRNfPox5GR64I/J6rSiUntlc9jWlSd2Pw+gIeXbU3duC9zTRU9nf8y62cRnpgBWAzuiQ5liLi2+b8g2b5fg55flzu/NHu0qeXYH5dI15giDf3pXl41nlPSwhPz5WczWFyS1fLPcL569VuCvg+XthvW+EPBJr9M48OHfruUcf/Eyci5OZVIixfa0FfQN9hUuaMFeA4xle//N3ZLy7onAB5DdZ837eBPJuwcd+Cezr/oxvtSan59Nz1VNqvSvk0cu+Fhbx3JYFbP57XRHnXc88kxec/kyPoHq+5p1Oz7D2svfKm8cPUvdxSWsBQoe6K4HuxZbDfCF0svN1pgA79oMAeFRoZD6CJq3e/9sHX334oxX0p17yspiACVY9nnOUG8g7Ank232XAT9c9ejImNALsqDj+YkBe9tc82ORh3zex5BfHJOdciuXadN8cSldnAy0TMDXnlbJkOq/O/reHkQRJ+l5qhjyNstEuf5WE2uaOIXHFLQ8If/Wxu2I8qlvrOwGvoDfoA/DTGMvz10UbfxljH4AvX5eqiSkBu2sLgJYZSTK8rWPtPLYVy42Qj3MBHNnMd9m5i5iBWCjWbRss+Xo+dRNLezx61fPb8drhDusxltkteejxG68LKyyeXc3Qu5/jTknhsHgeK6r3Wp7LcYBen2WsS66J5xgu+7K9vtfM++NtxDo5jIP9EkPeAb0QYb2HCHm14vl8CHk8C1aU0PEWw9owIROseID+zm/7GwF65HuM8ybAKygK7H1ZPXoV9tNwRX6zwCG/Oc0l6SRVzzou+bXOv8DOnQLYZv8VyC/iZGlN8yPuncOM2Wl2Sr9tvDwOi7IyuaeFLB/PKpUtgXyU5Qfnbh3t8ldoWFrt528G3NHGC7gT2pvh3hMB/8iJaWwlEsXzz70clQr21I8ONAXw+0J+Ar0nyFaLzM7M5et0PZYlszWW/NqxJs9AtHocYg74DPJxH+xkhPsuzxWFqFvwtOLP/sqbF1Y8If/F29/XuARn4NuHZpLn2ZXsv/YsfJvuw+exKHg3Sp9f8zwlXtzWuOzL5249To1KoRrnuYSQJ6yzdUeB+TMPfiwU/wFy36dY8GHFF7DhGXHJnt4cBvudf+LPH/zc3/+pABLS5SP/03dW0ONZY6inW/D87yLkuR/KhTXIb7Lok/TSKMmzTbotXjftsKdDOX3/5liPSxKfun/JS9O94/9dkdfRtIl7xn+m6ygL3DMoFv2s9fj5tRd5u8RDK2fQZLBFeT4gfyWEYrGXYXDPvRxWNMCOyVQUzArzvQBPy13VwP38dbg2E0TE4+D8zdivdrwr8487yNe0xQpNM5j8TzMjCv4Hbp++b8+x5QVEi/Ml51JFpmRvYy9cijLQMx7Tfc5tdXheKOzpqlcrHpYUrXgFPC16/MbkOSwkpkwtbvkk/v48U8l+/ky6z1i28XctwJJntEt8bvWZe4UJhSCvi/d7z21zBzyeJ4mfWvLh6sf4eAd6pgTah9VxQF2XENvcu4KLHiqd8Cg8B8AdQP/X/+D1B3/xv/kfDv74H/ojAfmA+Z2/NVVAX/Ky0C3f8T0Hv/+hD00fWhH3fVUxBCDO7BaT4NDKL9tRmSDkp09Sr6e5qiStNJJ9Nc2oCHlVhXxiyTPNNelvR3xiX94PPRklv6McQqWUkGfedcCviXGpFYROeaXx0Pi4F2a0y1/CUC1zWMgUgApLPdzwz708LPYA+9TWHp9+dSgfUk0loFiZFe6YGSm+P9wmhIjbwblbcUxAyy35vWG/TJi9AsAzXk3UWMc22gfvjHZAQl5d9swoi4zRETKYuvlcDvjp+oyvfJmrVGrgqkcvZm+Px/LMz74xxjAr5GPikgL6aJf/lTeXceK05ifI77yn5NnW9WXpz7r3zH1b/S+dmvh/i/T58VoN5FnY8ZxYPnDH3pCP9AlYOtAzJbA+rPaBvAN9AW+44XGvuK/SVIbygF61ULUk5wlpYp9iuSvcFfJwzUcfmwfuCNCjOQlWPUAPd368A4zIUatdIE/PH+OgkFdLHs0DtOCZ7rrpL0kv2ftepHdRxNuPleN9f9eW+MS+fOaa3kqfhEirKBd1jgmk3QTou8RjPZ6NtAyVPhV8HwH5g9Euf0lCTDNbrfNzt0566kG2rz/79OMXwmLn1LMAaxn6tpjE5ihyuIvl3sb3d//zadz9Uw/y2ObLUki4Fwnyi4TMDFgs9/iPTFfcuYQ81ilEdgKR5xbAqzyDO6TmOJcvc5VnExWOMw9d+PxrXhuQ1171EOAPyHOOcUJeQQ+X/Vdvfc9ckEeGttkFk3vpbpN1TWFmz93/q3RbA3kqKRSzZ+eKcxPufp4ylC5c9s36si/dwAb5nZY8wLwD8nTBZ+74FOobAE8XPEWg4ze+UR7fKX98+uwz0jZcwL/yr3/p4Dfe9Z4QfgPe73jTL0Yv9vjE6wd/Mz7hi/WAONzyADoFwBPy2AfWOjriAfawttlvBIL7HrAP1zOnvzbYcxrbxqIvhgNnx6yQjzxRQLcGeX/vIk+Ha/JjNa34vvWYJO1341TSWqTbuJepHIzfp09FWo1e9ozLIQGv8vg2qmVo2x6PdXg3tY/VaJe/+CGgGXPJT1Y6gK4fjNG2dYU7lnXu+RX13PUxKc5j901gj/aZc++INpqAe9+FM0H+3DXxYRsMocP3wWlF0IrfE/KUA75mFm73hCyZsWY0LB+5u7HkvVexH98TMpIDPoM8tIS8fQr0wdvjeeOe0JPZO93RVY9Jb7CkRU/IE/RQjGfGdWuhshHyO7QoyFYKud76VP687Dz+bvQdNQUbn3UZw10/QUsPTnkmce4C9wnwpRMY3slaz/oE6D314B6/cS5p88f6aoWvgB36yoMfDNAS6vgNQBDkr/7+n2xAva8IdhXWv/8N1wXk8WwBAOZtpDWkz8e/bep5D9D/X//o5yJ/wb2PMoiePIV9teyLd4GAR8Wjgfwut72nHaafBPKapuo6P9bO4fvP5yqVj146T87HvNekvfg/VcxiRAjuG/szTeM6CcC3yOPclG1sLhAXPRTexAL5KPtHu/ylCZM1P81KV9vaUVsWyDvg1YLvWfMOeIAdmix2eAvO3xxNAVNtDk0FO1/2FNfz13GIHl2FrNHTfewA3yIHvELeE7SqZjwW9o/c3VjytVexZ4QVIRM53HdBHss5Pgr5eegcrHB31UOwmrANcMcSsFfQY/ml699aFS77U1OnQoX81vvLpIUY/2fbelrdlwVrcoxC3oHfFGzyvLktCk48a55fCtgM8hXCPSVAV4irfD3eF6Coqt+Ctzb1DO4KdkAdQP/vv+lbN4H6KMI5Y9KWsw9N7fan7ggIcIQOnkv0vC/pFePpAXt4CWD1w9sYZUxpGmOzQcC+NOlllnzN36yYbZSn20yePxeyNOnHxznYdp7EwY+v52G5Ffc098eB4AVh05oD+zDy+DZxr+m/NKOKFU/IT+3y569bM+pGOMaw7Fg3WfaoKRPOtL7XxH2QkfS4xmJvwB79AXbCnWGaJvfcO1AgoACgFR+QL4n5sJCnHPB1fZaYZX2FvLjrWXOO7Xu0ySMTOdgPB/mS0U5NkIe7HYWkuuph2WOs8lc//sthAaKj0zN3fzJ6O+M3pgT9jTd8uOrTr39brMe5OdmPx/+wWi/0koIOBQ6X/L2neH5/L16oLZ53ec9xHm7rQD7S59pMdwnUMyng6X7H8Zj3AFDHR1+iqeV9756+9NaBulvuyEdIr3CrK9gdyBdLhDVG6KDsUHHyJvQZiWala15Vrfr3/t1XHpx6+5um/hHF2IhRPuwfABXIqyUfln/6rpZpyNNhpI3EktdtOyXnxlIrliGpOHt81tTEn/cUZZNY8/q55SPI77t5Bg3kpy8CIg/g2XNIdOl8947xsZpLHGpHvAp8jEtne/3UTq+iJa3rwkoH0KNnPNzwOMdzL5860W2z2HuBPesD7sVVz9phBfyKu37KNMv1W+QJecqM03Iq9FvIR4biuqLF8R1FRvKPpXTEAqJmwMjkbXs8lsho6NDE9njAHb+xDoUkwI7CNKbDfP9HD/7NK993cN13/9LB97/0Fw/+l7/8plji/0/+xZ8J0OO8AERY83wWnNwmuactYsGXyQu0kBc+ul6XifTcqeXusmeO+4fbuHHZs3At7mB6lpA+o5LmcN8B+AboJrjfab3zE661P8X73j0dW9rXHe4U8g8KXsBdwf43v+FPLEB8MQWvAZoDYm75M49cgOse4KexEJ3yHrtvqsxc86oQgA/Y07KHGx/wwLHV8CiQx3njQzV013NymCgvZsA75D0Nrsnz5ao2XsPLoNBKmp5FD0XZvxhAyOdx3vpFxuNz17tY9tCSx7vBXPphCMp4+cKFQzNhhCOEOnSOve9jLnpMRBPW/jVVU+/7a6b1z740rHS8uNK+vq+13gvafyBq9x3IuyWvmWU183TE8y0SMd1jCiBkYIN8HUddMrifJ1NkJC8YKGa08nsV8qXCEwXep38toA5xznr8hhWfgR3Ln//h91ULHv8pWFBh8X+huEjNIs6e11HlBVmsq719O8Cvz2Op5tx+rDxf/c9Klx7btHXi3GLBz7qjP51tAvce2HU9YK6AV9DHOQTmnHWR1jtc84Ah2sIvJ9wpjQM66KEjHr6FjnZ36D9+4UxY6Ig37g1TL9cOo8WyZ+e8qICePhXHoXIAjx8gT0seFbPW++eQR75fppE1xf6eTzuq+3cqmu15tSwSgK+l6+quL/uK234ul6YOwfVch5XcB5e1wmyQB9hZkcP7mSc4wzz2w2V/RYUZ/rl8/+MKAfn4Hv1TD6K2r5BvC9Qc8r7cIj1fngFtGA4yTmbJayGQFB6eweu+yEhaSHgm4ydTa6ZjYTBDPtoqz94fw99QENKShwUEax4AB8wJcPwH8AF+KM571ycC6rCkoM/909dP84zfO7XLE+zZve0ldtzrdOBrCrNsvRdAUhAtVdJC8kxD/vz5u7zLOLZYR9P9a+FWgFGWAZTyPfUF4Dugd6jHb7jeb//12uZOsEf7e4F+nE+GwnFCJgiAh1sbcWZvdwfulSRY+Hf/zqcPzv3BkwFtWOGAPe4r7lcserXqUQlFmz1hj3QcX6P74G9O+ZJTYUsHvCpCcY+03OTRFWVpNv53PGA1jRLGWj5pOnepFc8yoZQHYc2jTLP0figXvtxDvXbNG3PHO9wfymz09UBlC7/nznfj+/IjlBCd7i6cvzaaCQrkWSPfCnnNPLOmAr85Rtrk63mTDDgfPydwQj4sBoe8LP189bxaMCAj+f9EcVzNeAr6ydJGwYjvd8ckI8VV/y+/+8cr2GHBK9jhuoflDz35O+89+Nrv/PLBkx9/z8GXPnRDzGEPsMTX6uAWfvRkY81nhdVW1eeSwN6fdawTt6E/Ey+I6nMqz6aes+zXLeSSwrqe03ouc06EGfDFikdhl42RT+CeQR7vgf8V8P47KhHmkifgo9f8Vz8XBS0t58tlue8S4qVxQ3MCLHvAHlZ9uNzxPD9yU1j1HDFCcTKdmFjn7W+KCipBT3f9DKDWZV/zfZI+XZoeF2mkoziWnXvl9yLfiHHh5VMjT6+R5qVsKsBnE5Nb8zg/tiH9NwbDFkk5ps8h/tdK1NTRDmU23PWw5qOzZBkBMcbLj1ADO90B8nTXcwKMKaMK7AXsnimydT31AK8ZdJHRH55m2Eohb2LGpss9MlmyX5VnsqK4p8h0Je7VMpnckece+w9R4MHK+bff/5PRrg6XPCx4WEooANFjPgCTAOj37/p3IQU9etmHNX9XmU0LzRJSiGkBsKZmPyv4lpCfC6/FeZLnwmfD7cvzdApJf+4U32PxoPC8dWIcseBpyTSQzyz5jtxVDznU9Tfa572jXbi3H/xYAB4FK9zgV7r1rvJKyM+/7s0BecAebbvhmTjxwVrpZGdSgB7D7jgXPtI9KgKYVCfS+mPTmH8FfYU9836SVl2LvL8mAWCTvjPISxm2WZ6GcT1Z1vM+dFfTNh/5tlRyaxnk51qT5IkG8qUvEPMAKpgXvviF//PMLZ95O7yxAP8E+TGP/QglTDPdnb+5WvEG+R6QF5nhkGrOS7hHoXBIyIvluwvwzdz1lsmYWXmvc4F1ItzpKMzQ+erfftcPBtwhtrdH+9hdnwjgYLjVV2+7aQa9QQcW/ZO3/R8Be4Ae7lIUrIA9LKMav0NY9N19BfIsDKf30e7feyb63vx9VpVjdBSDP/9UiENp66wT4xDqtZI1FaxR2GVj5BO4HwbwGPIY5xcLHnEE3CG0v3OMu4P0ahBhz/ijskLYw8LH80ffEnir2FZPq55j7LEE7OOb8mcfmifLkeG3as0v0mJHFaaePjqKtG5wV7Xn7qfXRtl6LZdCrTXPWfD82p5v6rqeLE9gGcfQko9OjndNI6yeP/eOxz54/4/HjKX6ZdHxffkRtNMdIc9hMrsgr5mlm3FCc2Zw+fmm85R9mbi3QN6WPNdOyOt2z2RuoeowwtImCQvoB/70dwfgYcn/6o//k+igFNa7QQcwz2CESgC2AfJfvW0aUw/IxIdEijVPtz0U8c2GB1nhyLjzOfA9Tr/lGLHscezifPIsevL3GrJnuQ/kY6lz2XOWMbHiG8hvsOTpllfAw3OSAb666eUb7gp6Av4n/trLrlrAqxT2GOr3L6//pYB9dM678xPxbQXtlOdCm32dNY9T4Daue1q7eRpzpaDbIeYFXTpou+mV1+v9b9YJ4Mv/OG+5RzwHve68f6e8s3yykOYJLGnJlzK6tr9HB+5zb8F/GUo35rF/sQftdMfZsJh49oH8uuaE7sdnqvsvCv0l5KPQ4D52/gbgHcU+xR2+yFySyfkMEAdUhlAAog32rX/1e6rLkgUeLJ9oc/+EWe8OeFj5Bfxh7X/8l+M/Js0BtGA9YcIcXFMhH/dt96f/tVCbCpk75zZtPBuBepX/1/ehrnlrK+Ry+c6XkPdnn8rfvQ5PMlg0kPdn24E8FO3wxcWPyYgU8Ap8TnjjkGcnuyvNgvf29sNIj0cHQkynC4seLmFUbPBc4GVSwKOTHjqdxqQwX/1cfGNdId+UIRshr1qkkY4c5J4PmnPSMGEel7zepN21dCyQx35xjfKVTLXms+u7Ip/6dfR6ku9Z0WU5XWE+fUU0Zi2tkD8Y7fIv+qCd7txV34O8JtgKQfz3jnniOtuSuWsBLwX9BKk+5P2Y5nwymU1Pur0eVzIX768CXiYAiSFD73t3+llZWD0AibroUyu+wF23heu+WPWw6FGgxuQrj9w9V0bKvbMQY9y1UIu4l9m4wt3NQqi8J383a5Cv5/P3s9AK5JNnn4rvWt55LTTLGOywZMRdn1agViAfOnlLuOLdiqfiOwIdwMOC5/h3h+TllMbnuGH/ln9+fcAeFVx0Ho1nJj3wUcnFOwpLvuSTatHLh3VYDnhe3aVFOkmUgTRbF+dzkGbK0jHTMtN87DeDPPJjqZhO5dQ0M6df37W4hkueWQN5fpuk9KSPodbPnb0HkOd4+dEu/yIP03S25Rvya+3xbsn7/2NQTcRayFuBD8BGL94yv3tN/MWi93MqCDN1Ia+VF6xDYVUyb7Q9Pv34BVjscFMq4OHSBFC+dPcS6FsV1vxtE/xhacKiR5zwzHnPvC/Gv/6WAofxBegRf1rzUfDJ0p9ZplqorUoKRS8ck2e/Kj0vO+DpfA1rkE8An0EelScMf1T3PP5HR7uynwL+iXt/LSx4joF3MB5VtMR/4P/xLXsJx6ItHZ4lNB8cFfCZeL+cXAdpCj3r8dyQ5jFrXkzgxO9uLAyFJeSZVvfRIp2IMqBn65rzOUy3SK7ZXKfmqSmfetu8XtPjsTMupQyM/QB58ZbMbvky58rB+ZuxboyXHyFC1P7kG/JMOKuQvwiAp5pCXgr7sGLNkmfG2lVgEISZdFsTD/byLpYjMy2sYlSIUJjxs52cKYyd5Rbt8SuWfE+06PEbkI8hdcVtr8+J8Y+ltdfHfg+fOPjYDf8iOgpqYcOOUCyYtBByNcDdpAn29VpWMG4Sz4Xfj9wdz57jsKd3Mo+b3xfy9ffJW8JiJ+gBeQIecIc3hpCP5RemZ3mcgD8M1F2sHKCzJzrMIX8gnmhKOm7gc4ggBAsflQr0RfnNn35tddfHtzX4mdra+W4JeU9na1pAz9LUrjTs4jm6515Tklb12pEHbUidb+dS1y+uo5JnppZ8QP4LJw44jW1x2b+DkB9T3L7IQ0yyU6azBeB1vvoF4DMhca4Bf6MbWFULd2YmLewfvDOFPI/zc6mYoXCeei2BpO/fnBMgjErGlLkwNh5WCyDPNsn/f3tvG3RdVtZ3fsuHmEqcKVJWqqb8wMRM1ZQyGbEoYyqxfKEqJEYdGgaMRIVR1NAaAgmtiCHA2GPakkEDHYMDimI6vHQwOBBgAijdtP1K0zT9PN3hoemu7ib4tBDE0Np02/fU79rrv861/3vtt3POfT9vZ1f9a++z3/c+e63fuq51rbWQYOzQEbC3Bv0HromBbgjCk/tP70QufD1HzMs7i3r8+07VjnY21nz/P/PMJj//lNZk2vU/XCq/Xs+a70fX9953A+4O+YFFf/21AXhF0gvyWVyP6+8K+G2t9TlxTu6N9tKAPurGGZjmrhuj8xr6bhDw91F3jzLw9V6APml0OLjVJi9Y8r1k6fuMb9vhV9T6fsekY/x3b52+1/Lt1fwoyc/bHZeC60qTOuVTrXtcDHmUIZ8s+WguJ8iHy74baGxTL991cev5/2G6BKYcWe+WfJcoG2BfA/kt1MvYBxn/zdGrE5D3RLMk03Cg52v5Oj9OYAGqMVjH9deEq16AR4C4Apqguy0seBed5UQ7+ndd3YG+WMgB8NIsrde9r7wecl8yiMWt14WllXvRi2dTpH3jXXXbp0G/FPColUlOKl0nnufeOzbWfAV9VzdfId8A+yzkC+iZq5Mi1cVHc7myzH++SyT9cYC9Ja5FGsHTpPEP1G79sze+I6zufE9+n7uK9xP95Pcg3y/wL/1mJH2j+4b8qPxbHJQzlTIAAKWbSURBVJGfN58/7rUUyD0Iz6X1g/twjUA+LPmjLsCuq379yvP79fJfPn0YevYSnbrI+i5QY7w+fiHsJf+9QpH4y8ccUmZfM/5xyCsDWaKaWDKwRtbHulLfH4mLYWBLV7ZEFLurPqzvBHhBfgnsW/uwDtCzzEh3NPmSRa53o7b+Fe4F+jxL7HfvHdGsjx7KoqohRdr3CjBWaOqE670NeEE+Z+BT8kxyVP7/1//l5p41z7cW/4mi6xtgXwT5BHu34BHvTPXwa8F4UnCX4npPfU7EDpD5qz2/xrIHurjVKbDo/tY+05h4PwQkxlDa99wwCvltFN/3BOR9/zH5cVX+Dc4pfZe6Ny3HdVR11nDby9rPxwzup6UM+eSuR2GtC/LFcBPkD0PPXsJTLfUdffm0ID901yfIk1CmAN/STMLWh5t/h8pHXTP7SFgbyGco5QS3RvX8IxLEKgjLOO9AHqtarnoA/5lXvLJz1Scrfgrea6QgPJYBPXNZCV1GUqoezI0v8PN/EiR1zUt+It4rz1KPq01/Wu9GkfLDd5PfT/3deMc6V8w9oxxTeYZ6bllG996xibQHHiXDC6ubd9UA+yLIF0veo+n1m+/NgTank4Z7Ften/wbc9lGgo3e++2+LuWCP+B7y/ebltfBXHX30tvZAV5Ds8pHdAY/mQOj7u3z/nvz7W6L0zWfI+z3HtYsXinezqW7r0l0+bnBfrlTYHdTJ1yj6MtLp0ePXkj9zTf6LsPQP9fKX3tRqPjcJ+TF5osrrZhK3w8FBUjP8SFjjdfJz12nJr53X9wQMCxCVYeb6eOriga/auQvO29TDVwGm9Lt6BN51dVwL1zvvWRZ9ZIK5br4An7nq5nHZY82znK35UOP9yeLo1TPm95Yy700GNIR+73/M/+eYGu9f1yKTxO0cGV35X2q3wQs0ALwgnyTA47rHil/jpj+XcM/iXuhWmVYg+mZroGIJJGSZ7yHfu+ZrIC/AkzYF+LjWnqz4+IYceEktwLJ+9lj/7tbIvvFQFHpL73dle5dH9aPtN/ukZq1T95kU+xnkw5KPKPpHn10GM6Ob8tdprPmA/FfO3n4YevYSnHKQBokz6tEq5BfAPUM+z1vg90Q4BYOQWZCRsDrIU+fHPSqBtBL5LurdmyK5Ac2pm2pXttlVD+Sjd7SGFb+1BKbyu7anv/HdUVUQbvt7One8LILIVNSWvqha+/feEdY8o4iRWeTjuv/MCk0Tqv+Z7dv//8b+1wWw9/2jgFWeke/z5t+t1nyIUegaQJ+F+wzkmRO0thTwDtpzKe6HwgmQ55vNEugVf0C/Di3AO+hb0BfgSZP0ea9Bagau+sZ3tFYOPGkq/fu+Pfl3t0Jx7lSwzc+Yv32k7xbjpMaUmGt/9l57QYFd75t9S1717t0Q5LlTnH5TugPkL6lJzS3Cks/Rmj3IG7gd8AuA7soA76+3zN2BcM9t4a4nQ6lQsrotv9Y2qvdVrccN5CkMYU075InM3tpqn1Gu16ePe5ZpPx8dtpSMNDKSRv18rFOg3r13HL33n/xsr27erfQlGXL971Qn3/jvWvsP/lMtt2T7qxDT/RedNR/d5NJJEO71Bti3gXxYuJrfe8ekFZ+hd/mTv2ORFc9+km/bt7hv2s4L9PznctsL9Co44oXimDnQ+7Mr0A54URWgZnPnPeT9e1srt+JNucDMvvH9Nurn8/56ljzPqs/UdNcD+a49fI210mA1uVe8g8v+0ppUd9OGfAZ5A/hbAr77SIdAiA85r1dCzDBIkI/MfSJx76J6XwnwJKxwfZ29sw7WIcBTPx9d0TbAvG/V85aOXMigA/J3fnQTaV/eWwa96kix5hlQR5H2An2F/cr/1P9L12Af/acps/TMc6ASc1CrDxi05/brO7c9sLrzhgHUXQOwj0BeVjzXm7LiBTms2Lf/+MvrOgctykAXNH39PqXzc0/PuOwHAvIE4gny0VS2QB4p5oNvQ8ctgTzvJsaWL3XO8qwo/zgpd73v6/L9e9/btvJv2b/Z8u13hdNN3AvvSqDnHUWB3GBfjxt5zjh/gjzvOyD/xONXKLhOneLkQtehi9tLcOqNPpcg3wJ795HuDniXEkN8yCMJpSakFuT3dB+uuHYD8qqPF+DDin/T/7k/N/2cyoA2sQzocdsDqmLF50Fg8jLbYlhUIu3/6eVdc7z7TnWBWPkdrvxvu0xsmbR/HJMzy5zx6r/WcXk5QUPWfFjcPGsD7NtAXlb8krp4AI97WpH3DlskkDOn+Rr7Io4FlCcBetrOZ2s+IE//AgXyPC8ue0TwqKDuoM/ieellj8ID/wNVKEMrXvnH8UFe26cK/PXb2kGDwZXyt+kdael7T88u0Me3n7q9jbxV3rek1nP3rpEGqUHRtW2GfKmXj6pYQR6X/aGL20tr6iD/2IdjYBqz5CU+UM3rB2iwn0pgS+VAGGTwLJ805FkW6IE8FmSqjxfkVR9/rAJWaS7Q00NbHe88dY6TMyOty9Y8g+ow53cE4ZWMw//bnhrvqQl5zySV6eV6yPzfJund1/Okdcos4zeQuvOGzpovsHawC+5rIQ/45jq+AdLsQ6czU5AHiDQr+68Pnolod4kBjgT61jG+bq0y5OmKFsgL8F43HwWl297TjTT33l+JseF5Hgd7tuApAJFvcCyuflVv9PMOfTvbQ96h7tJ+9bsa+wb3qcY1evesb7k8d763umz9PtQCQO5KOz0j8x78M+TP3Fr6r980k8stp0jfuO03BYED5C+JadARzr139ALvholU7rfN717GPwKBKSkDz783KvX2pS48EtO9d5wI5HMirZb8qRu6TnA+/NbaCY4gTx39AMrHLUEf4P9eV1UQFkGui8/t5rM1f9+p6Gsc0JNZyG0/gHpLE+/LM75Bppgl653/WYFMytDSgDsbSyi1ctDY5GSOH39/uJrHIL8I9l4nf+8dYaWOQR44Y7mqKRrtzjPkAaEsdACb4Z7FdyxwCsiIc+na2wJfxzGP+334U9VlL9AHJPguShe+FBzxDGHN635aoOd8VJcoFiIgzzdWXPV9S357yDvMHfBan63f0W/wBFTvW/nHSB6nexbo60A2An2qk++O6caB0Dlim4JOS349hPwf/LlqxJXCPf971zPeob38JTHljnAC7MmSRyTODHs+oic+e/9/fOze059ke9Tlanz1Ei26RoNMf6DSREqwJyGNQb5kILmku4siIRbAbyz5G8NyyZ3ghKueAWl8LPPjluCV1sWwqAAr94LXyIiw3OK/u+9UQJ4OfDZN6jqI9yx63skE6If/WyOT9e3ZYiezztZLKVBFRlaAXjO//H8kOdBbWgt5QNaCPOvDzVoAj3DZt4DMbyx2h7vEWO0CZ4a7y8+7RIIyy5yDURPHAvD03BSWsOb5nq/4pmcOIK/7DOvzjvdHT4y8v4B8gdYQ8tu56x3mY2LfDMfm95e//+J2H7jf9yRPE/V5bLnua3X08TykXYG+5IXdcV1eGMtNyPfHji8u+zer8KVR6Q718pfIlCMwM+BrIjWLnrr7sPxLPQ8fjDL9KcjnEmjvI59U6YSlwFWJgntSE7qWJb8XyOd6tNJETTDBGlInOHR+gwb18QbfvaoBr7xd4597xoMy9BUFnd32KrjpP90UoBoq72r4v6X/Ksu3S3d1bdzj3qizZEjO5JLPYM+g0P+h/2hJ4N0o4BPkwzKdcdWzDUjmDmaAp7ve2ReXtoM9iwKrruNgdznElyhDnnHhuaaayurec7087wjI8z0wuE0L8ngtFJWvghOQ57tQfqE8Y1vIO8inVOEuTX2HJ6F0faWRnFY2y6WtPPeco+71XAX0G8Bb3lY8q8q3RyD/59QPCvtvurjt2tP3iXCYLrqpg3xXZ+OQd8BvukWMkmG0v1SiFuCzNTZIsJ655w++JI6cECrki5sqMnX2K5CPoV5rEFYp/VrAytbKmRIQKR2ICPLqBEeQj/r44wR7VgNcPWkfIsQN7FrWtnDb33Pbxm1/1021d6zIQLKXJgG+Z3UPMq5Gxpr/87xO80azog7upRln7z9RoXIDeBUEloB+APcG5DlXa6Q5ftMcLQMeMVgRkFc3sRnyuPwd7FnyFizV0iA9wV1z7kXVBoI833U8Q4I8Lvuw5K+/to5gJ3F9Iul5djW7C8ircNms5jPQe1qbkMN8TmGZex7jdeX5u/Rz+He7rTx/83uq6qxyfb/x7d9+fTegTSn0hkeu1NMrL9R3z/7Ks0Nn766D1PTz+M6QE+Q3TekOLvuLfsodJmR3fQ/yrLunuoLoSOFrKRjIkq+QFxDTx91LrIMPfJMIxxKIEkFIkL/ntnDVB+RleSbA7wvyHUS6zCkgL/d9iUyPwWiA/JWvObn6+Aa0qrQ97at3GvBL7nsyc5aj6RSgv+umXrS9Q74q3s1mWf/zuv/UtvOb7yODftC6Y3PNHvwT7OO/4XwzneIM4J4Aj9TDnY8XzzLBc2SkArzqtgV5tgvysnoZ+c3BLr3u514/gPiU/vxf+Jqep2CJerB/6nOiekB92lcvRCn4xXdBlD39D1x/7dFr/uq31ufh+tElMiMwXn/N4NvDG5Pr44ffzwlBPuU1fj5X/X4b5xp8w2uUvvV8rZa6bRn2XW94pIN4pwXu4eEq+26+/X50PYU3h3zk86VenuP4bw4u+0toGnRpm931aZkPatNlIgWDR59dm2XUsb27jHcD5k2gSE54rpoALHHUc5R57Mc+Z26NBICbs7u37hoqDe8X8qnUfPrGLlDplo/U+nhB/ljq4x3ea1Qsq7BKLQOS1ZatN0Avt/1nf/NNAXpVxcT/Gu9EFvSmWqZXCMtqZHa9dba9Wir3nQorBncwy1wjCiYVFpuCVw8cqSMgJLdzSwPANyx5/mfgLMgzx+KO+yh18LLgawDbIw898fZ//euxb7Z+EV3LOuBZl8+/RqoWcFd6Vgv26NOn7u6GoFV9bmornyHP9yCvAdfBS8E+FIL8m4xvjf+pFM4CPkXbQn4A3SXi/9dyw0XeUt2vda5tlb75fB3XYH2tmux6swPy5HVKAwH7kr/F967/UIWrMci36uVTF7h538N0kU0dsLsubTX6XAv0WHYaj7gF+c5tXiCQ3exytaeEN1ArcVSlAoP2LRYf7X6jOVu23n1Uum2VIN+5xbr1kaF/4JqjT/7Aj1fIa7CYHpwd2HPyYxpwWq3SaU622sOiL676nLF//vR7wgImorrWzxeLPkM+Wxob+X+W/texda1tgn0BfXSwQsGzRP5n0Md/nACv/yzDfjXoNZwsELv/tkH7eL45DewiK1iWPJkr4MS7NAZezoelj8sci1oW8lrIY81zHP/Tv/vG7wr93v/yHVVY3xnqGfRci8JxdIyTIK/vQc+PPLo+LMsG4Os7BUrFq6f/ql84a6SzCeV8w3+PqVry+bjybeVl/XblvCPO4fBeqsZ1/Fv3fbrlYrVHobf7TdoN0N9+fXdPeqecV3luyaf5JtuQTx7bFESd29Qfpot0EuSpo3HIB+gT8PtjFW+C9bTPVpBXQmqtr8dsBnLoEsPNEdmM1VQt+dKZhCfUrVXcwKGSEXIdMnO6gwXyvfp4h3ZLCb7N9QtUxzov454LUOFJ+MA1UW2gNvNaF9cgAy9N55SZu/X28Mf/Q4CeSHtc9+EqzBH3vJN4FzkjTwWhKeBn+f9dfvPeWRboseapF49r3Xcq7l9VMwKH/hdBXwU+ZbZrQB9ej/JeySyxYgVWXPc8O4WhHGwn0MeALGfvjHiNFuRVUMiFhgzgNaAH8tzbQ9/2fUef/6a/d/TAU76jit/oM9/8PQPgax6Fp0ceinEfBHjk30MetAbvDu/+i9e/dfMO9e2WufKJScivAL0DfJVKvhPn8e/P1LquvqOsAcjH5NeYsOZ93Wa/rklpzsuAfHQ2JBd+qUZV2kTkxS3IR16Py/4rZ29XgZnveWzfw3QRTeoRKYM9u+0F/hKoER9EbVufmt0pcdfMt2Xp1QQ4TGi9ffK+vWP6kahAPoZtTMPA1gy/kWmsUrLgK8Bwa95/W3QScuof/lh11fcgr0zP1YDMGmWwZ2F9cn7ugX7sv/CmK6v++C1XVwXs1X3pPR+sGbmsVynOectH4hgHfc68N2q8q/rOGv/viPTe9Z75D+mBEQsGwHIf/Obe1dIhg70riGxAwm9EwWAM9A75DHuOVUCc2sPzbtiW3fWtenkfo31O20CeY4B8BnxLAF+wR1yPdMN96j3Gd52qb6KQc/pDNfAwCjj33BTR84PCaplTOAQao7EcKwEf34LnAWs0CAxte51612usi/UqMAr07Nea+zppEFDcv/5gneKaUtPA2I/0V1qiKHYlPBfKq8/cWura28PJFmu+uuy5Tur9LvJ1P+YwXQTTGOSrBV+UXTu5g4WWJR+J3K358tF2CTB91GO/63olzG5eE959pyKzimZ0JRqbj7fCvpFprFLDXc/5ydQ96C6s5j1C3aEzsNwNzKwD4twHljywRzTry9BnW+ybrDVXZPDcQwK9XPfdu93Utzbhrv97C9BL+g/iP6XA+fEbIuBL/aNz7XBfFpem5gF1A3/NoJeAnjr58p45Vu768CaUgDyBcAryQHEt5JHDfEwKvhPkTz/tuwZwd2HZsx+g5/6oWqj/X3lH2ZLnPySyngIO4IhAuxbgy3L8d6WlSwC2mQe0W95MSaAbQLylHtjHIN+GvX9/vq4n3lf+vqeWVwJ+VL1zdc+gURhrWrj3jg3kGwF1akpH0GVUs6pdPc2iY+S6YcHgMF0EUw3ISECv4C6wD1e99XfcDWqzgbz2yyX3QaLaBvKWiFEEodx3KpoyRf1iqZcX3I/Hku8yMTLBHHRHfXwd/jVb8p4Rzii73jN0KsgN7FncU71PNY8r4Afsgjwd9jCP+yLSvnGuDPrQB64JzwWgx5LOllpkpMl67r0vl2daE8rnqh6E+04FnH7nJ382CiDyLoRXIvXkx38vyZLXO4n32OgRz997/Bf33BSAA9bZihcI2d6KsMddzze5FPLAXfXqS635bSAvYdVHE7gvfnpjyZd3lwt/FKy4BvtGNQ9WvL7pXJAt83gfowX8adBPpVfSfV4ekx/X0iA/mlC3/2Y5lL7zes7yncrIiN+lJU5o2zRQrl+fm3v2gkwpbMd3T8+DpTpr2pJ//NUB+WTUkY8f+rK/iCdB3gGfId99CP0PJ447evzasLTYrzS5G4f8BOjz+h7UbX0klOKyv+/U0XXv/GDXZvnBM09EffwOkB8c04LWvXdEZpchr/bxajOcM74lcsBUizJFeiPqy5lTJ4yAm0su6vgvFFSF1YFL/8Z3h6UP5CmYcJ3qyra62AHor782PBaKuq+ek1o370BPlvyU+H/T740VKGB08wD1PbcdPf75BwM6WJgfe80bAkTK5Crsk2Vfwa9+AlIf7ZPvH52+MSAXTcboyrhAXu8rCg5pbHbq5KO74wJ6FRAc6hLbsKrP/K1nBqwRvx3oLQnyHOsQnxOQJ9aB+IH6/gdW/I3xX9O6gPfbs+IbczWdqxAcpPtxeTocU4b5Uqi7/NqDPKgB2p5K/lK/1eL2Fiwr6DPsszewpIvuHfWv4dce265j9Ty6D6VJYpUir44A6T/4c50++9VlOPHLMdZUKFW1rOfth+kim1qQr3Dv1cdv+kPuHVcyN3kCssu+meAd4sjh7or9+hkDHzauelz2Afk9tZHvJaYMrdJnPZmf+qwH8uEiZ3z3Ige4Q70JF0E9WZJIMFcdcCTMs3cP9chDTwDAiJguy4AG4MjaZZ4t/LgHa06XId+DfcnQCcQKl7kC4VIcRM1wHOQz0vE9QMgqVMZcouvZHiMl3vKRo7f98EsjupwqBX0n2bKPbyEBPlut2arPinX6H+54fzxr9MRX9tV2va/ssnfIe3t5F7DNgXPMb/627x0APYPdIY8L3gPv5hTf7n2f7KoWUsGn915O3RCd4QS88zecAZ/UFcLWA36j+TS7Ldh75xi5rgN1VD2vVee15HvEZf6FO09XT1d8ZxOw797T8Hr9fC4DvluX3688JjWfLQXuOgDNnz32uoD6E49fEctHj3249mtSvK7q9CpaTR0gf/FOpYRXIe+AR10XiNEJTnXnqC5fnegE5C34rum6c4AvUQFtfPClOReJgIRFN53M2S7o7AP0m8TcKSzkBz4RkecE3QH5T/+L19SubAG8rF/NM/SVWQ7gbmAXPKKDkrN3h9WFAI6aX1FXjKWIaIrFOrbxLuhdTbEKecQzzqWAu8jcG+3lW6CP+07uWdz/wF4BeWFp17r6foYW77IB9lGlgkJ+97FcMs3IRIs3Ae8CoMezQnMvLHtZM2pyJA9PWPUF/Pl53WvSqiLRf1ULAQX0UfBI7eUFeVzh9BEPkB3uAryi4AEvsGY+Zs0L8My/6klPqYF3Om6NaBXCdxGQ13tvFPb0bfa8Ug0rPr5p0nX8f/3C+Jx66a2RDmPblnCvBkSzbn7cYp6UAZ7/nwI13sRnXPYDMS4AvymMx3cq0KtFylg//qVA293j8D25lNa6eWnFoHbyJR8mX0a6FwoipH/SBvsAeAnrHsu/T4bDdNFMLchndZDv2sf3jkud6OhYfWAbS37zQW8+0gWWu8vdU8llD9h6Pd8p4axQLhTURG/WJZk5mThgF+TpCjZDnbks+og2vv26ruewkklm6OMC5ffnbr02MtWA+plbK8wFcc/wpdwka0xsp0BAXTbQIwMCQGpGtwT2NbPn/q//rS5jZ/z6t782rL2uELaxtAXrAcBXqnv3CvLbnFeZK9+ZrHpiBoD9vS/7Z12QYIE9QFcUsqx6QX4A8gT7HuizhZ+k96R7yZBHDFYjqOcmbBnwauqWderpXWS+W+4CPGIddfhrrXjEu2KApYAQ3zrvtVEnX8HeAnxSFPbKfzOtdgGgl+YsXSr9+/qmSrqvaVmFzIbLu6XB+VwZzAWq8b3fdyqMjG/+9ucefc3Tnnf0isvfGAXs8KaV4Zsr5FOzwo0XLLV3Vx6XYF/znzrPeWu/06EM+fAslesD9vDGUvfeWfiv4zff6cbyj8C7Q538xTi5u94hj1p1Nl0QR+rzvtTvDCFfPkZP4BXgC6z7nlutOz5chPedig5xKEmzHFabJ86VcsgHcE51ljznVyc4CKs+wztb84A1em3jnRSXL9uoWyczlfsdK5D9fuFVrx1AXSDfRfl8AJ/3pTHFuQ8B3wEfhYBkyVa3fRJWPbAPsPK/qF62ZFoO7rWqhQa5PWW9FItemRrQ4h74b4A9c/4bAZ/jKuSBWBkeNcshPlUAcMhna17Cc4KHhf9A0fMCvIMXySpnLrd9BruUrfixc02JWAaqE6JQ2Sjk6f8OC32Bqz6acEUQpoJlx0A+hP1m/RC0qwAf31tS+e0gX6LBeZvX2FjQfIMA/Sd+9BeP/sa3viz01L/9nKNff8Nv97oP7grBQ0D7uk4G/wbU83LEBJR5hXypZg24R892j79aHZl1QdOPXytL/tCP/UU+Zcg73Fmn+h3/AGpb+dQhTv3AmqC3hN7KEMag30uIKYO457aw4un/G6su4FkSpPaRVMKfc+XX6xS4SyRUrMZP/oMX1vp46ucz3GXJk1FqbHHAyrKauqgnN9zqcrvvE+pTyrDnPsKyv/+6JuilDPpehp8yfVzlYdXfdl33/xQXZc54HeBz8mNqxlfnm9HOsJoBPd8sYOe/wYVP/TPWfdTbE5HP/d123QDwLdj7epdAT+adrfkMebxMvHdc8A5bl6x6LQN6jpUVL8sewN/zLd+7GvBqLx+d2py9M/7z+M6XWPFu0af/X2B0gLta6czX1W0NwPvvgcp31vLKbe5xCHXX4LyNa3Tf48ZFTjr6qZ/+uQD8Dz77V4/+t7/3i2HV/4Nn/fNo/RMufLxOpXDas+Kzy93mPZA72LMFXyCv/DfVy785qllLB2abvLvzwgL36rLHkGs0uztMF8GkunX1eOca6/pw01b+8WuVweaSpEPeE3sT8i3Y17lnIF10N64yEljUyxeLLRKhJdClkI97S6CPa5VOcHBT56A74Cawk+Fl0JN5CvRk0BmyOdM+Cbi7dF2qBQDkHOwr/FI8QQv2CkKMqgq9vx6khzAf0+i+pV5TGaxgL9BWq+bjN8T/o977EK5qCiN6Hgd3Brhb9S3p/bRAD0gpgM5Z8L5ev5kTPY9bXr3WsbytBY9oakdBk3uLAhz/kUG+V5gbg3sZF6Fz1W9Gn5yS9vG0pjSZlSGf50vSbpaD24GubT5vKnsK6rfZfXekn7f8m7cF5AE8et6zfrla9S/8oVeHB408in3JL2XdSxX6ca1l8GeuQLr47ntxVIqwH1rnuTMzjo+IfGsifZguoqn0ghQBdBXWuT4+XD3t+praxp4I7/SBzUE+z5tyyPcS5mY/1cvj6o728nSGk1z2OVNYC/mckDmGjBvI5/r4L344dfFpbd1j+dQNYbUL6A7bcy3dE7CPjKIE54WV16irz6BvAqAsKxgxoAHwe4CeALjJ94vfqgvNQU1lHZllbk5Y9+M7Ciu+3TxxW01BHhHg9mvPesEk5F2+n+ruJd9/jajvr5H15Z0OCnP+3zYAXxWu+vQ/KY1nt3b6XbdbesuAb21bsm4grmmgbwG+tb4Je4O8vq0oWJ69OyAuyP/9v/MzR8+77KoKfMQ21r/mZ38l9g3L/r5T3Vz5Z+2ie3P+eg2BvMCc4ygwyEtAAYICOwpoz3RXK5e9rPkxY+4wXQSTOkgYhXwj6E5TPnYp5D2htxK97zsG+UgIpec76sBYVjR1Tpwt2E+pJvSSMXH/WD9Yhr2guxJVT0aY6zEFgegL/p6bon5e1vz5KME+YhtKHSLN9wBXBkAFfcuqdxXYB/B5LxyjnsISqD3jrBncCPQ3Vs8ww80FE/0H8q4EwAzs/nsbtUBfo+0f/tQTeA5akM+/fRvaJnJ+TgSNck/cZ7zT9L70nw7+xzHI1w5w+um1S+/6X4Zp39PanDy9NgE8oSmYt/Yd3d773spzFa8S8S0E2wnyuOlf+iNvPPqR572hZ9078KnHB/rkXe9467ujAKa8N5rEqhBQgvsYPRAxeiH6pdf/engxMXKI7Afw5L9dW/nxfJtJebcgn7st930P0wU+FUs+RifKkA9YM2zh0XhdTbh9FHxX2gmP1cs7uD2B9RPbFOTlBi5uwnvviE5xfuEfvX7jslfGIPdXkmcaLfWuUwoTQB7X73/+nq4jnAi6M8hnCQJh0X/8hgjCOh+teaTOWVRfj0s3W/XZ2hMY/XkHYGgB4sZ3VzCqWkXQzyBvyYHfUoa7u9zz/1KfYY+QF+hz23m57aniceDOqQX+XYSrnkIq9+OQnwS8/4dF8tD0/pueFT+hRpobU6TXKEhs0qTvM9i/sd7zEK0b28eP92eIKqESNU++R94DuGXJ//D3/1IAGTc+MAf8CswT6FV3Lwn+zHH361wcq32I4v/L3/jMo+e+4PI4N9dQQSAbWVMeWKbssq/Wfx1ltH3MYbpApwpqRicyS34TdNcu3W2C76x72xlrvp+w2sAfh3y/oEBmSikayGeXfZc5DCG/SCXj0n1wHp6HenhBPgfd9YBX+jgXQFgmU8Vtf75CPkv19TGIydm7m3X1LXhOQsKUC0a8I0V5bwpwJvU/n3uva/S3npUBnqG+D7C7MuQz6AV54Nqy5ltass82oqBBuox7Kn36671N/nelcDaAfPHKdADu928wK09vU0r7ZzijMaDn/aeUz5n39/OEes/QeSsEef5rQEvde3bZY20TYU8BgDwKN31Y3z/+q1EIAN7Mf/IFV9djVBBAAj/AZ79Xv+Qtcc4Yr0NWfslr5UVS/rvE/Z5d9rVefqJgcJgu0KmDfDdsbBvy/Z7ufNKHEr3eUZqcsOYd9C3obxLcDOSj2U4XFIe7Cci/7VX/Pix7Mq8uYW4PeSkCf+6+KTJHgrfu+9EfrUF3ApYgJ7hXqDRGNHOorpEs7jxfIj/PEnGveB+UiS0F/RQwprbrXWU5lP06Ut7fj/dzrtXSc9T3kqokBHrq5on2B7bHBfEpUcDA8xS9IKaoev13/l8MZICP92JW/ADkS+TpLaVB0jYQV2E7li2v6Nb1Ia11DvLWujzP++VrVKX7rs+e68zP3n1EK58MeVpXkKeGG139OhQ4A37ySbbjpgfccsln1zzfjurfBXUZMrmKKAO+Qn7CQGNSlD1wr23pGy2pDtNFMMkaF+T1oURPd3OlwdzznUC/EvIt2C+FfFgl950KwAN6XM1YUjUATz2yeaKdUkrMXCMiYc/eGc2xsOKZRw9rPkKcuYhZx70Q2LYr4AVenUdtr9doLfS5FoUTMiDqHXsws2d18Gagj4GktQ/vzLfPao/u922VC0DxTRYARCb88KeeIBJ9qTW/b1HAIE0Cm4A8rvalgG9AXsPKZuD1ILjGbZ+XLf1tztelX9Kx0nIGvNaHt6fMWe+Qz+skz3cmle+pFOT0Hkgf1ItnyAN98kSBWFDmWH0jeV1dX86tfVTA5reCYrvYo00z0prnCvRUtVLHPlLVypQ9sbVN/dF49exhuoAnNYVT73Wy5LvubKfdN616+bCm6c+7183tMADHf3viy5Dv1m2C4SQ+fBIYgSsv+5E3RP081x6Lsh9VzmhyQi4DkQB5dYQD5NX/e4VRAzAkTNqj7wJ4ry9n2NMrvumZA2vdgb5Ec9Bnm+49+qw/e3cE5K0FfUtbwTxL12u893MlB70EXOlpkGBNoHuSoKe9PX0H4FHgv8v/1QDmLXl9fGkbny15h/Ja1fSZ16c02Vn0m+GF83rNBfde1Y8DvazvrWvkPaOy+86gj2DV22/6M9WrK7CO/LTbX4ZO4znTM7g29zn0ZOi8LUu+M9Kmg++Y1ONpv+OcR589lecfpgtwUlM4Rcn3IT/9h7NNY8vjCfAAvIC7gT5/qP47r/cCQM+SN8hTH48l//+8/Jo68ELOEHKCGiS0nOByAkZ33RTPQUYtyOOuJ2pcGWWGjTJRIMZ9aUxyB+gSCcDM6S9enZhkQGvZAb5Gc7BHPEOM+LelRT+n3Pxwlc4jyCO9F7lTZZ0BWdytJ+m2V+c3uHwz4AcgdznYG676DHlXXj9IYwa3wXpLi5vz3BL9TuQquAB7w70uS155hm/fWQZ4tZenEExAnKx56ujDaCrWfhg9rRYlfv6kDPpcqNncS5e/ZsiTd5MXLxlCNrvsK+RnvLeH6QKcvCmcXO5LIM+U28s75N1ln8HtEM/qwzy73dL6KDx0rjI6HgHyiMxAnU10CWFhxtIQGQbPw/lakM9Bdhnw7A8UdwG8rHcVJL54/VuPPvfeq48uf/J39OCsZYf3Wo3BXuu4Hyz6GA2v9Pg2gPwOoNf7lPJ6QTRDPV/TYXsulS161dHzLYaX6/TNNdr+OEGf6+FpypnfZw/mDvgp0PMdKuZgBOoZyn0N01ZoMj12VW2kcwru0U20hjluWOoudapTO9Nq9JrXAmcPoq6cN1g/DRTi1POdmtJF87T7cx64Od6vna13Lfs+A5Xzuqs+3PUL8u+my37GzX+YLsApu9zXWvJMXkiQy94hnwE9+Fgb8n2bkC8R9rjKrn7pbxz9wgvf0UWGM75zsaZ6iWqQkYwrMqzTN8bz4CrM48iT4ZGhZ8gjLZO4HZZrBFCpy6f+k2sxoA3XwqIXjPcNeSmDXssqdLAsT4kg34R9A+BLFO+wEYS3ROcT7B30zKOTHsZxv/eO+JaOq44+W/Bcs1aNZKhruQV6h3u24qsl2nWoswFXN28D3mE/vq5Lc5vhhuP3vXdEIV4DUeWquDH1AF8g7/tIDnhXb/+Sj6Bszcezl05x6OVO9fLcc3i/Iu/Rs7av79fy303V9zaEfAm+u3zOKs9R9l29PAPZzOf7h+kCmrLLfVgnP/9n5wj9XC8vyGd3fXyQCy35zXLfko8EZZDnOoK8AvCqNT9W7zcjQT6e5ebfrZCnbrUFJEGGRL1rsB117wBeo9pF5nv6Q7Ge7YKxw35fylZ9hn4tfNBpzli0/Y6Qv1iU3w8CTtH3wAO3RPqicxqADJj30aMdUh08gI804PBuQdxh79uLNs3mNj3mDWHt66akfTfHREBtnHvT+xvviuq4aDqmEdwaeUaWg7oF7bHz+P6941JeUj0XpVMc8huq9WjLLsird7vw5KhHu4b1nq/RWufqrW9Y8rjrlzSjY8pdm2+i7KdbVR2mC3CqLveBJT8deKdJwXvZ3e+WfCh9qGOAd41BXpmCMgLq4wV5jUxHpqqE5RCfU7bkSaRy12uI2ZyhA7awmE5/qPZZ7+BeIrnEOV8e+EbnvuYlPxH7ZRBnwGcgSw7wNcqgR0Tb03vfrNu+AfAlclDO6Xyy3l0V7gZ8fvM9AeLoKvnp3zeA9RLRwQ2FBEQVQHTQdOt14Wkh4HMW7q6RfVQ1tQF7B5a+JZ/lMJ/T5pgO8lIHUJqUqe930vFSAObtfswcSH17b58C+gz5XC//Yy++onZsQ492QD6Otzxw7Pytda7edoM8+V6F/IImcZ0ntusrZTMs7SHK/qKbFIDBh6H2nKsgb03paqlyAvJrlSHfQXgzjjKJCzc9kMeiZ5Q3uZWzy36NMuSxijLkx4CE1Q8IHbRLhTuec8s9T8bL72iPf+bWo1/++9/fg26GPHPq8HkPNOfBVcjyPqx8wZ54AI2gJzf0PkHv7/NiUzQ/u73rYEh97PMNY30D6c/+/BXxjdEfAx0vIZZdfIOx/2++qRvKmOFzy1C6MZyxW/A7KlvxXfrQvKVxiDel9D0YiKVz1WPF8z2zjv7y2TdDrgVDB+iY8vGtbQMNqv267m1rvfxDnwgDQ/XyRNiTn3bHtvPAsWv6b9+3bi/nFei5B64Z9fIL6tc3ntzHr/0vt/7+Fw4D1lykUw3A+MrZ23uWfLh75v/o6rJPxw+s+RXWe9aYJS/IK3FR2o8I+5d21ny4yqgPq3XzUxnTUCqpR6Hl5t/t9VsPgHPmze9d3PQcgyueTPlL1/9Wtd7/2y3/LuAXdf9nbo3mcw55IMw6rv3Yn3xpIKxutju4txH3SScfjEkfMNmzy96huFS65thv19z2kxLvUMCPdEIPg/R7/0BXj6v0gzQug+Ih5BVAqtLRWAH7gjvi/HJJb9zoY2mpAfEVqlZ8qcqjoE46jvp4XPWlN0uX5xnI93FpHz9uUg3I676Z89/QuY26uCX4LrrbjqZ06VlH7tXXu1rP0N1XsuaLu74LvlvWVW3TZb/A1X+YLrBJbSZlzS9192hSaTDcuK0Ba/YI+QrhVIKuzehe2lnzDNzA9WXN1zqxBaqRswnytI+XBZXd9bu66TkGNzznZLhWMla56gU/QR5L2q14WfAAHfjSJjvPcQs7rLeVLHq66/R6+QHoE7gd5mNyCE5pUKiYkR9/Pij/vwjoS5+79dreb4n9aqxGA8qSRgPcSWoXPwp5zfvQW6wCqDhvsuYjDZaAOyBPfTzbxyDvgPRtLeX9PM+ZUj0mPb8KJ+QzOcoe2Ed32yUfGjy7ndd/+7q8vrc9tZcnL1Rs1JJmdEwKvn7s3tOfTL3fHQasudimrm7mscux4PlQ0Zq6GXfZj1nza7WBfAnUy5AvmQIfNi51QV7WPG4+JbBN1cEQ6q4pyP/xW66u0GAeVv1dN27tpgecMWLb9b8Vlnsenz4DkMCeliXPbzISIE/3l7LgYySrRx6K7jK5N1n97r53r8CcuF60YHjkoegmdRTyBlYHeksOwTn59cbkx50r5WeUNyj/z6qeQRXSxSrX9p6VPlXnTodNvm6lNr3bbazVDOKhGiCfUQb8phDR/QbwpGEsevIBB9y+5HnOmHrHNJ45vCz33xaFEwLwAD3PQF7IMVG1WN/fdH7o95fng/W5U5wHPtGBvjaDno+wZ5KR1ouyX1BAOEwX0JSj7KNe/uzdi0uCTCoN5ih7t+a3seSlKciTEakPe6x4KVzLBKKUenlZ83NWfYZ8JJgzt1Ur/g+veUPts14WNsPJ7mrFf+n33hoZawZ9ZPgWtd+CPP1ctyDPHMjn/V3cg8S5HOoujpHnoAX5gNkIXB3qLt9/TvkaDvYxTe3r59+H9Fz+rCrI6X/OgI/vIUPe1QCyS9/T1uJ+UvS4IKzfnmYc3ktUgWeQJ83Kiq+u+gacd1WFZCO/cQ2OHXn2iLO471QdPY7eOAV5f36/xhL5fei8UYBQ8F2pm1/Sh72mzkjrhp89dIxzEU/ZGu8s+fn+6zXlQoIgX11HQHVLd72UIR/LNeClS1jcL1AX4GXN4+qLrm5LSZrj5yAfCaacW4UUAI9icJqSCZJ5Y+U7vNeI4KkA+/W/VVUz2RLUxnV4l6pfd8jzjAJ7Fuvo6tePaQF+CejVEQ/78F54r7rHbMkH1BrQ3AXovfM0AL1Ec+fx7fuQw10QF+RlyWtdLF9/7dEXP/zWIdjLcmxzKLt2tORlxee0kCHfs0h3VFdnXdL5vXfUunis+Np0zrqq3od0Ls9rWhocm42CVI0hyAP3v/QN3xvjxfObc1RjJ3tDGteakt9Hdy/dexToBfnOml/mjc1xVYeOcS7iqQbgHT32YUBfSoKL62ZyF7nusucDbUG+q2ufT2g9Sz5K/v26MDwPRLZmS17N6fjg5bKXHOyCeyTa3MkFgYT3bCx5ZZ7RtOjMrTt1XQs041y/99ZquQXoS518hSc9753pOv1xUHMe3OcAnR7OgDt15oh13J9fV8c54B30+ToZ9Lom7xw4OuSngLkr5B3Ma5TPMXU+32cbOdhbkB9VhjzQtXnEbsxBnO1z+4wo7jO1g99Y7/uFOxpY8/edCrhTOHVXfcwn6uXXStDM8yzf34/1/EPPRF6DB+2vf8t31wh7joln8fdn1/N7cPl9bO6lAflUL+95dWsa9GW/wpN7mC6gSW4brPiA/Io/OjfF61nzgmrjo10C+G6/obs+MokUfEfGkIPvZM2TuLiHDPphAu0g7wrIf/yGADz18TXzPP2hncaJ57hfYzhX6l+BPCpWfFQHqGlaifJXQQZoO+iBL27NHFWP8GxwHUHdrz8ljnnNX/3WngR5tnEfvHMBUaDXb4eeA9DXrZFDeY3yOfy8rWv4+qVysC+Cu0PeAZwh79uy9I2OQX5qvbqvzWAvbcEHgNpKGxii7twlTadgO9JyuOrL0KooDIIyCpuDbq0yMD2vkfwYPz6kfE0W/akurVLYJgCPuvlo43/3LRvIx/7rAa/9XHV78YoI8rWV1OKm0F3+Lcgfouwv0im73TvI85Es6wGp15Su9GU/gPwI7MckS1+Qry77BuTVh71DPoJfzt5dmyplyKu+fgrytEOWJQ/ow4q//bqtg+0kXPVhuZf60+quT656mlVlyNNOnWNlaWeLG/Cynbr7H3rqcyqst4E8UteruUc2OmH5d9/4XXHOeHfcX4J8rpvfpxzW28rPOyY/bu543+6Ab0IesLZ+z4B8altoDeRtn16wXYF7l14c1tsqQ35TwOZaeKrCii8imJZvf9+ARxmamvv6OcW+vWZ1nWdCxgQBsX/tqc84uvX3P1arIXrvspHfufyaLdX99Z+pvXyvXn5h/l2aUvdc9gs9uYfpAppypP0aa14FhCc+e/9/pAlXDb5LIzCFRaAe6xru+5Yy5OvHLHd9OS/1wwq+y5AP0JfmdACpg3qXwXCsu/EHKs+Q6+TJxLdtEy9RQCBTJcNGsuZZl131AVGNPX32zma9fAa9AO37CPSaO9BbYl/vclW/3/D1fyc676FdN+8jQ94BuA85bHeRn7slP8alffK+9dgG4AeQF1hbvz9wzSTIp7aFlkA+b9eyB9sVyGdI++95CerDudJuFLDvvaPCHUXTM9I3nS7duRkrfl+QR4Koz9doA9gNaJkrToi+7KmXl8u+Qj7tK/XOZ+unlPcT5EN4IVO9/Fz+zdTsy35B3n+YLsCp1M+8Liz5rinGsijNVK8TbakJzkp13HzYayDvTejit1nyVfedChe1AJ+teXXFGhZx2T/AOQJ59YkvyGPJ0xkOvZNtG02fpfr4Wr/6gWtGIa/CCfeCtcPxDvA14ngH+phaA6no9/v/7vfHe8qAPy5LHjlot5Wfd0x+XEuDYxpwHwDeoZ7nBbpTIJ/apuNHIZ+32X4xTKtZ8Ouh7hrCvb9t07Odgu3GrPgM/H1IYFwC0in18qzybNy3XPZ0dcsy+1bIowbMfd3Se9O+GfKy5rtx4le47KmuPQw/e/FP1W3/Z4+9Of7ohaMTKUKfLhKje8XahC6V3JUYGh/0lHqQb1gbfNBkFBnyXjevgWsiAyvRw64K+AJ5jmP0OfoI/7VnvaAC0MG9RnRRWzNsy5CBh0Oee8VqxkOiYDqHt8uD57QOK5z7px96h3oW29nfIS/QUwCI8QHuv+7YIe9w3UV+7jH5cS1pv5g34L53yE9tS/v4N9XclkQrkVpYzl1G7wXyLcAXb9x9pyKCvgK+BNzFtQvYJQfb+aRNvtY9I+siiPCdH4x6eZq55ndZ6+Yn5NeI60ys767fd9lzDyub0rWHn11w7GG6AKf6hwv0pUnFFOhVEvzMR2/4DF08Rt18CXobJPrGhz2lDeT77nrBulUvn4FPRHgeFUrAD2s0g10WfJlzXlz1b/vhl4abfVfAo2gf37LkU318hjz3J8irXt4B3lKuu6cunZHKGBSFQDqHuuurnvSUuE623h3yxBW4Ne+w3KccstvIzzkmP64l7RfzBtwXQT6vYz4F8qltLZBPbZNSz3Y9qW38KtD3Qe5pfnO+zoL3enigyAA7cX3gnqx4B9v5JgFYzx150oNnnnjGZT/Qdczl7eUbeVyWn1/XGN1W3nXTmi9d3Hp+3ZoOUfaX2BTQ7kD/uoB99KA0XqpTfT6Qp4Qe/ShXF1Uf8Evc9VmCvCLOK+RL39AB6nvviBHpxqz5qOs7e3fTTS/Yx3kUT1AsefqW/08/fVX0Mb8P0FOfXTNsQf763+qgMAJ5Bd+pC10H+pgA+pm/9cyjh77t+yJwDkgDeu7Dwd7SmMue9TwHsQJhwZdBaxyW+5DDdVf5+VvyY1qq+zXAvhjyPp8C+dQ2B3nu3lbAd8B/oAsi7YHdAL8e9EN151Q126Y9fA/wRbXZ3IqAu3268XdRLuSQXnHTMxodcUHhso8xCMp7aeRxWX7uOP/IPvG7nDNDXnXzxZpf1vudRdnT3e3BZX+RT/y54bp/4vEror5molTXRdh3/SADVJqPZJf9oKTf+LjHVCFfm9Jt6uQFaj5oLHaHvH5jBWM9CPRuwWMtq7AQJXFcXqUNPuelTh5p2NdtYA946TlPQXc5Uw4gJKtYkM/WPJmFIvsd6FlsxzWfI+Pv+ZbvPfrMN39PaIk1PwZ56ZZXvmoA+X2D3sG6D/k1WvJjWqr7NcDukO/BXkB38O8T8um7GoN83J9Vfe1uzbvUYUxZLj1UOtyRms1FgfYCsuKlyJdKfhXPQEDhOz949NwXXB7ptsIYNfI45Ofsnb+xf1U5ZzZ+agAezekWeGKZciupg8v+Epqijj7cOI8+uwRxNP9wfSCCfCRaOsXxevmZD72l3ISuuqWUCSUo+2A1FfLFwic4Dw9Drp8XQLObXqpD2f6j11fQP3rbdeFWBPYC6lKxfzTFe9fVG8iXDBpgtCCfqxTILLwpnYttQByYA2PmDnkse46fq5s/F5B3iLa27Sq/pivv48e6Yp8G3B3yFfQC+r4hb96hMbhrfXXTp7HR3ZofQnta+bgoeKco+ikLXlY8+wG0fUC+VadPXuL7HYe6KsqbwtAB8qqXZ1u8ny2C7Xy/1jmUH/YgT5R9V+W6zJo/RNlfmlOAHque0uBIiVABezSj01jQsuYV2d7LFBof7Zg6Kz4HuXTWR2QkGgzngU9EIE8L8tltj2UebecfuKUH997vBz5R68EprPzYP/xXRy/+zp8JwBKt/9kb3xGZ9mff/xsB+6Vu/FHIW318Bn2GPPfNM3Ith7u6nQXwQFxAx10P4AG91iG57cdAzzYHe9bH/unlFfJZSyC6RhWkDcDuIr9O65qLrtsAu0NeoD9JyEech8Od9fT1wH1XN/rQTe/AntJmn00BPq+TZTmogzcrnu87oKVCQYGzg3qtKgzlTZwA6U7yaoU7Pxr18uQ3PGOtl2/AWRqcM8n3bYp334B8tcgXdFWr2CqOoeB1iLK/BKcW4DUpcEOQZ47lrJLt9pb8pmOc+OAT5KsINnnwzBOv+7n+YDWy4tFvvOLt3Sh17/xgD/S1Lr7AXctAjAyIMaKf96xfrqDHkv/ce68++uLv/dse7IHtFOwz5NESyGfQR7T9Iw/VKHvvGAfAA+8Mc+CeAZ8tevblOEBPsB33zpzf2d3fEqPzZchHRtywvrfVAKbHoL1cpwF2V4W8gDwC+VqN4wDfAvJjintquORbcqAjWehKdxXs5uqv6+69ox9F31BUo9FsrtYxd2legFsD+WrBU4ApcxU2NnlQ51L3Y/eqUgf/uU/d0hkW5wLyRdGXfVjzi1pJHTrGOUzjk5rREXynBKyBYnqgn/jQFyllIFGHLpd9KTmPWfMCPaCO0rVb9CYgRkEFyP/gs3/16Eee94YYKxq3P02PgDvdkH7x+i7zxEqiLf2YZQ9Qv/CmKyvklWlHxlugMQX5uM+HP/UEAXiCfAY9VjsAzoDPwM9iPyCO1a+mdVJ2948JSz4KRTYincN6WwmggmB+R3X7+aAG1Htgz5b8AsjXgp9rH5BX17Vy0RdFeloA+XxMLmAL/jqPYIMlyLcK4ElHKvy7Fc8x5AebwnzfZd9yvbt8P8G9ehN6z7vZpnzIz7e1zKLnXfAOojqi5F91m+drI/fh+4yeI+WLrgLrZc3pDlH2h2lsys3olIhJ2HLZb0DftSf1D3eJ5LavkC9WfFgYpe2tQz5b8ywjQM+9Uc89Bnm5xwV5yUGP+/6L17/16I9+/99Gxk+mqwA9wV1zOtdZC3meNbvtKczkADwATxM5AdiBPibtD+z5TR28CgYOdZcseSBPlDbg3Ye7XuAUuKoKCHX+AWzPlRqAb0G+wrwF+aJjhXwCfA/a7qZvWfgGd1/eWPRd3bus95wHONwlrPiaHxQLXmLdAN4jsK/bciuckkcoEE7pqD5PKgiQt/g5t1GcR6CnlcA9N0UHP10nP8NR9Tx/q+dI52vJrxkagbzyx+XWfD/K/uCyP0x1ys3ockImwQv0uRStxLVUtW6+fNCRyWRr/t47jmijT7MVh3v+HaAvEfdYEmOgB2LEFTjk/9EP/usN6D/2HwLwDC6DRQ/oGUIW4NGWPAMeYQGT6Z59+2trhh7DjhZozEE+3uEXP/0EHgPOi9WdwczcXfRzyrB3mI/p0//iNfGO8v1y/wKww3tOGZoDwCfQ5wLRiSjD238v0CLIl3W9KhxXLuy0NAX53B6+NkPtB9z1rPAM9rKcLflsxUsCCjAjzcs9PwV4tmXAO+Qd7IJ7hTwQzdsz4Mvz4S6PzrlKkG01DHoFlCE4d1Ft1hcu++680QdA8VggXc/zONfYPvl6df0U5FdY86Mu+wV1+ofpIp+akE9DR+YE1SpB+7KrD/lkzafSqpq99fqyT3BvWfRkBLjBHfRqtsawkQI9dfNu0QMpAA/oATySVY+u+KZnVvd99HhHAJTq5a+/9uiRj7+9B5YW6AV5nlk9WqmjmwzftYB30M/JO8Ph2TPkJYf4nOK5AZ4DylWs+RNTLlT48gJlmEfbdQd8Av2+IU9VUtxrbqcugLul7tZ7gjvHZSg62El7wD13UZvjchzuUli3jDbXsOKnIF9VIM+yA540Q9qla1nuieV8z4K90pTnRbuo13Y/2vzfHM+K18L39Twuy/edUpcnpiqV9IzRyqlUn4RVvsD1PoiyX+gFOEwX+TQK+TJ8ZLbmlbjH5B/8QHn0uAz6B9q93zncWaZ+nnlY5Nwb7mcDvTq1yJB30McY67dfF6APK/7Gd4d1HqAvYMB9r6h4WfOCvPZnvwz4DPls0bPMuPF00IMlLwvcgd0CeWvdWlE1QFVFuOqBSHHXs+zwXqKAYQbZlEpzw3OuBtBbOknIZ3GteLfZsq0C4sO66ry959IvsHdIAg3SGnXO2Tp3sOffGf5hxZeOb0jTLch7vjCQrHlBXvdLejl7d6RdupflmqRl0o96g6sGQo0t2Bgfg+tsoUfv6lz3PBuAx5ofg7fnb759ThXypXAmuHNddTUe3XsvtuY7lz1wxzvadaqzbFTSw3QRTxqT3t31Aj0fHB+fu+31keYPtvXh99Sy5Avk+aDlsm+66pMEenV9Kze9LHmi2d/yb94WMM+Qd9BHBO0dWPRvDWBj1TOXZU8GBJTluv/Mla+pGbIKAoiM2UEfmVixTgR5BeEBeSxrB/GctoU816KrX96PwO5yiPeA3mie1oLUlPL7OidqwHxO+4D84jp5fvPd9Cx4uef7kO9Zfw5+9rvlI50KDEnDVL+1wJ4B78u9/CBZ8RXQDTnIpB781TueQT6qth68+4lXXP7GSJ90MYtF/9iffKlXkAf22UuW86W10MWCl7gvLescQJ7hq3Xffjxaeq2Wap6o/7X0ePfg+z/5RmBdXfYLrPKmy/7o8WtpJj113GG6yCdFZQL5mrAL4BVhm635Vok5J6oB2A3yuQ4qu+wpsasTG6+XHwO92tCrfl6gp/6b52hB3kFPxgcEsOABvCCPOz5Af8f7I6ErKp7mdGTw2iY55GXRV0urWCpAHot6rrnbPvXZn78i3nO14pMc4nOKZwVwDZBP6ZxCvgHwKfF8qyDv8HaI+/q0nXncY3FtV7hn0bFUayTHBHr+G90ThVG6MAbKU2AfUwa7ftd28dkKN9jPwS6ej30EeQG+eBmANxboP3jWPw8v3PMuuyrSKAX2cN0nyGtZga09q34G9BnsLUVhJVnzvMexc+2q7v/eVL/wHIwk+sB77nxRWOVHXz5N1eTSgWuyy553uelU5wD5S3JSyY/OcEjENXEXyAv02W3vsF8E9x7k+wlboFdUPOBuwX0K9NxzBr3ORQbhgCfjEOiZk6FEaf3jb6+WPMuaA3/gSGkeCxzQR8Z823t6wXfIIZ8tM2VonAu3PfXjU73T7UOcnwxfgM+WeF7W7znF8wC/BsTnNADvhPzetpKg7b8XKENe/3X9PQb58rvOZyBfO7gpYM9pS99LD/iy0gvUcStjrdeCSHrXFOrw3AjwDvEp5f0z5KOPeqrrcuCcWfEZhNlydxf+wIrHWsXblQrnSqvPf84vxu9fev2vR7qp3joG00pVdIK9IJ/H2ohr4oYv13eoV7gXV73mOg7IuxXPeo7Jv/P2pepBvrjsu+HCH332oFncgrp5uewpFAD5GoA3Uzg4TBfpFJAv3doC8l4pPoGe39H5RemnWgkpPm51dmOu+6aqW60fUSqXPaBWxzheN++Al972qn/fa1oH5FHPImhAnjmgZzvjSAMwuemzyz5Dn8TI8LXAPgYKueP9FfQOwx7oi+ueZyYzomROlcLHXvOGvYNe5+K8NP2LTPGeD/YKJBWiBV767VCXtC2eZwsrPqDpED5ONcC9RoshbzEag/kE5OO8pzqwR3OxDD7BT+v4fvje0j2FeLe2zP3QVJJCpNL0NnIrnm+/WuBAO7vc832O1Mn38gcF7CXIR3302bsj/WfIo//jua+LddTVA3r1lcFcVr3c9x3oS2yC7osCUYFwhXNyzbu0jX3jvm+/PkDfK8QkyOv824C+B/kyeFdntdMdOfFSg37pJ6356rIvw8+GNX9oM3/pTgq6E+SnrHkSfM9tn6GdrHnNs3rrMuQz6IvLnmt7AJ6D3a15QK9R67JFT93eAPLJQpBFr0A8IJbd9sD9T+56V4V+gPLeOyIgL4aftY5kAIzmA9DfUwbBkEX/wC2RYdGf/L5BT5Adg+q4Be9wz/J9HPT1uQSUpUpBd/X62yrfs28b228HCeatdT3IO/znIJ/fi6zict9U5eia9Vz+TsvxLiz6DHkH9zaqVjzfbXbTZxnkW7DP+QDbYm6WPNCmwJ0L4qRTpE6t2P5f7n8wrH7gTh2+QK+6+shT5PFQ2/0EYoe6S9Z8hnjUy6f28ioE5HM7wKfUex/WMiIHzBVr/nWs6+rY54GtDs7Yv7r6D23mL81JHeEQySnIR8LOVvyI216Ad8s+f8RN5YCiBHpZ8//1wTMB7Lk6+SboX/Xao1t//2MRqEMmgIuv6bJ3q7647Xk+oC6gZyteisz+rpuizjO6yB0BYgv21UorAXlq7rdP0H/8e54XEODcnz+9gbcgEr8bQPN7bymeZww6I4rzNwL3tpLu19e7Gs+3Vhnao9tmIE9f9E3IJ9BnQPu7833mRHUT94O7fh+QlxWfI+orzBtQd3l+kOdI6V+R8/RvQTqshfBixbPMXKB/4Q+9OgaQIe1gqVI4yFa9DIcO8mU0zAT5JaDn/gXyADju+hKA1wP06c79vwT0+dnzOXKEfczp0rZY7NWaL5b5pm5+HNjy0OIBAPI1AG/CA3CYLtKplPjenCFfrfkR0Ee0fW5Wlwah8Q/atfmo+6X4XDdPwn3HW989CMBzsAvuWbLouX9AD/AnIV+U3fYk7mzNO+Cr67646gGX5i5Bx0Evi565LHrqUFsR97Sf93UtRf37K14Z18N67wF+Au6ufO9alscinkWAWqLU293OgJe4T1/Xkp4pLy9UhnsL9BnyAXGHfFEFt8C/T6Xr5HsS5KmP38VdL2m8+Gp9y1XfgHpLY6DzAj6ApoAvyAvuEr8RnVqxD1I6j7E2SiwO0enVopc1Xyx6h70D3RXPkKz1eIbbr+/laezneZ/2z2rliZv80CB/5tajgHIZWKxlzc9FzOcAPEC/pD7/MF2EEx+Cgu6ySNwt0KvTjF4nOUk5EfsH3fywS0KP+rgUgEcp3TvGEfDnQP87V74vSvpY9WzP1npL7rYnWj/atCdr3kHvvwdwb60rsI8MRfX0p7shLmXRMyxu7upWkJcc7II71vvn3/GbcS7g/vDHi8chQ07xAw2oZY3df4U0QHGYtxQdBg2PHcB4rfI58jO6/Pl3UAvyMQe2xVvhgO+BfZ+Qt2v4fQH5h1/btRpxYC9RrosneDWgU75VB7gr4NYAu+cHUcjN3T6ndB+Qf9YvV6hLWPF5WQF5v/6G345CMp67CnqkKoAM+hHYO4wzpLVc5yUAj+dQ4cCP9XOg2L/Mm3nhIMI+QT7VzS91v+cAvE10/qHN/CU1edCdqwV5gZ5MoGfNywWd6ujHtPmwNy57QT7XzdfmdAZ6V7biJYaZJQNQhuFSZqHlvI1jyNxUF+8iM/VlQMJcgOzJ6qIz6LNlj2hex7v55A/8eNOqd7hTICC4DusC6x2490C+I+CakC/nDOA42BPgJ48/Ttn9+7pdleHaWm5Cflf5eRtVCNI+LXmNF6+061CfkgOvlw+UtA+E5WIH0njwSLcZ6D/8/b8UaoFe7nt6t5T7XtH2suh1nVHYJ+DX5xSceZYM+7Kv6ucVdCzQO+D9uVvvIn5bMzqg79b6INL+qCsEeL6uKQfg9Vz2E8ccpotsUn087eMd8NWab0BeoI9Sfm/c+XnI+wfe+7gt0j5b8w52B7y77HHpAWwygRbUXQJ8dttjzXt9fIZ7VoWYoN/IfDPosvu+RvIW2EcA0YNnnsAyZ1hZt+pZR2BVBNbd/LvVes/3NgeC1SoAHcC6Abd8jIN9cPxxKt+7P88O0jPm+WIJ2A7xMfnxE/+ptu1qyUe6L1Z8WJiAboEV75qCvAr3suIDwo88VCEvqGfISxTgBXvmpHXSrNz30cyudHctT0GFfFYGfgPyrfyq91ypSR3vZ+p5pzQKeXOvd/n1V56vSPsl7d89AM/PeZgu4kn1PC1XfdOab0Tb49aO+rpo9rGpZx/APkG/+fGXUn10aGHWfK6bbwmoO+xx12e4qz4vAz5bBHmbQJ/d9m6hZ4i3gN5a19NIBD4ZCHMscsGe90VdPZZZdMJDxn/6Q52Lv0TN91zzRQRgORimADGpBE7d9xJQZ6Breclxe5Hfvz/THuUQXqUx6Pt+SX79LL49YgQE+V0seVnx20JeytCrQCugVcBd7QnyZ38lqtey5Y74DcyZZ8Dn/dRxDsG2RN9TaODcpOGw6LP73pWse+6T+/a5LHs9A3MK2Vj1sugr9HOBIfUfMMj7WpAvzeg6iNOMbgPkgTU/MwBN563tCgbVmj+47C+NSU3nPODOpVJ9VaN+HrdYTSgti34h5AP0CfI10r7UrbfkVrws+Z98wdWjVrtnHr5NoFe0PVCVS16wHwO9W/zZsvYM2aHny8AbC716Su6/Ln6rzl0gz+d0ICwBw9j9VRVILgG0w7y17PvsXa37b63fg/Te/H0fp/wesninWPKf+N+ff3TTO98S1rjDe06k6WgTniPqG/BeqoFlm9K7rGzq0hV0RxpsWe5Iy8y1nEGvAjoxOeRPuU29qgaalr258Ad5VAvMcr+nOvq8rRYYzMr387Qgz3Kr3l35NtAm724VBHxSAB77H1z2l8iUrfg5yFfQmzUfgH/nB8PaZR/cy4oY7z5Ys+wbCaVKXoAG6NUDFtY8AM918w73DPmX/sgbe5DP0bnKMPKyfuuYXrQ9gL3rXX0olUzVrfYMd8+cpzJqP09er174PndrN7ytjs/n8vO3pP38GlPrB1pgxc9BfGz93pTutc7z+mOSv+/jkF8zlJ6Td4vHh0BMmtBtA3mkoNqwShPkBSUH+ZS0v9K6jIEadFc6wVEPlQJ3TptY8UDd59ov76+0q85zZNVTkKiAL3lMXS6gj/vLdfUzXfXqHQnevW0NmPt6bauQTyqW+qCpnKz5Cu1Za76rlq3W/4KCwWG6wCdFXY4BnkTu69ySB/ISoCeBUkoW6LOUEPzj7ilA3+jTvjSpY8S5seC7FuRf+Y/fVJvhuHLmkTMIWQ7ZmlcnOREclKx5QTlb6/n3HOTHNICFuW61ve4349ptaQCJNZAXVCY0B/G5QsDOWnCPdb89au4d+z7bys8p8c1RhYMl/5+/5/lbQZ40ThPZsOKBs6zblZCvzc9QcXMP0rnSeoE818aSVzrMgB+Tp2WlcY1Nof7vqfbDqldHWQrOkxtfLvJc3diy6KfysSmQZ/l5433G2AT92KQKcGvbLmuegOmNNT8+cE0OwOu5+Q9t5i/OSX/4XF28RCaBKugbkJdiNLhiAYy67sdUEn9tSpfGUyYDoDTubnuAPgb5V7/kLbXpXLbiW5B30Gs/d9s/9sD/GxlphdNIRrsa8GP1sOogxdcL8hPbXRkwDp08XySH5RY6VsgvlT/XDmq925b8f5lTPi7Pq+yZeKdfeNOVR2f+1jOP6DJ5LeQRaU7wCSg1ID6mXicytk2Ay5a8rGngS106UM4F7jnIt0BPeuc8eZhpCut49+g3Q83t5MIXVN2iz7B3dWAeAr2+s9IBj2/Pyn3rDyBfm9F1EfaDfPyRP/qWngt+BtrqD4V9o2Awct7DdBFMirYcs+JdgjwiCh8xBOItb/r9jwvugj4ZRLRPTfVcNaGw3PjQqxzyWdbdreDeAn1eJ8gD7Ja7fkwCvdrPc57o254BNO56Vy9DdTf7sUC+tU3HqaOVMZVjM2DGoNODx5wcmA3YtJbH9jln8uc6YQ3+L/svJv8XexYVnAi62wbyTSseQAtqBdZuyWegt+DeAnzPYr3/tujQBtd6hrzSo0O9Je2nOnwK+YBdoJdVj7gOsCdPUX09eUyrnr7et72HKYt9bL3UFQA69dZbZzgEPo5Z6RoevNfV7YQLPgfgbaz/6cj8w3QBTmqCMdYu3pUB35X+Hr+2NL/4WkBPxiDIC/R0SxmgD1f9sG1qfNAtqz658Zqgv/eOyAhwneO2d7i7sOZJ8C3Ie32fK1vzHNeKth8DxSrIj0VWJ9Etam+dH1/apA+22TUyUAawmIPJmByYI3LguxXfhP2K8+8kf6ZzqKn/pyl7lhhG+Lb3HN33oz8a3SMDeWDmMG8JwJPmSWcba3SdW77XS1xD2cMnS15uc6xr2rqTXpUGFVznQJ8S6ZXxKsgreC4C8P7Gt76sgl6wxzsn2MuNH4X4apTclmBcevS0akdZ89IgT2vAXfMK+OoxKAPqqE6+5IOlC9vLB/XyyQW/2JpPPeAt2f8wXWDTWjd9hnwf8J/9asRYxznSXgKEuO1r/by77LPrPs/Thx6R9Q76M7dF15UkSI1S5xa9Q/5lP9I1q8mu+jXWPMrN78gwyEjdmm9l1LPK4M6gdvm2BO7R7X6dBuQ1z/fdWj8rh2ZSBvqY6jtsHH8cal1/8EwXghrPpfr4h77t+0L/6aevWgx51DWZS+3ikwXrwG6B3QHvv1uWvKrj1P10TntrAY84njSrYDvyC+rjgTrnVxWcW/YUcsi3uBdgr86pAvjlvlXwyYAX9GOeAo1blv4G7IyOd3NvnqVqg/Au1OC7IYxzG/glAXU5Mr9a/4c28xfPlCMyHeRjcK+AL9Gb+hj4WLDkM9yz2x7QUzKONqq5aUgKxGtrA3l95II89fOR8B68+wnOPQV6loE8232Ai2zNtyx6ZRay5jWXNU8AYG47H6BIme8Asi6HuEDtsM7bfJ1g3tpu12vV2es+B+CYWN9UA6ItZZgPALsL5Ffcg9S8B3+uC0GN5+K7pD8FQf6dV3aDuDjMXQCOtN4FnyUo5TbiDQnwWb5Nv2P0NrPk5aoHxuQbgHgK8jSLdai3xHkoNKh7W/ILmueRdgV7t+zVax4FAryRcuWHcQHsBfbcRW2x8Kulny13/51Bb1CvcC/5ZM0DS9431uStc8HbIDQz1nnDmh9E7x+mC3BS/Q3AbkE9gz0v49bvOk5gJKTUIUMD8lkkJuqwKUVX0Jfo1SHYh5DXRy7I1wA85mduixJ3Bj1AH7Pmcz/YLdA75AV65hnyAj3ne+CG9x0pCE8ZrOrmHagDOawFaod10egIZlOQT/N9Ql4Fmt68AdIMnhZYe4DdVn5/vr0hv37vHvx857Maz0ZfDvzXp/7hjx394eX/LKLrP3T1v1xkyZPmSVc5LTrQ5+DuUM9SPbZDXu560jJBtaRPQX7MVQ/op2BPcB1pFFhTeKgR9AX2FHre8m/eFl45r7MX8MkvsO55N+Q7isDn/mXhy1KXZQ+g4ze91RVrXQWDDfi7dc25IF+C7gLwZ27r6uUnLO7cOU7t0W7Omn/i8SuyNX8IwLvApwD8E49fAbAd4m7JZws+A354zmnIM2AE9WAklOiMoiQQuaGGcO9DvlrxCfQV8tThFde9mtYpGE9WfLbmqZ9TBxveOY5A3gK8lPdXJkCGNNUTXrNOPgPYNQH50fVjkLftX/zwWwf3wj1OwXxUI9D09Xm7z5uA3UWN+xqTX39wL/6857Ps2aKjpN/4+aiPB/Kf/AcvjELwFOSx4JlHr5Vnbu27p0eayznUXQ74ngzwCIAyVCzQdcg71LXcAr0KBYI8kfpAPvqvL9WHuh6/sezxHmC9C/YepKdOdTgX7wkLP1z6xdgQ8PXeOujf3Fn7qn8vdfvZgBHQfV3eJksebYLvhha34qwG1nzD8tfUReZ3zenmCgWH6TyfZMEL8Fljlvwc4JnUHMPhjkgMtFFXIhHoax19Kal2H/RCyAv0ybInIpZzcm6BHqhn0EvZmm9pzKIfs+Z5LjJIb1I3ac07hJPCWm/BWsOY+vol27eAfGsdciC6WiB1qPp2P+645ffsiv0az96SH9uSH7M3NZ5N3SIzngEWPJD/pee86OjHXnzFZHR9ddNHekzpMLX5HoB6BvS+L6rD0np9fOnVEhhH0N1lV1VYZ0ve4T4FetZxHsBM8F30xllU28Rz/ftOhWWPKAix/5R1j8gHiNqncBDvjfOWMexVSKr92ad+7cOab8BcVry29+Be7pkCWAE3kfBT+XG/f/oJcGt/8vmDy/4Cnfhzixsn/sgMcLqrdNivATwT2wjg8w5yJDU9A5KKYlX3kl1nOZumKvFRF+u+ZgBjkHeVTIKEShyA+rjP9fQaX57EC6SjSVzDoh+TFwiU6KmOINCJ4WjJfHNTulFLfkxjlvwUxOe265qc98Z39+6JexwDeksOMFeG6Gqw7llz5/V7GNxPqo5w+f4t6RzHosbzIKx4/mu56j/zilfG9z4FeVnxUWhOvVNmMG0D+THQe9CdLHnyBA0vm+vilwDeIa/9le9grUe9fAF87vgm5zmsjxiiB888AfDxRHIfbt1n4KsOn7xN0JcBEv2FKH8qAuIKbBTQtU75G8t4CwA14w5IOS7K82Km0br5uf1lzS8Ym/4wnUdTAD51lJABLsg76IeAny7VqUtcZRSRaRQrnrowStICpBIcUFRAi6LuM+Rb8znIy6IX6Lm+Rq1z0FNKz+PKO7wd7hnyzN2a55lIgD1rfqoJnUPYYD1YV9aPQnxuu0FeoB+AY0YOsSVaAtSpfR1i28rP5deeUn72te/B3+GuinPas8WARmVOGmAQI1nxpAGqy577gssnIa828dmKr9b3lpD3fXtqBN3JklbQnVvxS0Av2OsYXPZAWEPPZmu+Qr40VcvPL+CHe//BM9H5FxCXJ1CAz+I9S+xH9SBeAcDPcyEi/cn7KHTI3c/vrMi7XvXaqGJhzAGNHUDex/80FnynSd7VxdZ8qsvftJmfzvcP0zmeAu7dH3252k4K5gL7LOBjMIRxC54pSoGPfvkZ7O8ZByJRqG4NIMoVTgJAJBwlPGAfUJcLrQH+CM5xyJe2tVrOATwkGAXkecS9Eqsgn2Gfgd5Sy5p/+c+/vowE1w1HS4bchLwD2HUClvw2kHd4LdVSqI4B2H+39m8pH9vaNnVu17bPX6/feJ9Lla8f6xqAlyIN3fy7tS6eZnNyOY9BfhBN32j6hRzgUxoAvaUG5Bl5jkA40iaAXmvJO+TlsqdQD1x7kE9WfKhAPldX8D6jAFXuFSjzrvB4AmyMGCx9QI7rnryBOfdNvse1n/q3nxP6i1//jKNv/vbnHj3jsh+I/4L8AmHw4GXhufFA0vcH/wswVwGE96/6/g7y09a2W+fLrPnUnG5i38N0HkzRdh3rXd0W3vyR+DAc7hnybI8CwK2//4XOgqfUN1+S6z6Orzyfnu888yAh4MKS2y1bvyQGDQUJhJUAHfQDC37Gmq/Af6AbrlKlcBKQAvJUVz8VhJdBn3/ndVpWW1tZ893gNW+PDFmQXwX6CcjT7nmwPm1fCnndkwNlSg6wpXKw5nUOXF+3VhWqCa7N9TteZ6n8HW4jnaeebwTwuOllxQN4Or8hjWWXMmmylU5xDStgLIO+V5d850crxGN9kQN+EeQbbeTVfI60yr2SvjLkHeRj8np50ihpc2DJZ8j3OrsZKuISyvNGAJ264S3WPuch/yE/JXCQuQLzeL/8Zs465bUsK2+OTsPMmxDv/PbrO+naxaU/1vNdnnLd/JKgul4AXvSYN33+w3TCU2e5C+6Pv5o/lI9HEtAd9tmyVwlOndz4NVqTmmBQOPCMA5d9LpG7SHwkQhI0+6lrSTWzq4F5al5T4K76uwHoE+AlRdASA8B9qZ5eoP9nz/u/e93dOtyzRe+wz16AXDdPhkvdfAZpD/A7QP7z7/jNWKZ5lLq4rV3dGuRj6NnzDPIO2Qza1ro1Gr1GASPD8bb2Py75+9tW9Xzp/aAMeEGeb0FWPMF2qkMW5JU2sxWPO5d0VqPpS118DrhbY8kPgN5ShnyBLQUUguOwjFXFtw3kBfrs6pclTx/1qtrrAb40datR8Nxfbf+uyPgyfnwJHIz/hOqK8v7juco+mkcexrmqt6CcR8+vd1HOGxLUE+DzfwHkNz3fjUNYXtaeNX/0+LVjTeRyoaArEMxX1R6mE5hacOcjyIBvwd411gZ+btKHkTvVIfOg8KDE2oJ8tpDZLqs+dz6hCPyem15g9x7wBPkJ4HNOSvPUdeG+/50r3zfaE55b9g57AT7vJ2ueOjTq5rM134T8GOwnIN+y5Mcg39MI5Fl2qIxqSwDn4xxUU/LzzCmOS/dZlwsoVW+9zbm3ka4zeI8r5OdDeg4HPHMi6gH8e//Jz/aqoxC/3YoH8KQNwV1u+pgb5Fugz5b8AORTaljypHdADKRJj8ortoF8dvHLkKBeXM3oHPI1un3QWU2KRTjdPb+e2Z8pezcGErCzZX779UeP3n7dYF223F3dfzM+7KxPalEVHl31UW9j0qd9a8BeLRAcXPbHO5V6dRPdyP7B10aPcwH2rzyfP1ulNYd6hntr3TbWe54UdNdqgkd9PIk0160Bwwx76q0EfQJkKBgAYeZyrwF41UdVF36CexQAJuCerXpFzVLvpWZ2wJ7lyBSLVQ+wHfqubM3rGFnzuW7eoToKd2kM8gC9QL6C3Y6TpT/QCOQdKpPaEpAtePu6lvJ++Vyt8/bW2b0CP+aMq04PcMzZFs+/xfOs0eAdrpHdm56pZcHLTS8r/sXfuWnrrW9TTT3Dy1YseOrAw+1cgCs3sSDfgpmDfivIy6JNlrwi65UGyS+2hbxAr/yHtE26pBBBXjAGefVgp+FwmecCTawD/CynOevzOu3ryzqPr8/bYp6hn/br3ltn9CyBcLbma5/2HDdmzace8JZUCRymHaaNdf7oszsFzC8Pax0oU2fylbO347bJlvuUFZ/hXuveS3DdNn+kPqDWADdAnvp4ubaVWDPc828S9k/9+K+GW52ESKLExSbL3vuQXlIvT0J20CP1kEf1AG3qEaBHsuqzle5wJ8PMv/M+ykwJoMGaz03qBhZ9hq/Beg7yTS2APIWDfD8DsEzJgLpUflyGs9aPrWsdn89Tt9u9xrsWCD9wTVi4dO3KQC2AkPfh5zsO+X1NyY/r/R4BPALw/O8C/Nt//OXxDfI9CvJIkJenTU27qjWtjqnkri6QGwC6yCG/CvSt+vgyhLRXn62FvPbNEfY5f6HjrHjuVCefLfko5KTnzmDO63zbnNbs27TmS+ELyHP/Uz3f5Slb8+T/m3x/aNRF9WsZze7gsj/maVMCe/zaeNlHXz7NixfUswT3vOxgr3CvrvnHXret9a6pc++0R7FT+3ivG8tgz7AnMVMoIPMBxHgBsOypMwe8wJ5SvjqbwHrJsFeCdaAH1B/aLP/x2TvrOkBPoifjA/RY99HX/pXviw581L4/gz3PHfYZ+ETLfv70e3p181mTFv0Y5Efc9Xn7HOTZRxDcFvIt4I5pDN5z61x+Xt6t17FLAb57Phgd/2C53/xt33v0mW/+nh7keXY/bh8avK8cMDej3nnsvTjYsxXPe/jYP708AE9hBivev0tBnnQUaezhT9Ve35CCvVRf3AP9hASv1aBvuOq5J9IfBRNViymfELjJE/J8TDm/4TeQJ3+hEBGQlxFQWu7UevdsyScrnnvOkNZya52rtb61Lq8fbFfdvHoKDch/+fRUIJ0mt+a7AcbaBYSDy/6Ep65URTOIx69Vb0S42DLUXQ72CvgaNf/Ym4sLZivrPU8q9bUGucHd3oK8W/QOe6xrQEzE/S+88B1VgJ5oeEDMNSjJqkMLMimsGRSu+wbox5QHrOC8WOBIHfnQHEZu/OrOTy59h7vWuzWfAU+GXkHvMC4gbkJ+zpKf2p6upeuvBv0EdB1O+XdPKdrdz+fr8jXZ3lWBvD/qMSPTLcFOsY7gRp7vA9dUtzVjqD/wlO8IsAvwiPHVOWc8+8zzrNXgnc3Ij49zNN6Jw12AJ+O/5ZWvCsDLiq+eqBRZr8A7IM/3ru9f6afWw5dubFUP7dB2kGe4t/ZtnSNkrvqw5B956Anuj3slPWlsCYFac2kO9Bn2nEsR9hQm9OzVmlf3s3f1e/fTczmMz5XivZV7Dmt7xCL3SdY8DKhu+5E6/YPL/oSn6rZnEIFi1fPn8geMWe45oI79qDPfWO67w12TOlxoQR4gUxrPkB8DPCIxkyiBPBGw0TVtgjyBcgAX2GPdU4dOUxuuFx1KFAtfwO+58ycs+7quuPARBSmC5zLsERkQ98d9KGpZgHfIM6ctbGdtdnXzDtYAvQFYoFoC+Va9/ADyXj1QIK/rO3Qm1QCzg2lKzf0mztuD4J0f7bmkmUsCOECXBPQs9gvAj8B1G+lcg3c1IT9H73z+fsr7cMAL8qfe+Iv1nWDFRydPctMXyAv6ctdHhHn57gOuivpOoHN476o5yEeQ7dk7w4PHvSpPUMyOoI01jpeN/IXlMdCrCZ3yHKQWPBQmsOZzAF60j0+Q9/t32J4TyV1f3lu47GdGmdMU8VylUzS57ccAHsZbHrTm4LI/mSn+JABd6+kff7Wgzx+RRWmtgh13TgwLGwF7e4G7Ju6lFXSHyGyAfLbiM+yzBZ/hL8hHYNwL3xG91QH4LIFfiR3gZwtfQ0qSicnClxzuWbRvDXf+w58K4JMRAHzW49an8ALso19ts+RzE7tszXNfirSXizjD3gEcukAgv1QVXvkcrXOXZYcaFjwdvNBNa7bMs3U+JvYBgsCdd8N1cPXLinfIrtXgORryY8Y0eF9FDncB/nPvvbq66WXF1zp4eZxSfAm9sAF5pY0MeVnwqot2QDv0lmoA9wnIA1/qzWXJSxnUpHl1QEM6pNDfAj37ZgODZXkyBPkKeo2IWdz13HcGPYDV/MRldfNdU7487Ox0pzh5ErzhA4ahgq69kFDd+weX/bmd+tBXUB569NnlT//a4wC7JtXdeH28QEjm4q76McjXZmmXXdUN9PInX4q68eilrgH5LG0H9AI+XgDugXuJhFyg37P0k1Wv7VLU2eHSK7DHxcf9aOAbNU0aa06nunw1qfvcrdc2rfke6A3yMZDMGORHCgBoUCevc6c54NF8kRzQWWPrx+TnLlIBCIDF/APXRBQ84r5ZB6hRff703v7be98bYlvMS8Em3x/nAPAO1jzvbfN68sZ9L5Wf25Wvr/t1sKvAA+BpKgng1WROVvwY5Fkvd3VAvrjIq6tegC+Q25c1P4A7sjbysuK5N9KOWrbk4Fzm/MbSx4MH5FnO1rzDPuc35EW8Aw1UQ9omnctl75DPGoD3JDUH+ZkObnzKrvjapK5xfHhpey774T6H6QSnAvwq334ck0qF6g8/Qz63j3fAZ8jLis+JOCyNRx6KgsKYJe9inyxBP7a9/JpwuxNRjIuKkrt6wSORs073ncX+gB1LHLjngW7kEs1gz8vZmidj5XjVzQsWA9BnMC+05FsabM+WfAbfGrVg7ttn5FDreREEtOuvDYhnK53+11kP3LQfoFbgnZZRBNuZ8r4qSPTueQt3+zby5x+T7svhngHP+xDgBfnfflHXTXQP8A77y64KkCr4tOeqLwF3LcjtqinI13rxs3eHFw9rW5DPIn9gLsgL9EAe698BL8hn2PP8dCObIc97iOurxztz1w+ge9IyyMe7kwfkvlNdvfwKd3oXR9UNRUveV615s9QVbyXv8Fj9/WG6iCcNaOD18WQiuX18C/CayxWnEjsioZMIgWy21NfIge/QV7M5lrVN4t7V1732z8PUIlnq3k5ecM/WPCLz/eyN74jubgWaAeSzNT8H+ZFtAcn3/srmdwPwqyGfod6A9+h6U4VY9iIQQHfbe8IqJQr+1NO/b1CfDsA4DkgL1JovEeePeboP3ff5And/Rw53KQB/47sD8FRBAHjNX/6DL67fW/32zF2vOvkcVX/OIF8i6xU8K8hzv0BeBkB218uSB+6CPO77lhXv1jwivZIW1fOd3PXh1WNkuNSETvc+gO4+5Z3g+Pa0j+4nR9crpmCtO10dmCmuq1XvLk/twWV/iU61zubosQ/L8s2Qp54s16M55HPildSWVZY85xKwHeJr5FZ+VRmRbkoOd1nycikK8hnumgv0UW9/2VXRwQ8Z9VjdPFoC+dEe7Xx7A+6rAd+AlMM79vN1DcDLUlegHMJKB+ynn/ZdA7gTGQ/4uef8rrie5rMauZf6HL7/Mcjf3xI52GXBc88Cu1z0qNe73WVXdZA3Cx4BeUA6gHw0Ieu7649DA8inFjKkeVzp3GOOb8mQR+QtGfIcMxWAl/MedYqTg+9kzQfki8veA+8G4N2nxuDe2Id7qe76Ang8kmPN4camnH8rWDtc8naOXl/2B5f9pTV1pbzHLqc+vuXmVoJywGdlKx6RSFk/BXnBNy8vWdfa5hrbR2DPoOe+M+Q9U3Loy22vwWsEeTQJ+WzdZ4iPFADqsQ24bwt5B5VDc4nqs978uwEnD45zRWc1tOeny89ixXMfek/+3vRb9xvLBeJ5ud5/4xmPSw7wMeldOeCjP/n7rwt9+l+8ZgB4lPuoz5BX2mpBHsiugfzY+jVquepV4BDk1UY+V+UJ8uQpVJUB9wz6qQC8DHoF33Gd6BTn7J0RfxPWfHHZnzjkF0r3kevkN5Cnvfy6oWFV3QrAq9v+qLPWBXK1njq47C/Bqauv6fqrz5a8gu5IoEshL5EYOU79S2fIC8JjID5OuSWPuH9BXiCXWrCXZM13o9SVzL3VG576oG9AvlkAyCD33ztCfgxGS5T3Z5lnB9wE02HFy4JHLAOwCLQr1nt2y+t+MtQ19+3+DOdK/u5ayu8mK9qsF7gjvBotwLdc9Rnyeb7EkncwV0DnjmEm9htTz11vkAe2pHlgPQd51gNpQZ5oeQXgUTfvgHfI8x7YnyrBpZB3OYCPXcVdz3JUKdDcL0G+DFbzOo+Sn5oifqsE4ZGPp/r5eh4VBNRk++Cyv4Qm9Vev+vhsyZPoyGymIJ/db0rMWhbkOZdD3gF83HK4O+Q9QGjMopc1rw5yyMQFKWAgMG0FeQd5a92WkG8Baa3ysXpmMqtHb/lIRMHXCHos97K/wJ0BXo9NVrvPzyf5u2upBfiod0/L6DNXti14ueoBl+qxXRnyiq4fteRnmsptG3k/qJNvRNZjWatpKulG+QLLGdKsB9LkM7LkpwLwdJzOwfnU852C7zLkCb5TZzj5GfhmNT9RuTu/jA6YId9Z811/9Gvc6QrCwyMrt/1mdLuuZZbq5WlKPNau/jBdZJP+eDWdy5Y8HwIJTnXsDvcpyJM4SYBqQse5MuRPWg72LDKJbMkzd2XoRyZbQB9DXt78kZ7bHij0QJ8t9CnIr5SDaEwOIwfTEo3ty/oMbAFNvzPY8/34er+vuN7Iem07afk9uPROHPKqg58D/Gde8cquhzuz4scgny15jewYsFXQ3Qzkt9Uc5AmC475U5SC453xCsGYdTWUFdwTwWUce4pDnmGzNkyZ5DxR2FHwXdfJAk/4CRoLv8vMMQHyC4vrZZV8hvyWAcxBerZ9Pdfydtf/Yh8mPWwF6h+kinPRRZFd9FqVsEtIU5AV6d9ezXkExJMJzBXmHehaj1gnyUQdaLA+HfLbqM+TJyIje78DWBeGR0TvYHNAD2DcA7utachC5HEQuh/ZS1WO5Tlnn1nrdlu6F+ZTFrn3yvCU/7iTk99C7n5lmcnOAz656fYd8Z/retDxqyasr2ROAPOoB3tz1wFZ91mfvmCCvufII0p9DPgfgtUCfCwq8B8X+jAXfTXkrHLz71NT5df1WvfzapnSachCeue2jk5xcCOj6vH/82jXVAofpApzUy12rPp45CW0p5DUnE1Iijs46EuTXBM/tSw52hzzd6mbIO9xboM9ue2UytJ2v1nyCm2sA+wa8l8rPvRRKGU7bavYcjftprVsrjmsWKI5Zfh9ZDnfAt9RFLxGIp2/RLfgsvj8AiheJMRrCki+W60lBHjnka0HjkYcmIZ9FHpGD77LGIJ8tedXLUygYg/xcEKLDd1/y67SuFetw2ad6+U17+WF79yWT6t6z2z5F0wP5yzk/efzaSP7DdIFNnau+q8PJ1rsgT2Q9mYqXnD2htkDPnAxLJWy6ks3gPQnIA3HNp7QG8oK7LCwdE/WCN39kCHmfFzmst5WDaCmUpAGYV6h1nvzsve1b3t+YzgXkkd+Hntkhryh6lpcAHlf9//eyV/bq4/WNZWveIU9ddIW8QH/MkNd5A/KKri/XV/M5PIAKunPAKw+R651nUnv5bM2zju0O+ZznqF6fd1GHnU3jy2s0PrnsW3XzxyV/b369+j7vKsMB6x2Wjr22BXB1y5d+T2L8k2K1h5VP5zlHXz69qZdfF8l/mC6gyV312YJnTmmcTKcF+SWwJ/FxDnUle9IR9Q7zlrDkaa6zFPKyStyaJ0MjcIhMXS77KgCheZIDexv5OaeA1JKDe6n8PHNac09LdK4gj/J98C4y3HMd/BLAA3fN/9NPdwPQjEE+z9lPAWdy12uY1TqG/AlCXq76JZBX/iHIq15efdgL8mPWvI7N51PVRR6sJwazCmu+vI+JwWo0dwj7ujXy67TOF+sUfFe8IRRQOsirKd06yDPlWKs8uBngf+A9d74IuKf+7ldF8h+mC2SK0l4akMYteRIMvcgBeSUwB7wnNAEekbCBp+rkcStyvpN01zvQWwLyZDCC9Rzkpby/CghkNLw7Mv4B6BGQ0LxoDNq+Xtt8vyk5GF1T0B7ce9qvtf+clt7TUp0zyJf34Ja7lAEPvOcAnyGvoLsM+V6h0oLuAClpK+Ce3PVALUY4Y9herFcDloNnWwXgS0c44abnHs7eXfusV1ri3h3uWha4vV5eIm26q75lzefBamTJtyAvl71g34PtBKAdzi35fn6Ose2CfHbZA/ltmtLlqTPiuuFow5ovoP/MR2/4DH18APlaL//IH32LH3+YLvCptI2/vNVsTpAnoIwMxUvPWnbIC/Ask7BJoOpyEshj6Z4U5AXxvNwSkKf72zWQz3CXRa91tJ0n4yPa3gGZITGAh8kBvwbuyKHYUga3a3DvE/uetDLgTxLyXHsM8AC19mR323tqV7VzgM+Q5zscs+Qz5FkGaoARFzWAze56d08HVBpQ21XRN3xY8gXwBfKkefXYpwK/Qzlb5cxb9fJAm/Qraz7v7/mR2svzPqolb8F3rSj7pe/Dgd6S9stzl+8f6xLko8BWIN9Z8+ub0mmSIZfbziPgztDbWqYQsE0k/2E6zydvG59d9dTFA2WCWUikKjnnUnQL8gI9czIjQZ72qw55dFKgn5JDHjnUx9QCPZkbbefJ7JvW/ALAo2y5+7YlcjBuo/MJ7FknCnkr4IxBXnXwX/r9t60CvCD/4P/18/Ed6ntyyGsOzAR5BmcBanLXZ0u+BXmHUgtEcy5+HdOrj7fIevVZTxrhXpUnZOMgQx6A83yk2eyyl4C8W/I6VuflOopRyEPvVmveIJ/fhz9jS/7eWsrvZ+y8vn9dn4LvuOcK+R27n221nUcP3PC+cOHX6PsnHr/iUC9/EU054E6Az9a8LHkGiwBeuRTtakEekWhryfrhTz3BvGXJHyfoHegtAXnuYRvI533JZHQ8mQ2JiMx/F9DvIgfjxaYTATxKhRwHuyQLnuGE1wJeIrKe9DMF+Qr6MjhNdU833PUDyC9VOsYBJUjVOnnc343IetJ5Hn1OecMY5JmTZ7z6JW9pQp58hONb1nw+twbsUb28AhK9H3t/L/6MYxq8q6TWvr6udY66vljz3Gt4ZfbksmcqQXi9tvNy39fo+8Y49IfpAp5ywJ1DnkTCMpa32sjnoBdPrA55JWoyJBJtE/In1FYeiGs+JiDPPmvc9S0pQ4tzXHbV0U/99M+FdQckDqDfv/SMLdDvrQCQLHgHu+AuC/7su/5VAB64rwE8cKeL21te+aqeZ0hy2Cv6HqCRnoBqdZVP1Mlvqxakahv5BPkcdAeoFXSXq/Ay4H3Odu8Ux615h7zOKW9jbkonS14BiV2UfQL9yPNNqfVu1p6ndY66jf/szK0V9O6y93x86aS283huHe4S27aJ5D9M5+GkP7xlxVPSox4eKx63l9rIC/CuFuQlMiUSZ4Y8Y7kfp+U+Jwe8IM88W+IO8KWSlSXQ8y4j0y318wGnEwS9g/F8V4bqnPxZpb258e1eWoBXG/iH3vTqra13LQP53K7cLfgsWfIKasWCDsDuw5KfkCDVgnx04vLQJ6J3S9J9K7I+Gwc5D8nrHO65P3vOkY/ROXOeQ54V3duevXPosr/7lngfDlsHcUutd5HX+/6+Pb+/1rqY57r5QZT9bnXmrbbzwJ5rstzVyx+a0l0UU1dH8/ir3YoH8A++/5NvRCRULHrql0lElKCVCKfarOZSO5BzyLfc9ScpB3wGPfe8BPK8B1/Xgjzi/dGiAGsiwwJ4aH5coN8GnBeS/Hn3plQAi+uYJY/lDuC/+MAtUZCYGmhmCvAO+Y+9ph/j4Ra8rHh+8w3KNR1Wa6nHPW7IZ421kccDGFZ18Yhxv8oflIc45HNe4pDPohosGxee/+i9UPghz6ku+4mhZ3kWB7PLn33pMX6s/x6o/F8EMg5d9ut7v8tTbjsvt31c8/brN/XyO1YLHKbzZMrN5rJYR/vJDHklqillwGfQk7gpgXOuFuTPhRzu0u9c+b7oEEeZrMM7Wxsu31fPngPx8GCQ2Xz+dAcRASMDZQCbfegiBbw0eN59KP0nLesdYTl/6SPXBMQFeOZrAC/II4LuoiMcc9e7Bd+y5Kl/FmTVra3c9fsGfIVUqQrwwDsC3ugTg6az3KOeYwry+Tdph3QqCz5b88w5bwvuyncE+dyUrjanwwV+5rb6XgTjRz8+BHQGdX72FsD9mNY+g/fXUGwr9yZLvuWy382a37jtGSbaQb9rtcBhOg8muWzcig9XDdGVNLf4s8feDJjpxEZWg4O9BXmHvSA/ZsmfCzncsyWvjGkt5DPoydA0z+5/QB8d5dx/WwenMdDvCfq6RpYD8mKRP/uYWvv21hncHfKy3gPw77q6Btg52JcAXnCXJQ/kf/tFXZOzliVf4V4i63GF800pkjzXyYcVXyBfwdGAyjYSpKq7vrSRlxXPvZDOyRcy5LO73vOPDHn2aQXfCfJUf/Eecr6jZUGed6SmhT2Xvax5s+SnID8lfy+tba39/J0OthXQD+rla5T99tY8k7vtY1Q8QX7LQXEO03kyyV0zZsVHKbG0qaQUTIIigbp73uWAl3uOxAZYm3XyL33HOYG9wz1DPjej2xbysuSVuYWLtbgts0XvFqIDeVvIC1oxv4jBnpWfW8t1W3qPfpzLIe+AVwc3c/XvU5AX1FuQVwsPFRJbkM9Sb3eyVGXJy1UvaEyBZVttIH/zxornHs7efUTzWwohDnmlFQe7lvN2d9Nn0PPc2nfMwGj2fpdc9oI8gJcc1C35e3DN7TO1fQ7y+4iyZ3K3vQqB1WUfTekOkL8gJ+/8Rooej6K+5w++toP8Yx/Gklcb+aWQz/XxJEBZ8tldfz4G3u0D8pIgn635DHtciaqjBxjAZRb224L/EoG8NAbz1nvQ+8zbHeyCe27/Plf/Pgb4Ftwr5K/s3PUaPyF/Mw52gZ/vSH21hyVfIN9z1TdAEvLxzLdQy1XvbeSn3PUtKQ2RfhzwgrwC8FRo0Dkz4PndctkrAG8O8v6sazR3/NT2JuRLxzi79mXvU9eEuuvyNkfYH+rlL/Bp1oqnEBBDFH75NJlHq/lcS62StErTGks+6g1L+9nzNfAuLKnSPGkbyPsxKvTIsifTQ7wXvCT0NCXr0DWAe0sOdQN8C24Xu1qQd2mfDPkW6OWeB2Sff8dvzrZ/HwP8HOTVfA6AT7nqUe4Ih0J4QL6MWlab0AHe0o7dQRI6BshHMzU8Co88FE1wsyWvNOCAb/1GHENadZd9FgUc7e/5D+vUhJX7wWUPIN1lL6gD+HiuPbyXvUn18gXy1mZ+LxHw6vI2rPk7PxqF2Vwvv2tB4jCd8KTOb8at+M9+tSx9QT4PMetgd8hnuAtqcifKXd+D/Dly1yMHfJYy2myRbwv5DPpszQv0ZEL8B3Lf08xuK9ibMsAOGsrfEfMB3FP0fB5gZgrwDnaHvIvzah5t5Bujz/mylJvPKQq7BXl3NffAvwPUqrveIusJuqNb57Hmc553ZLhLHEMnXC3Iy5onb8lWvBsZrJfLXlH2LcjLgvfnO1fK1nyFvP5fggcf+MTRtsPP+hRu+1I9mzvJqfFZeyhIHKYTnErnN292Kz7+0OL+qYMZ/MmXInGotOyJ0tVKZGRECn7JkMdd/wsvfEftDOdcgN7BLkseCcRktvuAvEAvyCvTjutcdlW8Y7rADffh/bcFXBw6DvE5OdR21XGf/1xJz9ICPP8F1jvwnrLeHeZjcsA77Gk+x7fB9zIG9gz9v/GtL6ujOzrke0F3CR4Z9ruqDkxzz011YBp1hIOHAcjrO0fkCZ5vjEGed0AQLDDPEfaCPHO8jJzXIa88iPUUhHhH3BMFtmrNJ5f9vtz0u2rw/zSi7Ln36rLfU3CcDDs4gGexuuyx5vdQkDhMJzTl+pcxK77sFwWBfUCe41SSDmsjQd7d9ScNegd8Bj3Po+CnLM+IXL6/Q74FegoSsup512RqJGYyTVn2DqE10Heo7aLjOu9JSvfO3N+p4E71CZnsqTf+4qz17iCfkkM9qzafK329Z8g77KOu+7Kr4psJS97q4wPyuX/2BkgcMGtVXfUlsr72dHf27qM/vO+T8S3nAMK1ljzimJYVL/Fb51Teo2XBXy57Rdn3Iu3NZe/PeOxqeFEG92Hd3EZ1yH2njjZt5vdTb+5t5zcD1mw3xO1hOgeT4O2uev7IXPcSf3YJugPOimL1ROmagrxcitTJk9h8qNlzAXjNXUBeffWjtZY8csBnZctGktcgrlma/mDZR4k6wb4FpqXQd9it1T7PdS7UuvcxwP/p9dfuzXp3uLvkrgfyctcL8nx7bsGrIxxBXuPIhyWfXfWnN+3AZ0GyViWgz+vjVSdP3sE3rNgBWfHI840W5JV38Jyk02y9+5wucB30OR/iXU5G2VMY8udDDQDvVaXJWl7nlnzMkzVfYx5qD3j7a8/eWfOPPpvmc4K8xp3fV0HiMB3jpM4PFljxsR/18WojTwKZC7obgzyJWyNCyV1PT1gEnJ3LOvk5yHNPOWhoKeR9Py075GXVZ8veYc97J6PEsv/cp7p22dF96l3vis50HPJjEuBUEMjAk7TflDIgHZbnu/Jzap6lunfe7x9e84bZ4DqH+Jgc6K5tLPkcdMf3I8gLsgHdBPkBXPaoAeRL87k8xOwukOc41cs73LM1L9e8Q573xfqxKHs1NTyu9zRbmFoAeYHe6+b7beb3Y2lrLJNcN79pM3+omz+vp1LnMhiIRnXxm/26wLx9QR7VYR+LJQ/kqyWfIH/SsG/BXXPuK1yiBvkloB+TjhfcM/RdrBfsKWwAezK0GFegwL7CibrjBtzHBPRavx2MF5Naz416wXU3/+6i4DoHeUsOc1eGu9YB+V/7wRfPQl6/FVkf4FL0dbLkZcXPgmZL4a5XhzvqMz/g+fCnIrKeeAF9z8oPPM+YgzzvgW8/w91BvyQAz6PsK+hpf37PfjsKypp897LkE+h7kC/r9Tv3Zc+905xuX23mNVUjr1jzh7r5C2RS9GTbiucD2ZTQusLA468mMSh4hgSyBPIOeiU6r5NX4YH26OfKkpcc9II8krveQe/wXqNcWMjQF+zdus+wJ1PnXeKe5P194c7TYTUJ+sBqrYXv4Mu/3b19oVnvkj83ynAnk9+n9b4E8gPYl45wfuk5L6r12IK5gz5b8owjH2k1u+rlrr/r+OqaFVUP4LMlr6A74KvIeu5ZsCUNeJ4xB3qO93r5DHsgTx4iqz0DPheop6Ls5RIffVfH5bqfcNk7/HMAniz5fbaZ16S6eQB/GGf+ApkEbrfi1S6+v29Xb09pVx3h7AJ5MiOPrm9B/lyB3gGfIc+9Z3djBrPDe6k4VplXC/YuwV8Zf7bu8ZAQXcy7xJ1fOyIpwN/GykcCo+bZxZ/n57v8uaQM+D+98d29jm1agHeAL5HD3OVBd9wDkL/qJ1/StORdGfJE1ldXeRqYBggfl4XKeWvTuTO31sh61cfzXbYg7/mFy9MKc47nfGNR9mMBeAI974r12WXPf189D9H73aaP/1HQ71sNwEu6h958ZJz5GJlujwAOXjzx+BU+5vy+qwYO0x6nVuc3YcU3PgwF3eFWF+RJZEsg74mLOcfiJlNHOFOQPxewd8Bn0HP/suQF3F0hL+VztGDv4JeVrzr7Cv8SfKX29mR4dCeKlR/t7pNrX4Bz6C0V4PS6fK1zwJ5L+X1LPbif/lBY78B9X9b7UsBnyAP2DPmX464v31uGvMNekMctXiGf6uTDtZu6tM3A2IuAfKM+HmgqWFcd+ugbXgJ5pHQhaHMOr5d30LONvu5b1jzHR1oe68tew882RqUbU4bv3L6TarjsB+C//fraxI975H3npnThst+jOz23wsrjzcOMTYdpB9CfN5Pq2N1VH3+WfRQ56I5EQGIAHCQST4gtZchLHKvmK9GW9wKBPKPR/dSPl2j3EcjvA/ZZDvsMenkTJL+fAH6JzFdmJitf9fgt6E9BsaUcwKZjHfy5AKB9HMT7Vr6vloC7xnz/0w9cM2u9jwG+B+rGdt+nJQ+207mmIO/iP6bOu9d8Tpb8CQTdtXq6C529OyBPoTNDXvmB5xktKT0I8nzfLLvl3rLmuZaO1XUz6POIfe6y1/CzS8C9FeSn3PLaludpue5rUfb9QWv21WZeneM89mEgL1W3PVW8eypQHKY9TK1mc13bx6HbJQfdkQjWtJFHDnikdt+qj1c7eSyQ8xnyWPJYBlOQPw7ld6ffyuR0Dw59WUr5/jLw+Q+ox8crw3sH+gK+Q39Nnb4kuGbITgEXAWZfl7fNya8xdj5Z7z6ozJj17sBeAm5tn9uvd0wB/FJL3sV6gBWxLnn0uWLJTzWf21W9Xu4K5GtV0Rc/Xbuzdch7ftGSpwWlNZ6Z71dQH7PmsfizNa+0oXug8KFgRdry9yHfeT8muwIe0dr9qxzqRX9qv3O/+tynAi33PWiNJnl/HfLMDz3hnUdTdrsAdzJ35mPtHlV3zweTIb80gTrgSWgkqhbkuZfzHfLciyLsHaIO530qv7/8O2dYgr2An+fazrEOff4P/lO8K7RwwNK/6wO/HcFnAr/q9QVKwC83v1vxxyEHusN9qbL1/kfvf1NAfAzuLcA7mPchr4v3OnlBfgzu/IcZ8nWIWYusX+N6XiPONWbFR718KcBzb/kbXZqHeFrIkKfQ7ZDXcl7nkGee04j6FugF4Mlln3oJzNa6v4eQu9XXyK33GfUgn6LsjysArwX5Aej35Dk4TDtMavOIFQ9U0ZgVn/Z/syLrgbwSjCfGMTnoVW+YIU8BgkCx8x3ybI+M9YQh35K/V2Vgyki9EJDFNoc+z6W6fEnN9KjT51shE5GFNmbxrwXvcUkwV9Bh3Ov9t0Wf83Ou+eOEekvurnfIqytlwdxBL9hTWKM5anXVT0B+Kexb+/g5WpDXd6IBrUgzfGdrLXnk372+29yULrvofY7XSteU5PXiXL0288Xtjbo2853LPrdMGIX9jpCv525A3YVlL8hzb94D3saa308PeJzDIS/Ahw718+d+Uv06UBfgS5O5phXPpHoYjRQHnMlMSBieEMfkICIjqnVgD3/qiQgSOts1YwmgNyB/kqB3uGfIMxfkM+DPBeSRv1sX96XlMfC37h2oSLL4eW6Ol/Uk8EezvQKUaC6lscsbo+jlCP+WfP8xtc6tdXmbu+b/+C1Xr3LNO4yPU3OWvCDv0n9DoUz9scuiE+Tldl5skc5oAPgUVZ8teUE+erorz7APyGdr3i14X3ZrPheCdS85AK9XL58C8BZBfq0EbJ23AfMxsW8GvUOeNvPkqfsaOS5X87o1n0G/zyqCw7Ryyn9S34pvu1jk2ld9PJkH3aqSIDwRjsmhQ4IC8tR9KehOkOf86hCnJYfxccnhniE/1Yd9C5bnQv7Ol8qfJYPeRf0qwgIi2Cu7/fkPo7VGSfjZqlOdfy0E2O8prS0IZNf8Fz/81oC2w511LbifNOBRy5LnPhhL3iEPnAR3KXeE45Z8hrxb8wPwmFpAGwC+AXnVx1Ogb7nqkecXY8rfNvMM+ZbLPkt181jzvDcVfPU+Zc3z/XoAHs8ANCOwrQH51WqAOgN7W8jHkLipBzxZ8oB+X83pWpCnWo8OozLoN33b73a9w7Ryyla8ID9rxZe2kWQaGfIkDE+EU3KYkJi4viAvKz4CdN75wfPeZa8Ie2VaGfDnC+jHpExScynft5Yd7A554I7+8jc+8+irnvz0o6/6K3/z6Kue9JROLP+Vv3n0P379txw947IfCGv0nVe++uhDV//Lo8/+5ptiFDek5S/+3r89+tJHrok57dRx+SsaX9Y58qqCViEgr6O/eQLr6NQGmLv17mA/F3CX3JJ/+LU/E8B/8Xf+TLzzKUte9fEALQrNA8h3kHLAL4VV3jcfWwE/4qonz8C7IMhnK34byOdvVHKXfQvyWi9rXpDXO+V3LiS1rPlHT988eH/+niY1Aum1cG+do2XN9+vmd7fm3UjEVX/TO9/Sd9nf/JGjB2543xFu+33FAhymhVOui++XuNpWPJP+VLnVmTMeNAl1SRt5lOGu30Ce+vcMeUQTPVy/QN4Bf64hn7u3VYS9Q/58B/xS8Rz8v4jfgvlT//ZzNkAXzBPQB9K2vO+TnnL0nf/d/3x02ZO+4ej9f/f7A7Ryn2cJwloG0gIho8BRIKAAED2TpYIAc34//N5fiX0Fd5eD/VwDHo1BXpa86uIz7NVaguVsicpdXuvkT988Cvk5WPm+rhbk1T6eNA5cKRTyLen+1wAe+feZ0xvPT5pt1cln0DPP1jxz7kPWPO9YAXhqM6/CkprT8Zz+/Hp/c+9RoHe47wL53vm4vg1BK9B3zel2s65bkP/MR2/4DKIZHXA3t/2oAXmY9jxNWPGTdSfqBAcAy5Jf00ZeyqAnQVFa5nwqPGTI414iwTrgBfmTgj1A19xhz3oylpzZnGvItzLDtVLGm+FeLXQH95jmthf9T1/9Pxxd8U3PDIgp+G2JWgUBB3drve/TkkP3pOXueu6JEeiAvAqUbsVX2BdARUBrbiO/B8hLfoxUrflcH8+1z95d6+PV09029fFZ+VvlPCzz/MDbrfYxyZrX/ajwxO9eUHCCfOie/hC0Ln9fvXfXgPpawE/tJ8gjt+algO6XP//1Y0bd3KTAO1X1qrr3gffc+SKC+2I5gf7QrO4Ep2zFB+D1B6RBaHxSwYD6HD52gAyENeiDJ74pZUuejIg62xxZL8ir5C+XvUP+JAE/Jln0akZ3riCfM738rn2/vP/YMv+NLHeeAYvdoby1srVv8z//F77m6G0//NKBC72lHAnv0NfxLfAvhfu5hLxb8IK8LHmqPChwCY4OeNXPK3As3OTK3COyvnM1Hwfk3V2v5pZxD6kTHFnN27jqW993Nhz4ZnkPGfIt0Oe6eYFe748590ZhhJYACsDrQT4KS0N3vf9uKQP90duvC62F/JTiHPIm0PMg/3my5gPytQva7aCrJnQZ8hiBUQ1Q+rbvWfMLvMWHaQ/TuBW/GUq2Nak+niYYUa9z9s4IpiLBOljmpMTIcRxPVHYEBxW4Z8gzxw10LiEvTVnzPE8L8icFen/HWVP75fWaK8bgrz31GUNI70vmste6y5/8HQEyh/K2AtY+n5ND96TlkJcUXQ/keV9UlQB7paWw4Et9fIZ8teSLuz43AVOnLmNyOI1pCvIBF9LyIw/VoDtZzPuCPMr5Cu8COE+BPv+W5S5rPheYyKPyOPO8y4DlvXcMWifk99F6R1oW2LMc8BE81wD4KpXrxjgFqZUDz1A6xwlr3vP7uQmO5AHN4Ig6Uevq+rtx592ar277HTwIh2lm6l5+suJTW0bfN0+qfwHuRMLzwXM8CcAT3pxyYlQXkrk+nkKEIC9rHmt/DPQnCXsHvCCPNQAYFYgmuB8n5P29rlU+hzJZrPdquS90te+kDPnitqfe3OG8jRzeS+XQPWk53LMl/7nXp8JXqTr5i1//jDpkK9+bmjgC+WgjP9IRTkDeIsRdDiqHVV7Xg3walAYrnnwDyGswK+4zA35XyOfz8JvzewCeQz7L6+YFeuYKYOT+1QOe3qe76/29DN5PA+5ZGdA1Sn4F8AdegHLtaDdfurrNFv22A8q0ml+HJc/5SoBdK+6r1+3tRNXwYdpyGrfiCcCY/pPVPl4fOZAnsn5XyNPEiqC7qONvWPKy5tXFrcP9pCA/ZsUL8twDmVeG/HFa8v5O14jjFSip+nasd+4VYJwI3LPMmv+1Z70ggDYG6rH1u8phe640BnksebbLkg/IS+X3N3/7c6vrGTAxBkSFfHExy5JvNZ9zjcFqbH0r6E6Qx6tAelfzv31CXnJrnjQ7B3i35h3yvTbzpQc8WfPelK6CuQF6B3pLAzgb3AcQt23N7bLmy8A1SJDftqvbYMmffeX5ANvr5OWOl7WfO8zRQDYHt/0xTYO6+IURj90f+uiz+SCAPCN0MX/dz70+EsLSyHqUEzQJiEQvwOf6+Ax51SlyPYf7SYN+Cva8Cwf8cYHe3+uUWvvn/yzc85ddtQGuQ/gkVSD/hTddOYDwccthe660FeTR1z1toyc/fQN5AZ6MnWCx5K6fg/wU0PO2CjlZ8YDe+qvP7ePJA1Qv3/o+l8rTBdI5KUQsCcDTennjWqCXxzFAn+q11TGOv7Pee0v17ku0BOgt5f392Ch84LmJsQRu62BfCirR1e1K4Kp7c4d8tuQ3+3WDnznoD277PU9uxSMF28295Dx2MK50LG9cVySOtZa8Q54SssM9XHsJ8hQq+D01Kt1xg96BLgs+L/NcJ1Uv7+91Tn6clhmsI6LmWwFx50j/+Lu/rwNbCoJzEI9BuXXMnPwc51pjkFfgnbvrK+Az8J/0lHML+RR0p/7qc/v4XeviXfqemXNOpTuuMwf5LPIkFdQd8lQ18D5zAJ6s+fr8tE9vBNVtIx3vMF+iFuTj/kp3t7nVwzbWvDefG4N82vd1PvZ857afjgU7TCumXv1I0dIXrD8U2AJ4PnJgT/M5EtQ2ljwiAamuy131GfKRSfD73jvOmcveAe/yTnFcDuld5e9Vcje89s3HsKzo+ah/3wXq3qRuD3rmN3x71D1n0DkIp+QQXyI/x7lUhrs0aslrDuS1XH7HELPe212JrF9aJ9+CvKDuv91VnyPr1V+92sdnyE99z0vl6UNpDkDP9YCXt7Wsebns1WZeLvtQeacqLMldvw/Iuxzkc3LLPoM+voMScY/WDlyj6tsM+IC8ouv7kC/D0j5+LdzJoD+47fc0yd2erfjWWPGtafMHPfZhIC8RDLdN8zmkY0g0GgTCAY+4zlpr3uG8LznUXaqXV/tfl2dCu8rfadbYdq1X/Xt0ZAPgAYQFwDXB7/tk7RH2BN/RHry2D98S9gHMBtDPV7hLU5DnngeQ17K57hXQOgf5OWveAd9SL6qe5nmpPp50O1Uf79/pLlL6yNY8y3OQz+LeMuSzNV8HrSmGjnq/kzUfkG8Aeh9yiLvces919NW7II9DFMY2kF9jVWeeDCH/+LUtrmS3/dCa3y7C/zClSW0We276he0juz/0K8/HDSPoUkKnj+K1VjziGBUOfGCaDPhIQAC+dOJQrYIHz0Qvew738wHyzBV8d5yQ93eK9D+wXVa8tmlZ68N6l/UnwGfQFlAQhBeBeIKJIO9qgHprFVfze//Jz/Ygr2UH4pwEcof6+Qp4lAs1DnmW//q3fPfmXfm8iP+4F1l/zJAPcCRXfas+nkI9aUGQR/4du9bmL4hvXB4CBKRlzS+RR9pzPPdK2sZ7SYFF+ZNc9rzXCtAGoPelDPG5oLxcbVA9C8XTEP99KoytseZVH++u+inIM4lD7rYPHj3x+BW+/2FaOAnS2YpfU/+iP5R6G1nUJFz+UGDtCWxOgjzL6rPeI+vVZI5tXMutedpjjlnzDud9yaHe0knVy/s7Rb7d9yWzxBIJaJc21j3Alzpdtn/1//qsUf2lb/jeNvQd1A7vpXry06NTnF96zouqyz6DzoF4MaoFeSTIU50R70ouent/zBkfoNdGvlcnv2lC54DP0F4K+Ar5hqs+QFjid3Ivd/t01WfldKDzq2ABwJfUzZPex6x5dRXc688+9T1w3JBHLaC31LTkk0Xfc9vfc1upm58ehjY8u6UTHLWPl4ItU5CvHao99uEM+QjCO3rsw77/YVo4Na34BaU1TV1Xto9f66B9+7/+9UgIa0raStiy5IGO2txn0JM5kUmRGKP9vMZzLq4x1nH98w30uV7+OKx5f5/K1Hxd9rAwJ3P9mqc9LwAApAF8tdAL2FnvMHfAo//+qc8JcY4APmBpwV5WpUNoTsWSp+e7DHnBz4F4scoBr0JOD/L5/ZpV/2MvvqJanBXwZsmrGV0L8gK3w3xMXh8vK17t47GAc1233PX+7e5LuRCBuDZBpgK9g91FOs7WvJZzAB55V7bkea8BzxUuewDs65bIgT6mKch3BbObK+TJW1t16nkq/axcDkdyJzgV8jOu9y6+q4vKd7e973uYFky95gvVTb+s3kVT1Md/5eztPciXIWDXJFIlugx5msSpPj5DnkFpKDGTMcQYyIJ8cd9jJQB6ue0d9A7nfciB3lqHuP6+IZ/fo2/L+2gO2Lk+UfPA3YHNb8khvlSCPZJ3oGnRbwN6c9drfqlB3r0YWPIUfH7oqSVY0t+t3vfXPS3qjgf18Rp9rgH5aDNvcG+Bf0y5Axy5gGNkwC9++gl1ZUu6yIA/DkteUrrI6Q5rXJCfAz0gd8gjXPZUMyoArx9lXyz5BPlwkae5KwO5t+22osYxrWNbqm32k6te0O8F4RXQk7durPk2I2TFy1UP4FdCvradd2ve9z1MCyZZ4WuD7TTJ1a+ubMP1dvbuKMHyoY8lULfuVRhQwmaZRJ8j62udfOn6ku1cI1z2gL7Uzecqg3MxQt0c5FlPJrYL5HMmNbZey75ObnnBPAO5BfXWupYy1FvrB6PRObjX6ElPOfrYa97Qg7yWHYYXoxzwuZDDckBeUPd39+SnR2AeEIrxJRqWfAZ8hXwD7ksBH32jy4r3/uofeegJChytoWX1zR6HPO0gro2FLtA72F2y5rNkzddBa9R7XLzbTTfBGcZuRS8FNZD/01unYZ/31/kz1AV0P3eFvprVUfhL1nzL25uNxgz3nrt+BvJM2RsgwH/p1McOkF87qW1734pf131h+TNeB+QDtAXy/LnqVcsTF3LIo2zJ8zt3Fal6eOa4wVjPdu0TLntZ8kV/fM8N9V4YlStb84DW58clBzxzDQW6LeT1XnMw3ZiUWWa3PJY14GXZYb1GAnoGe4Z9hr6W9wF6NaFzdzVyIF6MakE+q+muT79pR4/17PXxUW9c6o4d8g51/92StrurXgUKQR6PXGvUOX3n+sY9z9hFnk6U/tQL3lLQuzXPMgZIHrSmgr50ApSteQe8y+HrmgJ8S/U4Bdgla97l1rxAX7udTbDOdfGMNUK+q7lZ8rPxXnGuRtt53+8wTUw1wOErZ2/nxddmCjMv36dcH58tef5cPvgWzFknaV0GvCAvK12R9XLXA3QSUIzqVlxjRAkrIdVEVUDPcdwPYG1Z8scJeYE9LzPHu7Dr0LM5o9KyZ156zxQocM1ny93hvFZ+Dgd7S+xHwaI2zVsL+1JAYJCaFuQvNUvevRiouusnIE88C4XlgOwCK37Kkp+CfQDCBqTJQXekZ7nq8WwJlC3I71s5nXAtpT3muU97h7rLI+0VkKdBa6LNvN6v9WUv9/iUHLwuh/gc9DmnA34p6CMYU9a8jVAn65ux4vFikOdmyKPgzMKhZFtBeL7PYZqYcm9E1U0/EUzRmnJBIUadKyPPAWHaqo81f3HAI4c8At456E7u+tqetkCexBSj1OHSx2WfrHkyE1n0Aj0Wvax6oOvzfSlD3ddxrW0h38qoPNPSO8Y6Au4ZzBm426p1vAN9TNo3QA941oC+QP6al/xEE/IOw4tVDvgM+iWWPP3Xt0ef6zLyFuTn5IDPhYIODpumc7k+Xr3cqT7+pCAvKc1k0OcmdUtAL7Azzy57jqUwFXFKAj3123LZNyDvkJ2SjjluyIdKc8qeNU+kfMeNr4UFcATAS27Rd97i+XFQNGW3/cFdv2JqB9vx4udLV3nSH1Dr4x/+VECe5Zf9SJdYHObZivdt2YoX5NWOV676XpDOZVdFYiQxEaDHPrVzHIu2B/TcX7boPRhv35BHWOzED+CR4B5ZF6B/6TsiM3CXvQM9K2dIeV1en+GeXfEO2X0pQ3uNdIwi+teAno5wAF2GvODmMLxYNQZ56YpvKgUoQd7mz33B5R3kc9BdA/IO8pYc7D3AUxdfO8AZDkrjrnq1Nz8XkHcpCG9KKgAQlS+4cxzzHIBXO8UpwY1TLnuH7JRaBYQpyNdCwULA5/3jfs2a11C08OTB93/yjde984Nh4GXIZ9B3rFnXe528xYfo+hVTHfUnu+lnAiFak+pMon08gC/DvxLsNlYfPwd4ieNJ/JSCAbsgr6C7KPkXS17WPNcV2Mm4sBRQBj1xAxzPuVugB8L7gD3nAOp88DnwhGh/dYpDYUMZgjK2OdCPSe+WdzEH97y8qzKwt5ViBBaB/klPCYC5FX+pQt5BL3c9no54ly1LvvRZr6CwHFkPhFtWvFvmc9J+AN6D7hzyFDj4boGkIK98oJWHHIdyWtJ1uR+MlQzzKckTwP0rXXsAHs8cHgyLsm/Bek6+f4V8A+5zkPdz+zW0X9xzaXmBZY0C9F85e3uG+xTk54Ys90lGKdfwbYepMXUvrOuJaJs28XlSCQvrXZBnGdhm+GQthTwJTM3nOHeGvCJxBXj2rYmp9F8fsQEF7g56FUSwsnHJCcq7wl7HAnFKtAo2UX0UHgjWc93fufJ9tV4+A34J5HOmpHeqOvcMX+RQdi3Zx5UBnX/7tiXKxywBPZ3g0J1tC/KSA/Fi1BTkmdO8cAB5lgvkaf41gHyjPt7hvUqp6Z1b8aFSH893m5vOad7KP45Tns7QkiA8rScvcWt+EICngWtoqqi6+QLmbUDfUj5HC/IO+Ax5v4feeZLbnv8Ut71aNDFeCcOKk7854LPWtt7SJIPS1x8mm7rmbv3+6afaO05NuT4+dzerOjaCaBzkaAzyKJfegZ+sDbfkSTQkHhKSXPZKTFF3r6Z0pd4vIM+6M93wiQF6StUPnom2/OowZyz63uXrdQz3y4csqz1Hleo3hQuuyXFY87r/DHm9gynpXXKc4E5QncC5VHn/sWMdyq11Du8lysdpebQ9fQH8mBV/KQFemoI8GrxDQf7JT69dRQdsC+RJH3LXV8jvAPqBu94gT5oGBt50zl31JwX7nL5yGmTZge7SehkoKqwob1JzxRovlALwwkJOYN8F8FkCeoZ9hjz7LAF8HFOqAOLeFFBZBt3BmsfAI+9zaz4DnoC8JZH1rUm88fWHyaZmm/iVwXaacn08kAeYgrx6rnKQZ8DnbSQMzZW4SBga6EGQZ04dvYLuMuRRjbLPTVZK5qW5FKCn160Hzzwh6zrg3ainb0Ff6/E20LOe4C6wy0Wlddllj/XC9bD4oyldseazBTMFet4dzwvcAePSduwuB+zUdu/9Tl3bOrjXqnXNQS95BVLUxcsd3QKbQ/Bil1vzeZntdZAaE33WA50oNMuqLu76XSz5plu/QJ7CQ4Y8aZM0Ta97VNfIg3XSQXeuDHbdA/dEnTv50RzkseZz1YNc9hyb+7OPvIle5DTCXwKqw3oXOaznIB+FAdreF7DTBj8vB+hVhcN/e89tAXmehyDpMXd9hfzCyPrWtE3h4JKamm76LYLtNHl9vKx55sBWiVYAR2OQl5SwEOcAhoqqVxM6PqQcdCdll330h52s+WzFo2zRB+zvO1UD42gOk2Gfo/AFdxIy+5KwuZ7grY/ZLfgsue0p8aqgwH3LgskWfZYyH55TTeEc7q11SyXokuGqTp9zAXOgQGZMRoUFiFjWfswd3muk6+f78cj73Fc9EGuBfldL/nwekKYlh7yDPiLsszVfXPf8n9Hdao6sLz3dTUFemXvN5Bugz4AXCDoYpJ7u0Nm7o6ARBZEnPz3+f9JBhmyGfM5HjlNeoJbIY6jiENAd9nkdze+UJyHyKvKVgDxVmwus+eOQzt26Ri0AFMhL6mhHoEfsHwUF6+6WAgz5G3kb+WAGPfPOkl8XdJenbY+7JCa5OtQLUe11aMuSUXRUUIaWFdhlxQMyINyy1KcgnwHvkJew6uXeU0k5Q57rsj277LO7vloqpcOPzj15S2RIZHR8pBwPeCm5S0BdywqmyxB3uLcseIc+GRxBeBQc5JEQ0AX6bE3Icg8rt/QvLxBnaV2ez0mAFdQ5P52lEBDFs5I5EQDJ/OU///pYz/+jDnUyqOeUr5cF1H0d4l4A/GVP+oajz/7mmwLuLdDvCvnzfWjZltyK15xtvJt//N3f14Q8BTb+T8Wt7Bvy2jcs+EhvfSueOVY8BUW61+V/lneIAmP2Ap4U3LMy3JX+mI+1ndfvMWteeROF4zBYEuRlzR8X5DPYW8rbat19gny15osq+EvdPP/vmDWfrXik+vgDrI9hCjd9aRMPbHYJtmPq6va/8vyjoy+flpWd28fzQSth5MQzBXmUIa9EkS15IE9wB5DPgFeCYg44c3MVt+KlqHuMzKcDff1d6igFb56HzEhgp0MGQdvBPicdp+Vw27/qtb3MQFImkzuxUUboYB+DfF524Au6Ome22HnHxA4AAsRzsh7ws58Gr8nnmZPDO0uAZ67lfL9cV4B3uO8D8hfC+PEtZUvexTthAJ8B5J/0lGhZEkF3CgKr9fENyBfQO+BbsO9Z8N7LnVnyfFd8U0Be33b+xknjOZ/IVv1xy614gZ50iUUut73DPoNe1nz2MirYsWfN896TNe+Q3occ7GMag7yDvu6f+rTPoCdvc8jv6qo/TBNT7kxg12A7Te6qV9AdkMfS5aNuQXwM8ioMCPBYsjWIrgBe4vyqw3ZLnvUUDoj0DJe9QT7DvnbfWdTB/qauh7xSOq1WDhlhCTIh8/ovN38klKE9pWzBZ8seyANT1csDdMTz0G5YY7o73MdALzi21mUgs8w5ODfXwDqnQIWlnq12MjOsdo0mJ1f+mHt+CvoOdoe6lOGuZfa56idfcvTHb7n6WCAfwLzAAC+14K45Cnd4Bv3XPS0KrJG2Un18hTyerQx467e+JbfgYx3R16XA0AN8aUbGd69Co3/T+jb5zuQVPEnLXgUKhz0ibZI3tSz6vA4PXY0bKula3kn1JVJd9nffcmyQd5C7enXwSyEv0KvdfM0/b4nnURBeBv2uhuVhGpnkVleb+Bxs5/uumWpXtqkuXpY8JVjVIeeE44D3QoC7pklIaj5HMB2ZUu7pLsM9w57rR1eSpZQs0AvyncXeWe4bKz7B3kbfqhmY6hZTH85IbUWx8DP8M8wd+JqTCLhXtfunRUIe8lWAz9D232MSKHMde2SeX/e0yFxVxy6wq8dClrkvuj0FrgA6g30K5GNyuGc55LUuPwfnAFY0C5uz5h2Cl5L8ffRc9oqs/7qndWOdl6amQDe3PmlB3gG+RL2ubBPgY156nxyz4vW/ax0FUdK25xkuz3N2kcNdeRPCwADigrq767M1X72Mz/rlSOMUsORFyS77XJhyUO8ih3pLFeYzkH/0lo9sgK/z36kqmQ70suYpxAnyu0TVH6aZSRZ3P9hu09fwNpOa4anpXLbkAZdc9Z7gHPCeYAV5lkkYtR1vCrpTT3dyaTvo5RaLhFS6uJWVoowsQ94BH1ZHgXy4odJytUpKG1GVYkPhrtoco8ID+/HRC/5ZbtHTzWgOeMsZnYO7tU7rBU3BVVYRGSpWOS0BuF6Ge/QS+PCnIk4Aq55jOHbMYl8rh3hWy5rXs2iuc1A40chzLV3qkNfz+3upAXjFc0OhOTxdqU4+0koq9A4gv8BtnwEfBeLcbK5AnnRI2sQjxzfJf5shr282f9uCP9VWALaVfxyHHPQOfbfeW7+VX4U1f9lVtc38wGV/TNa8A72C3drPbwN59uUarXbzCsKrAXcHK37/U7tN/O6lKUXpZ1c9HywQpi53rMTtgPd9siVPYgDUERyU6uOxPJVoHPBaxhImA/Hgu42l0od8ZGwG8qzOci8WvFSsFGVqsnS0b3e+kskl8OdRnCJBkBjobvfeO6LEC4QBWXWxft3TapCdMkFlgGSOeZ1EpigPAAUHgZ0CBZ4WJKtdUntlrHeOc0jvKge4A95Br8KKF2a4NyxTue1dlzrkJX8vdB4E6Alg5D+OPicUs5IgP+qyz0F1C7q6bUE+4F7SoprO8Z3q/25J37O+Ia0H9uQTnoe43NBYqxbYlUfJIMkR9xn0Ej3mZWu+F2uUo+wL5CM/acB6FzngR0HvGnPVJ8U1ynchi57vSG3nyVfo7nZX7hymxjQ2AI3vt3aSqz5H1SuyXkFkrcTlgG8lUCUgtZHPkGeZTmS8Pt4hr7ovojzV011kMD13vbRx0Y9BPoAtt6NckAuUrR6VdAX+nCCYx7b7TkWbfdxcAJ/nJ0AKSANrMmeWEdYYEGSe17PMvmSgJC7OJ7BjuWGx594JWY9Vh/UuyO7Les9yuI9BXveQ54K9MnsKPr/9on/edNcjB96lqF79/CteWd8L/Qxo9LmAeuoVUiJzbnmh4jtd4Lav33ZjQBpBnm+cb9eh7oU6Kf//zAV/h332Bu5LLdDnZVzyAv2YyM+yEcK67LIn7UfeVALwHNK7yME+CfmG2z72TVH1A3Ed6xdBoCePwch84D13vmgX73Ge/n99PMg4HjUS8gAAAABJRU5ErkJggg==";

// src/generated/mousey.ts
var MOUSEY_SITTING_DATA_URL = "data:image/png;base64,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";

// src/ui/drawer.ts
var ICON_STORAGE_KEY = "lumiagent.customIcon.v1";
var MOUSEY_STORAGE_KEY = "lumiagent.customMousey.v1";
var DISPLAY_NAME_STORAGE_KEY = "lumiagent.displayName.v1";
var DEFAULT_DISPLAY_NAME = "LumiAgent";
var DEFAULT_DISPLAY_SHORT = "Agent";
function resolveDrawerIconUrl() {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(ICON_STORAGE_KEY) : null;
    if (v && v.startsWith("data:image/"))
      return v;
  } catch {}
  return DEFAULT_ICON_DATA_URL;
}
function resolveMouseyImageUrl() {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(MOUSEY_STORAGE_KEY) : null;
    if (v && v.startsWith("data:image/"))
      return v;
  } catch {}
  return MOUSEY_SITTING_DATA_URL;
}
function resolveDisplayName() {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(DISPLAY_NAME_STORAGE_KEY) : null;
    if (v && v.trim().length > 0) {
      const trimmed = v.trim();
      return { full: trimmed, short: trimmed.length > 8 ? trimmed.slice(0, 8) : trimmed };
    }
  } catch {}
  return { full: DEFAULT_DISPLAY_NAME, short: DEFAULT_DISPLAY_SHORT };
}
function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function el8(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls)
    e.className = cls;
  if (text !== undefined)
    e.textContent = text;
  return e;
}
function mountDrawer(ctx) {
  const removeStyle = ctx.dom.addStyle(STYLES);
  const dlog = (...args) => {
    console.log("[lumiagent]", ...args);
  };
  const displayName = resolveDisplayName();
  const tab = ctx.ui.registerDrawerTab({
    id: "lumiagent",
    title: displayName.full,
    shortName: displayName.short,
    description: "Agentic editor for character cards",
    keywords: ["agent", "edit", "translate", "lorebook", "regex"],
    iconUrl: resolveDrawerIconUrl()
  });
  const root = tab.root;
  root.classList.add("la-drawer");
  const state = {
    characters: [],
    connections: [],
    sessions: [],
    sessionId: null,
    characterId: null,
    characterName: null,
    connectionId: null,
    messages: [],
    edits: [],
    characterLedger: [],
    chatsForCharacter: [],
    pinnedChatId: null,
    settings: null,
    pendingPinChatId: null,
    autoPinNeeded: false,
    isGenerating: false,
    startingSession: false,
    compacting: false,
    contextPromptTokens: 0,
    contextTokens: 128000,
    pendingMessage: null,
    pendingMessageId: null,
    startSessionTimeout: null,
    streamingAssistant: null,
    currentAssistantMessage: null,
    diffModal: null,
    workspacePanel: null,
    charactersPanel: null,
    workshopFocusCharacterId: null,
    workshopFocusCharacterName: null,
    loading: false
  };
  const header = el8("header", "la-header");
  const rowChar = el8("div", "la-header-row la-header-row-char");
  const charLabel = el8("label", "la-header-label", "Character");
  const charComboRoot = el8("div", "la-combo-host la-combo-host-full");
  charComboRoot.setAttribute("aria-label", "Character");
  const charCombo = mountCombo(charComboRoot);
  charCombo.setPlaceholder("Pick character");
  const chatPinBtn = el8("button", "la-btn la-icon-btn la-chat-pin-btn");
  chatPinBtn.setAttribute("aria-label", "Pin a chat to share with the agent");
  chatPinBtn.title = "Pin a chat (gives the agent message-history access)";
  chatPinBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  rowChar.append(charLabel, charComboRoot, chatPinBtn);
  const rowMeta = el8("div", "la-header-row la-header-row-meta");
  const connSelect = document.createElement("select");
  connSelect.className = "la-select la-conn-select";
  connSelect.setAttribute("aria-label", "Connection");
  connSelect.title = "Connection";
  const metaSpacer = el8("span", "la-flex-spacer");
  const editsBadge = el8("button", "la-btn la-changes-btn", "Workshop");
  editsBadge.setAttribute("aria-label", "Open diff viewer");
  const editsCount = el8("span", "la-changes-count", "0");
  editsBadge.appendChild(editsCount);
  const newSessionBtn = el8("button", "la-btn", "+ New");
  newSessionBtn.setAttribute("aria-label", "Start a new chat session");
  const menuBtn = el8("button", "la-btn la-icon-btn");
  menuBtn.setAttribute("aria-label", "More");
  menuBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
  rowMeta.append(connSelect, metaSpacer, editsBadge, newSessionBtn, menuBtn);
  header.append(rowChar, rowMeta);
  const thread = el8("div", "la-thread");
  const emptyState = el8("div", "la-empty");
  emptyState.append(Object.assign(el8("h3"), { textContent: "What can I do?" }), Object.assign(el8("p"), { textContent: "Pick a character and ask me to translate, refactor, audit, add lorebook entries, or anything else. Every edit shows as a diff you can review and revert. Here are some examples:" }));
  const SUGGESTIONS = [
    {
      label: "Translate the greeting messages of this card",
      send: "Translate every greeting message of this card to English. That means the canonical first_mes AND every alternate_greetings[i]. For each one: read the source, construct the full English version, then call edit_alternate_greeting (or edit_character_field for first_mes) with the whole block as `find` and the whole English version as `replace`. Keep all <img> tags, markdown headings, status-panel emoji markers, and named regex capture groups byte-identical — only translate the natural-language prose between them. SKIP any segment that is already in English or already has an English counterpart nearby (a parenthetical English gloss, a bilingual line, a label/value pair where one side is English). Only translate text that has no English equivalent anywhere in the surrounding context. If this card has a LumiRealm payload, mirror the canonical edits into the payload so the change survives translator schema migrations."
    },
    {
      label: "Translate the UI in this card",
      send: `Translate the user-visible labels inside this card's UI surfaces to English. UI lives in THREE places on Risu/LumiRealm cards: regex scripts (replace_string content), Lua scripts (\`lumirealm.payload.lua_scripts\`, often the bigger source — button labels, dialog choices, status-panel text), AND background HTML (\`lumirealm.payload.background_html\`, sometimes also \`background_html_source\` — status panels, sidebars, commission windows, any chrome the card paints into the chat surface). Cover all three.

CRITICAL SAFETY RULES — read these before touching anything:

1. NEVER modify regex find_regex patterns. Those are matched against LLM output; changing the pattern breaks the rule.
2. In regex scripts: only edit replace_string content, and only the user-visible HTML/text inside it. Do NOT touch capture group refs ($1, $&, $<name>), HTML attribute names, CSS class names, JSON keys, or regex syntax characters.
3. If a label is inside a structural tag (e.g. <div class="...">Label</div>), translate ONLY the inner text — leave the tag and its attributes alone.
4. In Lua scripts: edit ONLY content inside quoted string literals (\`"..."\`, \`'...'\`, \`[[...]]\`). NEVER touch code logic — opcodes, function/variable names, table keys, operators, control flow, comments. Use \`update_character_extension\` to write back the whole \`lumirealm.payload.lua_scripts\` array.
5. In background HTML: edit ONLY user-visible inner text. NEVER touch tag names, attribute names (id/class/data-*/style/etc.), attribute values that drive behaviour or styling, CSS selectors, CSS property names, JS code inside <script> blocks, macro tokens like {{user}} / {{char}} / {{getvar::x}}, or LumiRealm marker comments. If the card has both \`background_html\` and \`background_html_source\`, edit \`background_html_source\` (the viewer rebuilds \`background_html\` from it on next render). Use \`edit_character_extension\` for find/replace, or \`update_character_extension\` for wholesale.
6. After translating each regex script's replace_string, call test_regex with the ORIGINAL find_regex and a sample of the kind of output the LLM would emit, and confirm the regex still matches with the same named capture groups present. If it doesn't, the structure was disturbed — revert and try a smaller find/replace.
7. Walk surfaces in order; for each item, read first, plan the edits, then apply.
8. SKIP any label that is already in English or that already has an English counterpart in the same template (a bilingual label, an English fallback in a parenthetical, an English-by-default placeholder). Only translate labels with no English form anywhere nearby. Respects the author's deliberate English wording and keeps the diff small.

Start by calling survey_cjk with scopes=['regex_scripts','extensions'] — that single call covers regex scripts, lua_scripts, AND background_html in one pass. Then list_regex_scripts, character_extension_stats on \`lumirealm.payload.lua_scripts\` and \`lumirealm.payload.background_html\` (they can be huge), and only read the items that actually contain CJK to translate. Finally, before beginning, ask me the components that need translating, and whether we've missed anything at the end, that we have things to go off of. `
    },
    {
      label: "Add/update a lorebook entry on this chat's characters",
      send: "I want to add or update a lorebook entry on a character that appears in this chat. Before you do anything: ask me WHICH character the entry should cover (look at the pinned chat's recent messages for context if a chat is pinned). Then use grep_card and list_world_book_entries to check whether an entry already exists for that character. If one exists, briefly summarise its current content and ask whether I want to UPDATE it (extend / refine) or REPLACE it. If not, ask what details I want included — personality, role in the story, relationships, appearance, key facts — before creating it. Only after I confirm the plan do you call edit_world_book_entry / update_world_book_entry / create_world_book_entry. Do not write the entry's prose in chat without applying it."
    },
    {
      label: "Explain the features of this chat and what it's about",
      send: "Read this character's metadata (description, personality, scenario, first_mes, system_prompt, post_history_instructions, alternate_greetings count) and skim the world book entries and regex scripts. If a chat is pinned, look at a few of the most recent messages for tone and current state. Then explain to me in plain English: what this card is ABOUT (setting, premise, key characters), what MECHANICS the card runs (status panels, command syntax, themed regex outputs, time/weather/location systems, mode toggles, dice rolls, anything special), and HOW a user typically interacts with it (what kind of inputs the card responds to, what UI features will appear). Be specific — quote the actual regex panel markers, name the actual status fields. Don't edit anything; this is a read-only audit."
    },
    {
      label: "Change the gender/sex of certain characters",
      send: `I want to change the gender or sex of one or more characters in this card. Before any edits, ask me WHICH character(s) I want to change and WHAT the new gender should be for each. The change needs to be COMPLETE — once you have the list:

1. Use grep_card to find every reference to each character: their name + all pronouns currently used for them (he/she/they/her/his/them) + any gendered honorifics in the source language (Mr./Ms./onee-chan/onii-san/etc.) + any explicitly gendered nouns (man/woman/boy/girl/lady/sir/etc.).
2. Map out an edit plan covering EVERY surface that references them: their lorebook entry, all alternate_greetings, first_mes, scenario, description, personality, system_prompt, post_history_instructions, regex replace_string templates that mention them, and the LumiRealm payload mirror if this is a LumiRealm-imported card.
3. Show me the plan as a list of (surface, field, what changes) BEFORE applying.
4. After I confirm, apply. apply_glossary is the right tool for the pronoun pass — but be careful with single-character CJK keys (banned by default for substring-collision safety). Pronouns, possessives, honorifics, and gendered nouns all need to flip consistently.`
    }
  ];
  const suggestions = el8("div", "la-empty-suggestions");
  for (const item of SUGGESTIONS) {
    const s = el8("button", "la-empty-suggestion", item.label);
    s.title = item.send;
    s.addEventListener("click", () => {
      textarea.value = item.send;
      autosizeTextarea();
      doSend();
    });
    suggestions.appendChild(s);
  }
  emptyState.appendChild(suggestions);
  const composer = el8("div", "la-composer");
  const mouseyImg = document.createElement("img");
  mouseyImg.className = "la-mousey";
  mouseyImg.src = resolveMouseyImageUrl();
  mouseyImg.alt = "";
  mouseyImg.setAttribute("aria-hidden", "true");
  composer.appendChild(mouseyImg);
  const composerInner = el8("div", "la-composer-inner");
  const composerArea = el8("div", "la-composer-area");
  const textarea = document.createElement("textarea");
  textarea.className = "la-textarea";
  textarea.rows = 1;
  textarea.placeholder = "Ask anything";
  const composerActions = el8("div", "la-composer-actions");
  const sendBtn = el8("button", "la-send-btn");
  sendBtn.setAttribute("aria-label", "Send");
  sendBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
  const cancelBtn = el8("button", "la-cancel-btn");
  cancelBtn.setAttribute("aria-label", "Stop");
  cancelBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';
  cancelBtn.style.display = "none";
  const compactBtn = el8("button", "la-compact-btn");
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
  const compactTip = el8("div", "la-compact-tooltip");
  const compactTipMain = el8("div", "la-compact-tooltip-main", "Context fully available.");
  const compactTipSub = el8("div", "la-compact-tooltip-sub", "Click to compact now.");
  compactTip.append(compactTipMain, compactTipSub);
  compactBtn.appendChild(compactTip);
  composerActions.append(compactBtn, sendBtn, cancelBtn);
  composerArea.append(textarea, composerActions);
  const composerStatus = el8("div", "la-composer-status");
  composerInner.append(composerArea, composerStatus);
  composer.appendChild(composerInner);
  const dumpGeometry = () => {
    const threadRect = thread.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const mouseyRect = mouseyImg.getBoundingClientRect();
    const threadCS = getComputedStyle(thread);
    const composerCS = getComputedStyle(composer);
    const mouseyCS = getComputedStyle(mouseyImg);
    const drawerCS = thread.parentElement ? getComputedStyle(thread.parentElement) : null;
    const innerEl = thread.querySelector(".la-virt-inner");
    const messages = innerEl ? Array.from(innerEl.children) : [];
    const lastMsg = messages[messages.length - 1] ?? null;
    const lastMsgRect = lastMsg?.getBoundingClientRect() ?? null;
    const lastMsgActions = lastMsg?.querySelector(".la-msg-actions");
    const lastActionsRect = lastMsgActions?.getBoundingClientRect() ?? null;
    const spacerEl = thread.querySelector(".la-virt-spacer");
    const spacerRect = spacerEl?.getBoundingClientRect() ?? null;
    return {
      viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
      drawer: {
        containerType: drawerCS?.containerType,
        containerName: drawerCS?.containerName,
        width: thread.parentElement?.getBoundingClientRect().width ?? null
      },
      thread: {
        rect: { top: threadRect.top, bottom: threadRect.bottom, height: threadRect.height, width: threadRect.width },
        paddingTop: threadCS.paddingTop,
        paddingBottom: threadCS.paddingBottom,
        scrollTop: thread.scrollTop,
        scrollHeight: thread.scrollHeight,
        clientHeight: thread.clientHeight,
        overflowAnchor: threadCS.overflowAnchor,
        contain: threadCS.contain
      },
      composer: {
        rect: { top: composerRect.top, bottom: composerRect.bottom, height: composerRect.height },
        paddingTop: composerCS.paddingTop
      },
      mousey: {
        rect: { top: mouseyRect.top, bottom: mouseyRect.bottom, height: mouseyRect.height, width: mouseyRect.width },
        cssHeight: mouseyCS.height,
        transform: mouseyCS.transform,
        bottom: mouseyCS.bottom,
        position: mouseyCS.position,
        extentAboveComposer: composerRect.top - mouseyRect.top,
        topRelativeToThreadBottom: mouseyRect.top - threadRect.bottom
      },
      spacer: spacerRect ? {
        rect: { top: spacerRect.top, bottom: spacerRect.bottom, height: spacerRect.height },
        cssHeight: spacerEl ? getComputedStyle(spacerEl).height : null
      } : null,
      lastMessage: lastMsgRect ? {
        rect: { top: lastMsgRect.top, bottom: lastMsgRect.bottom, height: lastMsgRect.height },
        clearanceToComposerTop: composerRect.top - lastMsgRect.bottom,
        clearanceToMouseyTop: mouseyRect.top - lastMsgRect.bottom
      } : null,
      lastActions: lastActionsRect ? {
        rect: { top: lastActionsRect.top, bottom: lastActionsRect.bottom, height: lastActionsRect.height },
        clearanceToComposerTop: composerRect.top - lastActionsRect.bottom,
        clearanceToMouseyTop: mouseyRect.top - lastActionsRect.bottom
      } : null,
      messageCount: messages.length
    };
  };
  globalThis.__laGeom = dumpGeometry;
  queueMicrotask(() => {
    console.log("[la-geom] initial layout snapshot", dumpGeometry());
  });
  const TEXTAREA_MAX_PX = 84;
  const autosizeTextarea = () => {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, TEXTAREA_MAX_PX) + "px";
  };
  textarea.addEventListener("input", autosizeTextarea);
  textarea.addEventListener("input", () => updateComposer());
  let mouseyOverlapRaf = null;
  const detectMouseyOverlap = () => {
    if (mouseyOverlapRaf !== null)
      return;
    mouseyOverlapRaf = requestAnimationFrame(() => {
      mouseyOverlapRaf = null;
      const m = mouseyImg.getBoundingClientRect();
      if (m.width === 0 || m.height === 0) {
        mouseyImg.classList.remove("la-mousey-overlap");
        return;
      }
      const t = textarea.getBoundingClientRect();
      const overlap = textarea.value.length > 0 && t.right > m.left && t.left < m.right && t.bottom > m.top && t.top < m.bottom;
      mouseyImg.classList.toggle("la-mousey-overlap", overlap);
    });
  };
  textarea.addEventListener("input", detectMouseyOverlap);
  window.addEventListener("resize", detectMouseyOverlap);
  root.append(header, thread, composer);
  const sendBackend = (msg) => ctx.sendToBackend(msg);
  const refreshLists = () => {
    sendBackend({ type: "list_characters" });
    sendBackend({ type: "list_connections" });
    sendBackend({ type: "list_sessions" });
    sendBackend({ type: "get_ui_prefs" });
  };
  const renderCharOptions = () => {
    if (state.characters.length === 0) {
      charCombo.setItems([]);
      charCombo.setPlaceholder("No characters");
      charCombo.setDisabled(true);
      return;
    }
    charCombo.setDisabled(false);
    charCombo.setPlaceholder("Pick character");
    charCombo.setItems(state.characters.map((c) => ({
      id: c.id,
      label: c.name,
      sublabel: `${c.world_book_ids.length} WB · ${c.regex_script_count} regex`
    })));
    if (state.characterId)
      charCombo.setValue(state.characterId, true);
  };
  const renderConnOptions = () => {
    const cur = connSelect.value;
    connSelect.innerHTML = "";
    if (state.connections.length === 0) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "No connections";
      connSelect.appendChild(o);
      connSelect.disabled = true;
      return;
    }
    connSelect.disabled = false;
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "- default connection -";
    connSelect.appendChild(placeholder);
    for (const c of state.connections) {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = `${c.name} (${c.provider}${c.model ? `/${c.model}` : ""})${c.is_default ? " *" : ""}`;
      connSelect.appendChild(o);
    }
    if (state.connectionId && state.connections.some((c) => c.id === state.connectionId)) {
      connSelect.value = state.connectionId;
    } else if (cur && state.connections.some((c) => c.id === cur)) {
      connSelect.value = cur;
    } else {
      const def = state.connections.find((c) => c.is_default);
      if (def)
        connSelect.value = def.id;
    }
  };
  const updateSessionBar = () => {
    const source = state.characterLedger.length > 0 ? state.characterLedger : state.edits;
    const liveEdits = source.filter((e) => !e.reverted).length;
    editsCount.textContent = String(liveEdits);
    if (liveEdits === 0 && source.length === 0) {
      editsBadge.classList.remove("has-edits");
    } else {
      editsBadge.classList.add("has-edits");
    }
  };
  const COMPACT_RING_CIRC = 94.2;
  const COMPACT_AUTO_THRESHOLD = 0.84;
  const updateCompactButton = () => {
    const ctxTokens = Math.max(1, state.contextTokens);
    const used = state.contextPromptTokens / ctxTokens;
    const clamped = Math.max(0, Math.min(1, used));
    const fill = compactRing.querySelector(".la-compact-fill");
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
    if (!state.sessionId || state.isGenerating || state.startingSession || state.compacting)
      return;
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
      } else if (state.characterId) {
        composerStatus.textContent = "Type a message and press Send. A new session will start automatically.";
      } else {
        composerStatus.textContent = "Pick a character first.";
      }
    }
    const hasText = textarea.value.trim().length > 0;
    const last = state.messages[state.messages.length - 1];
    const canContinue = !hasText && !!last && last.role === "user";
    const sendDisabled = !state.characterId || state.startingSession || !hasText && !canContinue;
    sendBtn.disabled = sendDisabled;
    updateCompactButton();
  };
  const spliceEntries = (ids) => {
    if (ids.size === 0)
      return;
    state.edits = state.edits.filter((e) => !ids.has(e.id));
    state.characterLedger = state.characterLedger.filter((e) => !ids.has(e.id));
  };
  const handleRevertOutcome = async (editId, outcome) => {
    if (outcome.kind === "clean" || outcome.kind === "noop_already_reverted") {
      const removed = new Set([editId]);
      if (outcome.kind === "clean" && outcome.cascadedEditIds && outcome.cascadedEditIds.length > 0) {
        for (const id of outcome.cascadedEditIds)
          removed.add(id);
        const n = outcome.cascadedEditIds.length;
        composerStatus.textContent = `Reverted, along with ${n} dependent edit${n === 1 ? "" : "s"} that built on it.`;
        composerStatus.classList.remove("is-error");
      }
      spliceEntries(removed);
      rerenderThread();
      updateSessionBar();
      if (state.diffModal)
        state.diffModal.setEdits(state.characterLedger);
      return;
    }
    if (outcome.kind === "failed") {
      composerStatus.textContent = `Revert failed: ${outcome.error}`;
      composerStatus.classList.add("is-error");
      return;
    }
    const message = outcome.kind === "superseded" ? `${outcome.laterEditIds.length} later edit(s) couldn't be re-applied without this one. Force-revert anyway? Affected later edits will also be marked reverted.` : `The field has been changed outside the agent since this edit.

Current value starts with:
${outcome.currentSample.slice(0, 200)}

Force-revert anyway (this overwrites the external change)?`;
    const c = await ctx.ui.showConfirm({
      title: outcome.kind === "superseded" ? "Dependent edits exist" : "External change detected",
      message,
      variant: "warning",
      confirmLabel: "Force revert"
    });
    if (c.confirmed && state.characterId) {
      sendBackend({ type: "revert_edit", characterId: state.characterId, editId, force: true });
    }
  };
  const openWorkshopOnFile = (path) => {
    openDiffs();
    const rootEl = state.diffModal;
    rootEl?.__focusTab?.("files");
    state.workspacePanel?.focusFile(path);
  };
  const openDiffs = (initialEditId) => {
    if (state.diffModal && state.diffModal.isOpen()) {
      state.diffModal.setEdits(state.edits);
      if (initialEditId)
        state.diffModal.focusEdit(initialEditId);
      return;
    }
    state.diffModal = null;
    if (!state.workspacePanel) {
      state.workspacePanel = mountWorkspacePanel({ ctx, sendBackend });
    }
    if (!state.charactersPanel) {
      state.charactersPanel = mountCharactersPanel({
        ctx,
        sendBackend,
        onFocusCharacter: (cid, name) => {
          state.workshopFocusCharacterId = cid;
          state.workshopFocusCharacterName = name;
          sendBackend({ type: "load_character_workshop", characterId: cid });
          const rootEl = state.diffModal;
          rootEl?.__focusTab?.("edits");
        }
      });
    }
    state.diffModal = openDiffModal(ctx, {
      getEdits: () => {
        return state.characterLedger.length > 0 ? state.characterLedger : state.edits;
      },
      onRevert: async (editId) => {
        const cid = state.workshopFocusCharacterId ?? state.characterId;
        if (!cid)
          return;
        sendBackend({ type: "revert_edit", characterId: cid, editId });
      },
      onClose: () => {
        state.diffModal = null;
        if (state.workshopFocusCharacterId) {
          state.workshopFocusCharacterId = null;
          state.workshopFocusCharacterName = null;
          if (state.characterId)
            sendBackend({ type: "list_character_edits", characterId: state.characterId });
        }
      },
      filesPanel: state.workspacePanel.root,
      charactersPanel: state.charactersPanel.root,
      onCharactersTabActivated: () => state.charactersPanel?.refresh()
    }, initialEditId !== undefined ? { initialEditId } : {});
  };
  let renderEditIndex = buildEditIndex(state.edits);
  const virtualizer = new ChatVirtualizer({
    scrollContainer: thread,
    getMessages: () => state.messages,
    renderMessage: (msg) => {
      if (state.streamingAssistant && msg.id === state.currentAssistantMessage?.id) {
        return state.streamingAssistant.root;
      }
      const deps = makeThreadDeps();
      const anchorId = rollingAnchorId();
      const node = renderMessage(msg, deps, renderEditIndex);
      if (anchorId !== null && msg.id === anchorId) {
        const wrap = document.createElement("div");
        wrap.appendChild(node);
        const divider = el8("div", "la-cache-divider");
        divider.appendChild(el8("span", "la-cache-divider-label", "messages above this line are cached"));
        wrap.appendChild(divider);
        return wrap;
      }
      return node;
    },
    estimateSize: (msg) => msg.role === "user" ? 80 : 280
  });
  const rerenderThread = () => {
    state.loading = false;
    if (!state.sessionId || state.messages.length === 0) {
      virtualizer.clear();
      if (!thread.contains(emptyState))
        thread.appendChild(emptyState);
      virtualizer.setCount();
      return;
    }
    if (thread.contains(emptyState))
      thread.removeChild(emptyState);
    renderEditIndex = buildEditIndex(state.edits);
    virtualizer.clear();
    virtualizer.setCount();
  };
  const liveEditsForAssistantMessage = (assistantMessageId) => {
    const source = state.characterLedger.length > 0 ? state.characterLedger : state.edits;
    return source.filter((e) => e.assistantMessageId === assistantMessageId && !e.reverted).length;
  };
  const liveEditsAfterUserMessage = (userMessageId) => {
    const idx = state.messages.findIndex((m) => m.id === userMessageId && m.role === "user");
    if (idx < 0)
      return 0;
    const tailAssistantIds = new Set(state.messages.slice(idx + 1).filter((m) => m.role === "assistant").map((m) => m.id));
    const source = state.characterLedger.length > 0 ? state.characterLedger : state.edits;
    return source.filter((e) => e.assistantMessageId !== undefined && tailAssistantIds.has(e.assistantMessageId) && !e.reverted).length;
  };
  const promptEditsAction = async (opts) => {
    const verb = opts.action === "edit" ? "editing this message" : opts.action === "regenerate" ? "regenerating this response" : "deleting this message";
    const tail = opts.action === "delete" ? `${opts.liveEditCount} edit${opts.liveEditCount === 1 ? " was" : "s were"} made by this response. Revert ${opts.liveEditCount === 1 ? "it" : "them"} on the character now, or leave ${opts.liveEditCount === 1 ? "it" : "them"} applied?` : `${verb} will discard the AI turns after this point. ${opts.liveEditCount} edit${opts.liveEditCount === 1 ? "" : "s"} the agent made are tracked in the ledger.

Revert those edits to the character now, or leave them applied?`;
    const c = await ctx.ui.showConfirm({
      title: `${opts.liveEditCount} character edit${opts.liveEditCount === 1 ? "" : "s"} in this thread`,
      message: tail,
      variant: "warning",
      confirmLabel: "Revert edits",
      cancelLabel: "Keep edits"
    });
    return c.confirmed ? "revert" : "keep";
  };
  function makeThreadDeps() {
    return {
      onRevertEdit: async (editId) => {
        if (!state.characterId)
          return;
        sendBackend({ type: "revert_edit", characterId: state.characterId, editId });
      },
      onRevertManyEdits: async (editIds) => {
        if (!state.characterId || editIds.length === 0)
          return;
        const c = await ctx.ui.showConfirm({
          title: `Revert ${editIds.length} edit${editIds.length === 1 ? "" : "s"}?`,
          message: "Reverts every live edit in this card. Cascade-affected siblings revert too. Workshop history keeps the records (use Undo revert to restore individual ones).",
          variant: "danger",
          confirmLabel: "Revert all"
        });
        if (!c.confirmed)
          return;
        sendBackend({ type: "revert_edits_bulk", characterId: state.characterId, editIds: [...editIds], ...state.sessionId ? { sessionId: state.sessionId } : {} });
      },
      onOpenDiffModal: (initialEditId) => openDiffs(initialEditId),
      onEditUserMessage: async (messageId, newContent, editsAction) => {
        if (!state.sessionId)
          return;
        if (isCacheInvalidating(messageId)) {
          const c = await ctx.ui.showConfirm({
            title: "Editing this message will invalidate the prompt cache",
            message: "This message sits at or before the rolling cache anchor (2 user-turns back). Editing it forces the provider to rebuild ~the entire conversation prefix on the next send. Continue?",
            variant: "danger",
            confirmLabel: "Edit anyway"
          });
          if (!c.confirmed)
            return;
        }
        sendBackend({ type: "edit_user_message", sessionId: state.sessionId, messageId, newContent, editsAction, ...state.connectionId ? { connectionId: state.connectionId } : {} });
      },
      onRegenerateAssistant: async (assistantMessageId, editsAction) => {
        if (!state.sessionId)
          return;
        sendBackend({ type: "regenerate_assistant_message", sessionId: state.sessionId, assistantMessageId, editsAction, ...state.connectionId ? { connectionId: state.connectionId } : {} });
      },
      onDeleteMessage: async (messageId, editsAction) => {
        if (!state.sessionId)
          return;
        const cacheWarn = isCacheInvalidating(messageId);
        const c = await ctx.ui.showConfirm({
          title: "Delete message",
          message: cacheWarn ? "Permanently remove this message. It sits at or before the rolling cache anchor, so deleting it will invalidate the prompt cache and the provider rebuilds the prefix on the next send." : "Permanently remove this message from the conversation? Other messages stay in place.",
          variant: "danger",
          confirmLabel: "Delete"
        });
        if (!c.confirmed)
          return;
        sendBackend({ type: "delete_message", sessionId: state.sessionId, messageId, editsAction });
      },
      onFreeToolResult: async (callId) => {
        if (!state.sessionId)
          return;
        const ownerId = findAssistantMessageIdForCallId(callId);
        const willInvalidate = ownerId ? isCacheInvalidating(ownerId) : false;
        if (willInvalidate) {
          const c = await ctx.ui.showConfirm({
            title: "Free this tool result",
            message: "This tool result sits at or before the rolling cache anchor, so freeing it invalidates the prompt cache and the provider rebuilds the entire prefix on the next send. Free anyway?",
            variant: "danger",
            confirmLabel: "Free and rebuild cache"
          });
          if (!c.confirmed)
            return;
        }
        sendBackend({ type: "free_tool_result", sessionId: state.sessionId, callId });
      },
      isToolResultInCache: (callId) => {
        const ownerId = findAssistantMessageIdForCallId(callId);
        return ownerId ? isCacheInvalidating(ownerId) : false;
      },
      promptEditsAction,
      liveEditsForAssistantMessage,
      liveEditsAfterUserMessage
    };
  }
  charCombo.onChange((id) => {
    const switchingAway = state.sessionId !== null && id !== state.characterId;
    dlog("charCombo change", { newCharacterId: id, prevCharacterId: state.characterId, sessionId: state.sessionId, switchingAway });
    if (switchingAway) {
      state.sessionId = null;
      state.messages = [];
      state.edits = [];
      state.streamingAssistant = null;
      state.currentAssistantMessage = null;
      persistUiPrefs();
    }
    state.characterId = id;
    state.characterLedger = [];
    state.chatsForCharacter = [];
    state.pinnedChatId = null;
    state.autoPinNeeded = !!id;
    chatPinBtn.classList.remove("has-pinned");
    if (switchingAway)
      rerenderThread();
    updateComposer();
    updateSessionBar();
    if (id) {
      sendBackend({ type: "list_character_edits", characterId: id });
      sendBackend({ type: "list_chats", characterId: id, ...state.sessionId ? { sessionId: state.sessionId } : {} });
    }
  });
  const persistUiPrefs = () => {
    sendBackend({
      type: "update_ui_prefs",
      connectionId: state.connectionId,
      lastSessionId: state.sessionId
    });
  };
  connSelect.addEventListener("change", () => {
    state.connectionId = connSelect.value || null;
    persistUiPrefs();
  });
  newSessionBtn.addEventListener("click", () => {
    if (!state.characterId) {
      composerStatus.textContent = "Pick a character first.";
      composerStatus.classList.add("is-error");
      return;
    }
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
    rerenderThread();
    updateSessionBar();
    updateComposer();
    const startMsg = {
      type: "start_session",
      sessionId: state.sessionId,
      characterId: state.characterId,
      ...state.connectionId ? { connectionId: state.connectionId } : {}
    };
    sendBackend(startMsg);
    clearStartTimeout();
    state.startSessionTimeout = setTimeout(() => {
      if (!state.startingSession)
        return;
      state.startingSession = false;
      state.startSessionTimeout = null;
      composerStatus.textContent = "Backend did not respond to start_session. Restart Lumiverse (start.ps1 -b) and hard-refresh.";
      composerStatus.classList.add("is-error");
      updateComposer();
    }, 8000);
  });
  const pinChatOrQueue = (chatId) => {
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
    rerenderThread();
    updateSessionBar();
    updateComposer();
    const startMsg = {
      type: "start_session",
      sessionId,
      characterId: state.characterId,
      ...state.connectionId ? { connectionId: state.connectionId } : {}
    };
    sendBackend(startMsg);
    clearStartTimeout();
    state.startSessionTimeout = setTimeout(() => {
      if (!state.startingSession)
        return;
      state.startingSession = false;
      state.pendingPinChatId = null;
      state.startSessionTimeout = null;
      composerStatus.textContent = "Backend did not respond to start_session. Restart Lumiverse and hard-refresh.";
      composerStatus.classList.add("is-error");
      updateComposer();
    }, 8000);
  };
  const openChatPickerModal = () => {
    if (!state.characterId) {
      composerStatus.textContent = "Pick a character first.";
      composerStatus.classList.add("is-error");
      return;
    }
    sendBackend({ type: "list_chats", characterId: state.characterId, ...state.sessionId ? { sessionId: state.sessionId } : {} });
    const handle = ctx.ui.showModal({ title: "Pin a chat", width: 520, maxHeight: 560 });
    const note = el8("p", "la-modal-note", "Pick a chat to give the agent read access to its message history. The agent uses the pinned chat when you reference 'this chat', 'the conversation', etc. Pin nothing to keep the agent isolated from your chat data.");
    const list = el8("div", "la-sessions-modal-list");
    const render = () => {
      list.innerHTML = "";
      const unpin = el8("button", `la-session-item ${state.pinnedChatId === null ? "is-active" : ""}`);
      unpin.append(Object.assign(el8("div"), { textContent: "(No chat pinned)" }), el8("div", "la-session-item-meta", "Agent has no message-history access."));
      unpin.addEventListener("click", () => {
        pinChatOrQueue(null);
        handle.dismiss();
      });
      list.appendChild(unpin);
      if (state.chatsForCharacter.length === 0) {
        list.appendChild(el8("div", "la-diff-pane-empty", "No chats yet for this character."));
        return;
      }
      for (const c of state.chatsForCharacter) {
        const row = el8("div", `la-session-item ${c.isPinned ? "is-active" : ""}`);
        const main = el8("div");
        const title = el8("div");
        title.textContent = c.name + (c.isActive ? "  (currently open)" : "");
        main.append(title);
        main.append(el8("div", "la-session-item-meta", `updated ${new Date(c.updatedAt).toLocaleString()}`));
        row.appendChild(main);
        row.addEventListener("click", () => {
          pinChatOrQueue(c.id);
          handle.dismiss();
        });
        list.appendChild(row);
      }
    };
    handle.root.append(note, list);
    render();
    const detach = pushChatsListeners.push(render);
    handle.onDismiss(() => detach());
  };
  const pushChatsListeners = {
    handlers: [],
    push(h) {
      this.handlers.push(h);
      return () => {
        this.handlers = this.handlers.filter((x) => x !== h);
      };
    }
  };
  const pushSessionsListeners = {
    handlers: [],
    push(h) {
      this.handlers.push(h);
      return () => {
        this.handlers = this.handlers.filter((x) => x !== h);
      };
    }
  };
  chatPinBtn.addEventListener("click", () => openChatPickerModal());
  const openSessionsModal = () => {
    const handle = ctx.ui.showModal({ title: "Sessions", width: 520 });
    const list = el8("div", "la-sessions-modal-list");
    handle.root.appendChild(list);
    const render = () => {
      list.innerHTML = "";
      if (state.sessions.length === 0) {
        list.appendChild(el8("div", "la-diff-pane-empty", "No sessions yet."));
        return;
      }
      for (const s of state.sessions) {
        const row = el8("div", `la-session-item ${s.sessionId === state.sessionId ? "is-active" : ""}`);
        const main = el8("div", "la-session-item-main");
        main.append(el8("div", undefined, `${s.characterName}`));
        main.append(el8("div", "la-session-item-meta", `${s.messageCount} msg . ${s.editCount} edits${s.revertedEditCount ? ` (${s.revertedEditCount} reverted)` : ""} . ${new Date(s.lastActivityAt).toLocaleString()}`));
        const delBtn = el8("button", "la-session-item-delete");
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
        row.append(main, delBtn);
        row.addEventListener("click", () => {
          sendBackend({ type: "load_session", sessionId: s.sessionId });
          handle.dismiss();
        });
        list.appendChild(row);
      }
    };
    render();
    sendBackend({ type: "list_sessions" });
    const detach = pushSessionsListeners.push(render);
    handle.onDismiss(() => detach());
  };
  editsBadge.addEventListener("click", () => openDiffs());
  menuBtn.addEventListener("click", async () => {
    const rect = menuBtn.getBoundingClientRect();
    const res = await ctx.ui.showContextMenu({
      position: { x: rect.left, y: rect.bottom + 4 },
      items: [
        { key: "sessions", label: "Switch session..." },
        { key: "settings", label: "Agent settings (persona & prompt)..." },
        { key: "icon", label: "Visuals & display name..." },
        { key: "revert_active", label: "Revert all edits in this session", disabled: !state.sessionId, danger: true },
        { key: "delete_active", label: "Delete current session", disabled: !state.sessionId, danger: true }
      ]
    });
    if (res.selectedKey === "sessions")
      openSessionsModal();
    else if (res.selectedKey === "settings")
      openAgentSettingsModal();
    else if (res.selectedKey === "icon")
      openIconSettingsModal();
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
        confirmLabel: "Revert all"
      });
      if (c.confirmed)
        sendBackend({ type: "revert_session", sessionId: state.sessionId });
    } else if (res.selectedKey === "delete_active" && state.sessionId) {
      const c = await ctx.ui.showConfirm({
        title: "Delete session",
        message: "Delete this conversation? Edits already applied to the character are NOT reverted; use the Changes panel to revert individual edits first if needed.",
        variant: "danger",
        confirmLabel: "Delete"
      });
      if (c.confirmed)
        sendBackend({ type: "delete_session", sessionId: state.sessionId });
    }
  });
  const MAX_ICON_BYTES = 2 * 1024 * 1024;
  const readImageAsDataUrl = (bytes, mimeType) => {
    let binary = "";
    for (let i = 0;i < bytes.length; i++)
      binary += String.fromCharCode(bytes[i]);
    return `data:${mimeType};base64,${btoa(binary)}`;
  };
  const openAgentSettingsModal = () => {
    sendBackend({ type: "get_settings" });
    const handle = ctx.ui.showModal({ title: "Agent settings", width: 1360, maxHeight: 1080 });
    const wrap = el8("div", "la-agent-settings");
    wrap.appendChild(el8("p", "la-modal-note", "Customize how LumiAgent behaves. Saved per-user; applies to your next message."));
    wrap.appendChild(el8("label", "la-settings-label", "Persona"));
    wrap.appendChild(el8("div", "la-settings-hint", "Defines who the agent is. Prepended above the technical instructions. Default = the LumiAgent mousegirl persona."));
    const personaArea = document.createElement("textarea");
    personaArea.className = "la-settings-textarea";
    personaArea.rows = 8;
    wrap.appendChild(personaArea);
    const personaResetRow = el8("div", "la-settings-reset-row");
    const personaResetBtn = el8("button", "la-btn la-btn-mini la-btn-ghost", "Reset to default");
    personaResetRow.appendChild(personaResetBtn);
    wrap.appendChild(personaResetRow);
    wrap.appendChild(el8("label", "la-settings-label", "System prompt body"));
    wrap.appendChild(el8("div", "la-settings-hint", "The technical body. Tool guidance, working principles, edit discipline. The persona, LumiRealm, pinned-chat, and external-provider sections are appended automatically; you only own this body."));
    const promptArea = document.createElement("textarea");
    promptArea.className = "la-settings-textarea la-settings-textarea-tall";
    promptArea.rows = 12;
    wrap.appendChild(promptArea);
    const promptResetRow = el8("div", "la-settings-reset-row");
    const promptResetBtn = el8("button", "la-btn la-btn-mini la-btn-ghost", "Reset to default");
    promptResetRow.appendChild(promptResetBtn);
    wrap.appendChild(promptResetRow);
    wrap.appendChild(el8("label", "la-settings-label", "Samplers"));
    wrap.appendChild(el8("div", "la-settings-hint", "Drag a slider to set, double-click to reset that sampler, empty number = inherit from the connection's preset."));
    const samplersList = el8("div", "la-samplers-list");
    wrap.appendChild(samplersList);
    const samplersResetRow = el8("div", "la-settings-reset-row");
    const samplersResetBtn = el8("button", "la-btn la-btn-mini la-btn-ghost", "Reset all");
    samplersResetRow.appendChild(samplersResetBtn);
    wrap.appendChild(samplersResetRow);
    const jbHead = el8("div", "la-settings-section-head");
    jbHead.append(el8("label", "la-settings-label", "Jailbreak / prefill"));
    wrap.appendChild(jbHead);
    wrap.appendChild(el8("div", "la-settings-hint", "Optional text injected per message. Leave empty to disable."));
    const jbArea = document.createElement("textarea");
    jbArea.className = "la-settings-textarea";
    jbArea.rows = 4;
    wrap.appendChild(jbArea);
    const jbPlacementRow = el8("div", "la-settings-row");
    jbPlacementRow.append(el8("label", "la-settings-row-label", "Placement"));
    const jbPlacement = document.createElement("select");
    jbPlacement.className = "la-select";
    for (const [val, lbl] of [
      ["system_suffix", "End of system prompt"],
      ["user_suffix", "End of message list as user"],
      ["assistant_prefill", "End of message list as agent (prefill)"]
    ]) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = lbl;
      jbPlacement.appendChild(opt);
    }
    jbPlacementRow.appendChild(jbPlacement);
    wrap.appendChild(jbPlacementRow);
    wrap.appendChild(el8("label", "la-settings-label", "Agent notes"));
    wrap.appendChild(el8("div", "la-settings-hint", "Long-term memory file the agent reads at the start of every session. Anything you put there is preloaded into context."));
    const notesRow = el8("div", "la-settings-row");
    const notesBtn = el8("button", "la-btn la-btn-mini", "Open agent notes");
    notesBtn.addEventListener("click", () => {
      handle.dismiss();
      openWorkshopOnFile("agent/agent.md");
    });
    notesRow.appendChild(notesBtn);
    wrap.appendChild(notesRow);
    wrap.appendChild(el8("label", "la-settings-label", "Storage limits"));
    wrap.appendChild(el8("div", "la-settings-hint", "Per-user storage cap for the workspace."));
    const wsCapRow = el8("div", "la-settings-row");
    wsCapRow.append(el8("label", "la-settings-row-label", "Workspace cap (MB)"));
    const wsCapInput = document.createElement("input");
    wsCapInput.type = "number";
    wsCapInput.className = "la-slider-input";
    wsCapInput.min = "1";
    wsCapInput.step = "1";
    wsCapRow.appendChild(wsCapInput);
    wrap.appendChild(wsCapRow);
    wrap.appendChild(el8("label", "la-settings-label", "Tool output cap"));
    wrap.appendChild(el8("div", "la-settings-hint", "Set to dump any single tool result over that many tokens to a tmp file the agent can grep/read to avoid blowing up context."));
    const toolCapRow = el8("div", "la-settings-row");
    toolCapRow.append(el8("label", "la-settings-row-label", "Tool output cap (tk)"));
    const toolCapInput = document.createElement("input");
    toolCapInput.type = "number";
    toolCapInput.className = "la-slider-input";
    toolCapInput.min = "1";
    toolCapInput.step = "1";
    toolCapRow.appendChild(toolCapInput);
    wrap.appendChild(toolCapRow);
    wrap.appendChild(el8("label", "la-settings-label", "Prompt caching"));
    wrap.appendChild(el8("div", "la-settings-hint", "Marks parts of every request as cacheable so supported providers (Anthropic, OpenAI, Bedrock, Gemini) charge a fraction on cache reads. Full mode caches two turns behind the latest message. System only caches the system prompt. Off attaches no markers."));
    const cacheModeRow = el8("div", "la-settings-row");
    cacheModeRow.append(el8("label", "la-settings-row-label", "Cache mode"));
    const cacheModeSelect = document.createElement("select");
    cacheModeSelect.className = "la-select";
    for (const [val, label] of [["full", "Full"], ["system_only", "System only"], ["off", "Off"]]) {
      const o = document.createElement("option");
      o.value = val;
      o.textContent = label;
      cacheModeSelect.appendChild(o);
    }
    cacheModeRow.appendChild(cacheModeSelect);
    wrap.appendChild(cacheModeRow);
    const cacheSupportRow = el8("div", "la-settings-row");
    cacheSupportRow.append(el8("label", "la-settings-row-label", "Connection supports caching"));
    const cacheSupportInput = document.createElement("input");
    cacheSupportInput.type = "checkbox";
    cacheSupportInput.className = "la-checkbox";
    cacheSupportRow.appendChild(cacheSupportInput);
    wrap.appendChild(cacheSupportRow);
    wrap.appendChild(el8("div", "la-settings-hint", "Leave ON for Anthropic, OpenAI, Bedrock, Gemini, OpenRouter (Anthropic routes). Turn OFF for proxies or local models that don't honour cache_control."));
    const autoFreeRow = el8("div", "la-settings-row");
    autoFreeRow.append(el8("label", "la-settings-row-label", "Auto-free old tool results"));
    const autoFreeInput = document.createElement("input");
    autoFreeInput.type = "checkbox";
    autoFreeInput.className = "la-checkbox";
    autoFreeRow.appendChild(autoFreeInput);
    wrap.appendChild(autoFreeRow);
    wrap.appendChild(el8("div", "la-settings-hint", "Stub-replace insensitive tool results after 10 user turns to save context. Off by default. Turn on if you're on a provider that doesn't honour cache markers AND you see context grow unchecked."));
    const status = el8("div", "la-composer-status");
    wrap.appendChild(status);
    const actions = el8("div", "la-settings-actions");
    const cancelBtn2 = el8("button", "la-btn", "Cancel");
    const saveBtn = el8("button", "la-btn la-btn-primary", "Save");
    actions.append(cancelBtn2, saveBtn);
    wrap.appendChild(actions);
    let samplerBag = {
      temperature: null,
      maxTokens: null,
      contextSize: null,
      topP: null,
      minP: null,
      topK: null,
      frequencyPenalty: null,
      presencePenalty: null,
      repetitionPenalty: null
    };
    const populate = () => {
      const s = state.settings;
      if (!s) {
        personaArea.value = "";
        personaArea.placeholder = "Loading...";
        promptArea.value = "";
        return;
      }
      personaArea.value = s.persona;
      personaArea.placeholder = "(empty: agent has no persona)";
      promptArea.value = s.systemPromptOverride ?? (s.defaultSystemPromptBody ?? "");
      if (s.samplers)
        samplerBag = { ...s.samplers };
      jbArea.value = s.jailbreak ?? "";
      jbPlacement.value = s.jailbreakPlacement ?? "system_suffix";
      const wsDefault = s.workspaceCapDefaultBytes ?? 5 * 1024 * 1024 * 1024;
      wsCapInput.placeholder = `${Math.round(wsDefault / 1024 / 1024)}`;
      wsCapInput.value = s.workspaceCapBytes ? String(Math.round(s.workspaceCapBytes / 1024 / 1024)) : "";
      const toolDefault = s.toolOutputCapDefaultTokens ?? 8000;
      toolCapInput.placeholder = `${toolDefault}`;
      toolCapInput.value = s.toolOutputCapTokens ? String(s.toolOutputCapTokens) : "";
      cacheModeSelect.value = s.cacheMode ?? "full";
      cacheSupportInput.checked = s.connectionSupportsPromptCaching ?? true;
      autoFreeInput.checked = s.autoFreeOldToolResults ?? false;
      renderSamplers();
    };
    const resetAllSamplers = () => {
      for (const k of Object.keys(samplerBag))
        samplerBag[k] = null;
      renderSamplers();
    };
    const SAMPLER_DEFS = [
      { key: "temperature", label: "Temperature", type: "float", min: 0, max: 2, step: 0.01, defaultHint: 1 },
      { key: "maxTokens", label: "Max Response", type: "int", min: 1, max: 128000, step: 1, defaultHint: 16384 },
      { key: "contextSize", label: "Context Size", type: "int", min: 1, max: 2000000, step: 1, defaultHint: 128000 },
      { key: "topP", label: "Top P", type: "float", min: 0, max: 1, step: 0.01, defaultHint: 0.95 },
      { key: "minP", label: "Min P", type: "float", min: 0, max: 1, step: 0.01, defaultHint: 0 },
      { key: "topK", label: "Top K", type: "int", min: 0, max: 500, step: 1, defaultHint: 0 },
      { key: "frequencyPenalty", label: "Freq Penalty", type: "float", min: 0, max: 2, step: 0.01, defaultHint: 0 },
      { key: "presencePenalty", label: "Pres Penalty", type: "float", min: 0, max: 2, step: 0.01, defaultHint: 0 },
      { key: "repetitionPenalty", label: "Rep Penalty", type: "float", min: 0, max: 2, step: 0.01, defaultHint: 0 }
    ];
    const buildSamplerSlider = (def) => {
      const row = el8("div", "la-slider-row");
      const header2 = el8("div", "la-slider-header");
      const label = el8("span", "la-slider-label", def.label);
      const numInput = document.createElement("input");
      numInput.type = "number";
      numInput.className = "la-slider-input";
      numInput.min = String(def.min);
      numInput.max = String(def.max);
      numInput.step = String(def.step);
      numInput.placeholder = String(def.defaultHint);
      header2.append(label, numInput);
      const track = el8("div", "la-slider-track");
      track.title = "Drag to set, double-click to reset";
      const fill = el8("div", "la-slider-fill");
      const thumb = el8("div", "la-slider-thumb");
      track.append(fill, thumb);
      row.append(header2, track);
      const decimals = (String(def.step).split(".")[1] || "").length;
      const snap = (raw) => {
        const clamped = Math.min(def.max, Math.max(def.min, raw));
        const stepped = Math.round((clamped - def.min) / def.step) * def.step + def.min;
        return def.type === "int" ? Math.round(stepped) : parseFloat(stepped.toFixed(decimals));
      };
      const posToValue = (clientX) => {
        const rect = track.getBoundingClientRect();
        if (!rect || rect.width === 0)
          return def.defaultHint;
        const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        return snap(def.min + ratio * (def.max - def.min));
      };
      const applyVisual = (displayValue, isSet) => {
        const range = def.max - def.min;
        const pct = range > 0 ? Math.max(0, Math.min(100, (displayValue - def.min) / range * 100)) : 0;
        fill.style.width = `${pct}%`;
        thumb.style.left = `${pct}%`;
        track.classList.toggle("la-slider-track-set", isSet);
        label.classList.toggle("la-slider-label-set", isSet);
        numInput.classList.toggle("la-slider-input-set", isSet);
      };
      const sync = () => {
        const v = samplerBag[def.key] ?? null;
        const isSet = v !== null;
        const display = isSet ? v : def.defaultHint;
        if (document.activeElement !== numInput)
          numInput.value = isSet ? String(v) : "";
        applyVisual(display, isSet);
      };
      let dragging = false;
      let dragValue = null;
      track.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        dragging = true;
        try {
          track.setPointerCapture(e.pointerId);
        } catch {}
        dragValue = posToValue(e.clientX);
        applyVisual(dragValue, true);
      });
      track.addEventListener("pointermove", (e) => {
        if (!dragging)
          return;
        dragValue = posToValue(e.clientX);
        applyVisual(dragValue, true);
      });
      track.addEventListener("pointerup", (e) => {
        if (!dragging)
          return;
        dragging = false;
        try {
          track.releasePointerCapture(e.pointerId);
        } catch {}
        if (dragValue !== null) {
          samplerBag[def.key] = dragValue;
          sync();
        }
        dragValue = null;
      });
      track.addEventListener("dblclick", () => {
        samplerBag[def.key] = null;
        sync();
      });
      const commit = (raw) => {
        if (raw === "") {
          samplerBag[def.key] = null;
          sync();
          return;
        }
        const num = def.type === "int" ? parseInt(raw, 10) : parseFloat(raw);
        if (Number.isFinite(num)) {
          samplerBag[def.key] = snap(num);
          sync();
        }
      };
      numInput.addEventListener("change", () => commit(numInput.value));
      numInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter")
          numInput.blur();
        else if (e.key === "Escape") {
          numInput.blur();
          sync();
        }
      });
      sync();
      return row;
    };
    const renderSamplers = () => {
      samplersList.innerHTML = "";
      for (const def of SAMPLER_DEFS)
        samplersList.appendChild(buildSamplerSlider(def));
    };
    populate();
    const detach = settingsListeners.push(populate);
    handle.onDismiss(() => detach());
    personaResetBtn.addEventListener("click", () => {
      if (state.settings)
        personaArea.value = state.settings.defaultPersona;
    });
    promptResetBtn.addEventListener("click", () => {
      if (state.settings?.defaultSystemPromptBody)
        promptArea.value = state.settings.defaultSystemPromptBody;
    });
    samplersResetBtn.addEventListener("click", () => resetAllSamplers());
    cancelBtn2.addEventListener("click", () => handle.dismiss());
    saveBtn.addEventListener("click", () => {
      const persona = personaArea.value.trim();
      const promptValue = promptArea.value.trim();
      const defaultBody = state.settings?.defaultSystemPromptBody?.trim() ?? "";
      const systemPromptOverride = promptValue.length === 0 || promptValue === defaultBody ? null : promptValue;
      const placement = jbPlacement.value;
      const parseCapMb = (raw) => {
        const n = parseInt(raw.trim(), 10);
        return Number.isFinite(n) && n > 0 ? n * 1024 * 1024 : null;
      };
      const parsePosInt = (raw) => {
        const n = parseInt(raw.trim(), 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      };
      sendBackend({
        type: "update_settings",
        persona,
        systemPromptOverride,
        samplers: samplerBag,
        jailbreak: jbArea.value,
        jailbreakPlacement: placement,
        workspaceCapBytes: parseCapMb(wsCapInput.value),
        toolOutputCapTokens: parsePosInt(toolCapInput.value),
        connectionSupportsPromptCaching: cacheSupportInput.checked,
        autoFreeOldToolResults: autoFreeInput.checked,
        cacheMode: cacheModeSelect.value
      });
      status.textContent = "Saved.";
      status.classList.remove("is-error");
      setTimeout(() => handle.dismiss(), 600);
    });
    handle.root.appendChild(wrap);
  };
  const settingsListeners = {
    handlers: [],
    push(h) {
      this.handlers.push(h);
      return () => {
        this.handlers = this.handlers.filter((x) => x !== h);
      };
    }
  };
  const MAX_MOUSEY_BYTES = 4 * 1024 * 1024;
  const openIconSettingsModal = () => {
    const handle = ctx.ui.showModal({ title: "Visuals & display name", width: 520, maxHeight: 720 });
    const wrap = el8("div", "la-icon-settings");
    const note = el8("p", "la-modal-note", "Customise the drawer icon, the sitting character image, and the display name. Stored in your browser. Reload the tab to apply.");
    wrap.appendChild(note);
    const status = el8("div", "la-composer-status");
    const nameHead = el8("div", "la-settings-section-head");
    nameHead.append(el8("label", "la-settings-label", "Display name"));
    wrap.appendChild(nameHead);
    wrap.appendChild(el8("div", "la-settings-hint", "What this extension calls itself in the drawer tab + sidebar. Default: LumiAgent."));
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "la-input";
    const currentName = resolveDisplayName();
    nameInput.value = currentName.full === DEFAULT_DISPLAY_NAME ? "" : currentName.full;
    nameInput.placeholder = DEFAULT_DISPLAY_NAME;
    nameInput.maxLength = 40;
    wrap.appendChild(nameInput);
    const nameActions = el8("div", "la-icon-settings-actions");
    const nameSaveBtn = el8("button", "la-btn la-btn-primary", "Save name");
    const nameResetBtn = el8("button", "la-btn", "Reset");
    nameActions.append(nameSaveBtn, nameResetBtn);
    wrap.appendChild(nameActions);
    nameSaveBtn.addEventListener("click", () => {
      const v = nameInput.value.trim();
      try {
        if (v.length > 0)
          localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, v);
        else
          localStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
      } catch {}
      status.textContent = "Display name saved. Reload to apply.";
      status.classList.remove("is-error");
    });
    nameResetBtn.addEventListener("click", () => {
      try {
        localStorage.removeItem(DISPLAY_NAME_STORAGE_KEY);
      } catch {}
      nameInput.value = "";
      status.textContent = "Display name reset. Reload to apply.";
      status.classList.remove("is-error");
    });
    const iconHead = el8("div", "la-settings-section-head");
    iconHead.append(el8("label", "la-settings-label", "Drawer icon"));
    wrap.appendChild(iconHead);
    wrap.appendChild(el8("div", "la-settings-hint", "Replaces the icon shown in the Lumiverse sidebar."));
    const iconPreview = el8("div", "la-icon-settings-preview");
    const iconImg = document.createElement("img");
    iconImg.src = resolveDrawerIconUrl();
    iconImg.alt = "current icon";
    iconImg.className = "la-icon-settings-image";
    const iconCaption = el8("div", "la-icon-settings-caption", "Current");
    iconPreview.append(iconCaption, iconImg);
    wrap.appendChild(iconPreview);
    const iconActions = el8("div", "la-icon-settings-actions");
    const iconPickBtn = el8("button", "la-btn la-btn-primary", "Choose image...");
    const iconResetBtn = el8("button", "la-btn la-btn-danger", "Reset to default");
    iconActions.append(iconPickBtn, iconResetBtn);
    wrap.appendChild(iconActions);
    iconPickBtn.addEventListener("click", async () => {
      status.textContent = "";
      status.classList.remove("is-error");
      try {
        const files = await ctx.uploads.pickFile({
          accept: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"],
          multiple: false,
          maxSizeBytes: MAX_ICON_BYTES
        });
        if (files.length === 0)
          return;
        const file = files[0];
        if (file.sizeBytes > MAX_ICON_BYTES) {
          status.textContent = `Image too large (${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB). Max 2 MB.`;
          status.classList.add("is-error");
          return;
        }
        const dataUrl = readImageAsDataUrl(file.bytes, file.mimeType || "image/png");
        try {
          localStorage.setItem(ICON_STORAGE_KEY, dataUrl);
        } catch {}
        iconImg.src = dataUrl;
        iconCaption.textContent = "Selected (reload to apply)";
        status.textContent = "Icon saved. Reload to apply.";
      } catch (err) {
        status.textContent = `Failed: ${err.message}`;
        status.classList.add("is-error");
      }
    });
    iconResetBtn.addEventListener("click", () => {
      try {
        localStorage.removeItem(ICON_STORAGE_KEY);
      } catch {}
      iconImg.src = DEFAULT_ICON_DATA_URL;
      iconCaption.textContent = "Default (reload to apply)";
      status.textContent = "Icon reset. Reload to apply.";
      status.classList.remove("is-error");
    });
    const mouseyHead = el8("div", "la-settings-section-head");
    mouseyHead.append(el8("label", "la-settings-label", "Sitting character image"));
    wrap.appendChild(mouseyHead);
    wrap.appendChild(el8("div", "la-settings-hint", "The image perched on the composer ledge. Transparent PNG works best. For correct positioning the figure should be sitting around 2/3 of the way down the image."));
    const mouseyPreview = el8("div", "la-icon-settings-preview");
    const mouseyImgPreview = document.createElement("img");
    mouseyImgPreview.src = resolveMouseyImageUrl();
    mouseyImgPreview.alt = "current sitting image";
    mouseyImgPreview.className = "la-icon-settings-image la-icon-settings-image-tall";
    const mouseyCaption = el8("div", "la-icon-settings-caption", "Current");
    mouseyPreview.append(mouseyCaption, mouseyImgPreview);
    wrap.appendChild(mouseyPreview);
    const mouseyActions = el8("div", "la-icon-settings-actions");
    const mouseyPickBtn = el8("button", "la-btn la-btn-primary", "Choose image...");
    const mouseyResetBtn = el8("button", "la-btn la-btn-danger", "Reset to default");
    mouseyActions.append(mouseyPickBtn, mouseyResetBtn);
    wrap.appendChild(mouseyActions);
    mouseyPickBtn.addEventListener("click", async () => {
      status.textContent = "";
      status.classList.remove("is-error");
      try {
        const files = await ctx.uploads.pickFile({
          accept: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"],
          multiple: false,
          maxSizeBytes: MAX_MOUSEY_BYTES
        });
        if (files.length === 0)
          return;
        const file = files[0];
        if (file.sizeBytes > MAX_MOUSEY_BYTES) {
          status.textContent = `Image too large (${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB). Max 4 MB.`;
          status.classList.add("is-error");
          return;
        }
        const dataUrl = readImageAsDataUrl(file.bytes, file.mimeType || "image/png");
        try {
          localStorage.setItem(MOUSEY_STORAGE_KEY, dataUrl);
        } catch {}
        mouseyImgPreview.src = dataUrl;
        mouseyCaption.textContent = "Selected (reload to apply)";
        mouseyImg.src = dataUrl;
        status.textContent = "Sitting image saved. Reload to apply across the rest of the drawer.";
      } catch (err) {
        status.textContent = `Failed: ${err.message}`;
        status.classList.add("is-error");
      }
    });
    mouseyResetBtn.addEventListener("click", () => {
      try {
        localStorage.removeItem(MOUSEY_STORAGE_KEY);
      } catch {}
      mouseyImgPreview.src = MOUSEY_SITTING_DATA_URL;
      mouseyCaption.textContent = "Default (reload to apply)";
      mouseyImg.src = MOUSEY_SITTING_DATA_URL;
      status.textContent = "Sitting image reset. Reload to apply.";
      status.classList.remove("is-error");
    });
    wrap.appendChild(status);
    handle.root.appendChild(wrap);
  };
  const appendUserMessage = (text) => {
    const msg = {
      id: makeId("msg"),
      role: "user",
      ts: Date.now(),
      content: text
    };
    state.messages.push(msg);
    if (state.messages.length === 1 && thread.contains(emptyState))
      thread.removeChild(emptyState);
    virtualizer.setCount();
    virtualizer.scrollToBottom();
    return msg;
  };
  const dispatchSendForExisting = (sessionId, messageId, text) => {
    dlog("dispatchSendForExisting (LLM call)", { sessionId, messageId, textLen: text.length });
    const out = {
      type: "send_message",
      sessionId,
      userMessageId: messageId,
      content: text,
      ...state.connectionId ? { connectionId: state.connectionId } : {}
    };
    sendBackend(out);
    state.isGenerating = true;
    updateComposer();
  };
  const clearStartTimeout = () => {
    if (state.startSessionTimeout !== null) {
      clearTimeout(state.startSessionTimeout);
      state.startSessionTimeout = null;
    }
  };
  const doSend = () => {
    const text = textarea.value.trim();
    if (!state.characterId) {
      composerStatus.textContent = "Pick a character first.";
      composerStatus.classList.add("is-error");
      return;
    }
    if (state.isGenerating || state.startingSession)
      return;
    if (text.length === 0) {
      const last = state.messages[state.messages.length - 1];
      const canContinue = !!last && last.role === "user" && !!state.sessionId;
      if (!canContinue)
        return;
      composerStatus.classList.remove("is-error");
      sendBackend({
        type: "continue_session",
        sessionId: state.sessionId,
        ...state.connectionId ? { connectionId: state.connectionId } : {}
      });
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
    const startMsg = {
      type: "start_session",
      sessionId,
      characterId: state.characterId,
      ...state.connectionId ? { connectionId: state.connectionId } : {}
    };
    sendBackend(startMsg);
    clearStartTimeout();
    state.startSessionTimeout = setTimeout(() => {
      if (!state.startingSession)
        return;
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
    if (!state.sessionId)
      return;
    sendBackend({ type: "cancel_generation", sessionId: state.sessionId });
  });
  textarea.addEventListener("keydown", (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
      ev.preventDefault();
      doSend();
    }
  });
  const rollingAnchorId = () => {
    const mode = state.settings?.cacheMode ?? "full";
    if (mode !== "full")
      return null;
    const userMsgs = state.messages.filter((m) => m.role === "user");
    if (userMsgs.length <= 2)
      return null;
    return userMsgs[userMsgs.length - 1 - 2]?.id ?? null;
  };
  const isCacheInvalidating = (targetMessageId) => {
    const anchorId = rollingAnchorId();
    if (!anchorId)
      return false;
    const anchorIdx = state.messages.findIndex((m) => m.id === anchorId);
    const targetIdx = state.messages.findIndex((m) => m.id === targetMessageId);
    if (anchorIdx < 0 || targetIdx < 0)
      return false;
    return targetIdx <= anchorIdx;
  };
  const findAssistantMessageIdForCallId = (callId) => {
    for (const m of state.messages) {
      if (m.role !== "assistant")
        continue;
      for (const b of m.blocks) {
        if (b.type === "tool" && b.call_id === callId)
          return m.id;
      }
    }
    return null;
  };
  const hideLoading = () => {
    if (!state.loading)
      return;
    state.loading = false;
    state.streamingAssistant?.setLoading(false);
  };
  const startAssistantTurn = (assistantMessageId) => {
    if (state.streamingAssistant)
      return state.streamingAssistant;
    const assistant = {
      id: assistantMessageId ?? makeId("msg"),
      role: "assistant",
      ts: Date.now(),
      turn: 0,
      blocks: [],
      status: "streaming"
    };
    state.messages.push(assistant);
    state.currentAssistantMessage = assistant;
    const handle = createStreamingAssistant({
      onRevertEdit: async (editId) => {
        if (!state.characterId)
          return;
        sendBackend({ type: "revert_edit", characterId: state.characterId, editId });
      },
      onOpenDiffModal: (eid) => openDiffs(eid)
    });
    state.streamingAssistant = handle;
    virtualizer.setCount();
    virtualizer.scrollToBottom();
    handle.setLoading(true);
    state.loading = true;
    return handle;
  };
  const finalizeAssistantTurn = (status) => {
    hideLoading();
    const handle = state.streamingAssistant;
    const msg = state.currentAssistantMessage;
    if (!handle || !msg)
      return;
    handle.setStatus(status);
    msg.status = status;
    state.streamingAssistant = null;
    state.currentAssistantMessage = null;
  };
  ctx.onBackendMessage((raw) => {
    const msg = raw;
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
        for (const h of pushSessionsListeners.handlers)
          h();
        break;
      case "session_started":
        clearStartTimeout();
        dlog("session_started received", { sessionId: msg.sessionId, characterId: msg.characterId, pendingPinChatId: state.pendingPinChatId, pendingMessage: state.pendingMessage, pendingMessageId: state.pendingMessageId });
        state.sessionId = msg.sessionId;
        state.characterId = msg.characterId;
        state.characterName = msg.characterName;
        state.startingSession = false;
        persistUiPrefs();
        sendBackend({ type: "list_character_edits", characterId: msg.characterId });
        if (state.pendingPinChatId !== undefined && state.pendingPinChatId !== null) {
          dlog("session_started: flushing queued pin", { sessionId: msg.sessionId, chatId: state.pendingPinChatId });
          sendBackend({ type: "set_pinned_chat", sessionId: msg.sessionId, chatId: state.pendingPinChatId });
          state.pendingPinChatId = null;
        } else if (state.pendingPinChatId === null) {
          state.pendingPinChatId = null;
        }
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
          rerenderThread();
          updateSessionBar();
          updateComposer();
        }
        break;
      case "session_loaded":
        state.sessionId = msg.sessionId;
        state.characterId = msg.characterId;
        state.characterName = msg.characterName;
        state.messages = [...msg.messages];
        state.edits = [...msg.edits];
        if (state.characters.some((c) => c.id === msg.characterId))
          charCombo.setValue(msg.characterId, true);
        rerenderThread();
        virtualizer.scrollToBottom();
        updateSessionBar();
        updateComposer();
        persistUiPrefs();
        sendBackend({ type: "list_character_edits", characterId: msg.characterId });
        sendBackend({ type: "list_chats", characterId: msg.characterId, sessionId: msg.sessionId });
        break;
      case "session_deleted":
        if (state.sessionId === msg.sessionId) {
          state.sessionId = null;
          state.messages = [];
          state.edits = [];
          rerenderThread();
          updateSessionBar();
          updateComposer();
          persistUiPrefs();
        }
        sendBackend({ type: "list_sessions" });
        break;
      case "session_reverted":
        composerStatus.textContent = `Session reverted: ${msg.entriesRestored} entries, ${msg.scriptsRestored} scripts. ${msg.entriesFailed + msg.scriptsFailed} failed.`;
        for (const e of state.edits)
          e.reverted = true;
        rerenderThread();
        updateSessionBar();
        if (state.diffModal)
          state.diffModal.setEdits(state.edits);
        break;
      case "chat_event": {
        const ev = msg.event;
        if (ev.type === "warning") {
          break;
        }
        if (ev.type === "turn_started") {
          startAssistantTurn(ev.assistantMessageId);
          if (state.currentAssistantMessage)
            state.currentAssistantMessage.turn = ev.turn;
          break;
        }
        if (ev.type === "llm_token") {
          const h = startAssistantTurn();
          h.appendToken(ev.token);
          const a = state.currentAssistantMessage;
          const last = a.blocks[a.blocks.length - 1];
          if (last && last.type === "text")
            last.content += ev.token;
          else
            a.blocks.push({ type: "text", content: ev.token });
          break;
        }
        if (ev.type === "llm_reasoning") {
          const h = startAssistantTurn();
          h.appendReasoning(ev.token);
          const a = state.currentAssistantMessage;
          const last = a.blocks[a.blocks.length - 1];
          if (last && last.type === "reasoning")
            last.content += ev.token;
          else
            a.blocks.push({ type: "reasoning", content: ev.token });
          break;
        }
        if (ev.type === "tool_started") {
          const h = startAssistantTurn();
          h.startTool(ev.call_id, ev.name, ev.args);
          state.currentAssistantMessage?.blocks.push({ type: "tool", call_id: ev.call_id, name: ev.name, args: ev.args, edit_ids: [] });
          break;
        }
        if (ev.type === "tool_finished") {
          const h = state.streamingAssistant;
          if (h)
            h.finishTool(ev.call_id, ev.result, ev.is_error, ev.edit_ids, ev.sensitivity);
          const a = state.currentAssistantMessage;
          if (a) {
            for (const b of a.blocks) {
              if (b.type === "tool" && b.call_id === ev.call_id) {
                const tb = b;
                tb.result = ev.result;
                tb.is_error = ev.is_error;
                tb.edit_ids = [...ev.edit_ids];
                if (ev.sensitivity)
                  tb.sensitivity = ev.sensitivity;
              }
            }
          }
          break;
        }
        if (ev.type === "edit_logged") {
          state.edits.push(ev.entry);
          state.characterLedger.push(ev.entry);
          if (state.streamingAssistant)
            state.streamingAssistant.attachEdits([ev.entry]);
          if (state.diffModal)
            state.diffModal.setEdits(state.characterLedger);
          updateSessionBar();
          break;
        }
        if (ev.type === "sensitivity_override") {
          if (state.streamingAssistant)
            state.streamingAssistant.setToolSensitivity(ev.call_id, ev.sensitivity);
          for (const m of state.messages) {
            if (m.role !== "assistant")
              continue;
            for (const b of m.blocks) {
              if (b.type === "tool" && b.call_id === ev.call_id)
                b.sensitivity = ev.sensitivity;
            }
          }
          break;
        }
        if (ev.type === "turn_completed") {
          if (state.currentAssistantMessage) {
            state.currentAssistantMessage.finish_reason = ev.finish_reason;
            if (ev.usage) {
              state.currentAssistantMessage.usage = ev.usage;
              state.streamingAssistant?.setUsage(ev.usage);
            }
            if (ev.cleanedContent !== undefined) {
              const a = state.currentAssistantMessage;
              a.blocks = a.blocks.filter((b) => b.type !== "text");
              if (ev.cleanedContent.trim().length > 0) {
                a.blocks.push({ type: "text", content: ev.cleanedContent });
              }
            }
          }
          break;
        }
        if (ev.type === "paused_for_input") {
          if (ev.detail) {
            const h = state.streamingAssistant;
            if (h)
              h.addWarning(ev.detail);
            state.currentAssistantMessage?.blocks.push({ type: "warning", message: ev.detail });
          }
          finalizeAssistantTurn("complete");
          rerenderThread();
          break;
        }
        break;
      }
      case "auto_freed": {
        const notice = el8("div", "la-error-banner");
        notice.appendChild(el8("div", "la-error-banner-title", "Old tool results auto-freed"));
        notice.appendChild(el8("pre", "la-error-banner-body", `Freed ${msg.count} insensitive tool result${msg.count === 1 ? "" : "s"} (${Math.round(msg.bytes / 1024)} KB) to keep context small. Turn 'Auto-free old tool results' off in Agent Settings to disable.`));
        thread.appendChild(notice);
        setTimeout(() => notice.remove(), 8000);
        break;
      }
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
        rerenderThread();
        const errBlock = el8("div", "la-error-banner");
        const errTitle = el8("div", "la-error-banner-title", "Generation failed");
        const errBody = el8("pre", "la-error-banner-body", msg.error);
        errBlock.append(errTitle, errBody);
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
        const removed = new Set;
        let okCount = 0;
        let cascadeCount = 0;
        let failed = 0;
        for (const { editId, outcome } of msg.outcomes) {
          if (outcome.kind === "clean" || outcome.kind === "noop_already_reverted") {
            removed.add(editId);
            okCount++;
            if (outcome.kind === "clean" && outcome.cascadedEditIds) {
              for (const id of outcome.cascadedEditIds)
                removed.add(id);
              cascadeCount += outcome.cascadedEditIds.length;
            }
          } else if (outcome.kind === "failed") {
            failed++;
          }
        }
        spliceEntries(removed);
        rerenderThread();
        updateSessionBar();
        if (state.diffModal)
          state.diffModal.setEdits(state.characterLedger);
        const parts = [];
        if (okCount > 0)
          parts.push(`Reverted ${okCount} edit${okCount === 1 ? "" : "s"}`);
        if (cascadeCount > 0)
          parts.push(`+${cascadeCount} cascaded`);
        if (failed > 0)
          parts.push(`${failed} failed`);
        composerStatus.textContent = parts.join(", ");
        composerStatus.classList.toggle("is-error", failed > 0);
        break;
      }
      case "character_edits_pushed":
        state.characterLedger = [...msg.entries];
        updateSessionBar();
        if (state.diffModal)
          state.diffModal.setEdits(state.characterLedger);
        break;
      case "session_truncated":
        state.messages = [...msg.messages];
        state.edits = [...msg.edits];
        rerenderThread();
        virtualizer.scrollToBottom();
        updateSessionBar();
        updateComposer();
        if (state.characterId)
          sendBackend({ type: "list_character_edits", characterId: state.characterId });
        break;
      case "chats_pushed":
        dlog("chats_pushed received", { msgCharacterId: msg.characterId, stateCharacterId: state.characterId, pinnedChatId: msg.pinnedChatId, chatCount: msg.chats.length, applies: state.characterId === msg.characterId });
        if (state.characterId === msg.characterId) {
          state.chatsForCharacter = [...msg.chats];
          state.pinnedChatId = msg.pinnedChatId;
          chatPinBtn.classList.toggle("has-pinned", msg.pinnedChatId !== null);
          if (state.autoPinNeeded && msg.pinnedChatId === null && msg.chats.length > 0) {
            state.autoPinNeeded = false;
            const newestId = msg.chats[0].id;
            if (state.sessionId)
              sendBackend({ type: "set_pinned_chat", sessionId: state.sessionId, chatId: newestId });
            else
              state.pendingPinChatId = newestId;
          }
          for (const h of pushChatsListeners.handlers)
            h();
        }
        break;
      case "pinned_chat_set":
        dlog("pinned_chat_set received", { sessionId: msg.sessionId, chatId: msg.chatId, stateSessionId: state.sessionId, stateCharacterId: state.characterId });
        if (msg.sessionId === state.sessionId) {
          state.pinnedChatId = msg.chatId;
          chatPinBtn.classList.toggle("has-pinned", msg.chatId !== null);
        }
        if (state.characterId)
          sendBackend({ type: "list_chats", characterId: state.characterId, sessionId: msg.sessionId });
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
          connectionSupportsPromptCaching: msg.connectionSupportsPromptCaching,
          autoFreeOldToolResults: msg.autoFreeOldToolResults,
          cacheMode: msg.cacheMode
        };
        for (const h of settingsListeners.handlers)
          h();
        break;
      case "ui_prefs_pushed":
        state.connectionId = msg.connectionId;
        if (state.connections.length > 0)
          renderConnOptions();
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
          sendBackend({ type: "load_session", sessionId: msg.sessionId });
        }
        break;
      case "characters_storage_pushed":
        state.charactersPanel?.onPushed(msg.entries, msg.workspaceUsedBytes, msg.workspaceCapBytes);
        break;
      case "frontend_rpc_request": {
        (async () => {
          try {
            let result;
            if (msg.op === "translate_batch") {
              const { handleTranslateBatch: handleTranslateBatch2 } = await Promise.resolve().then(() => (init_translator_bridge(), exports_translator_bridge));
              result = await handleTranslateBatch2(msg.args);
            } else if (msg.op === "ask_user_question") {
              const { showAskUserQuestion: showAskUserQuestion2 } = await Promise.resolve().then(() => exports_ask_user_modal);
              result = await showAskUserQuestion2(msg.args);
            } else {
              sendBackend({ type: "frontend_rpc_response", rpcId: msg.rpcId, error: `unknown rpc op '${msg.op}'` });
              return;
            }
            sendBackend({ type: "frontend_rpc_response", rpcId: msg.rpcId, result });
          } catch (err) {
            sendBackend({ type: "frontend_rpc_response", rpcId: msg.rpcId, error: err.message });
          }
        })();
        break;
      }
      case "character_squashed":
        if (state.workshopFocusCharacterId === msg.characterId) {
          state.workshopFocusCharacterId = null;
          state.workshopFocusCharacterName = null;
        }
        if (state.characterId === msg.characterId) {
          state.characterLedger = [];
          state.edits = state.edits.map((e) => ({ ...e, reverted: true }));
          rerenderThread();
          updateSessionBar();
        }
        break;
    }
  });
  rerenderThread();
  updateSessionBar();
  updateComposer();
  refreshLists();
  const adoptActiveChat = () => {
    if (state.sessionId || state.startingSession)
      return;
    const active = ctx.getActiveChat();
    if (!active.characterId)
      return;
    if (state.characterId === active.characterId)
      return;
    state.characterId = active.characterId;
    charCombo.setValue(active.characterId, true);
    state.characterLedger = [];
    updateSessionBar();
    updateComposer();
    sendBackend({ type: "list_character_edits", characterId: active.characterId });
  };
  adoptActiveChat();
  const offChatSwitched = ctx.events.on("CHAT_SWITCHED", () => adoptActiveChat());
  const off = tab.onActivate(() => {
    refreshLists();
    adoptActiveChat();
    if (state.sessionId)
      sendBackend({ type: "load_session", sessionId: state.sessionId });
    else if (state.characterId)
      sendBackend({ type: "list_character_edits", characterId: state.characterId });
  });
  return () => {
    off();
    offChatSwitched();
    charCombo.destroy();
    removeStyle();
    tab.destroy();
  };
}

// src/frontend.ts
function setup(ctx) {
  mountDrawer(ctx);
}
export {
  setup
};
