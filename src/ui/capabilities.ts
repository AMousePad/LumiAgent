import type { SpindleFrontendContext } from "lumiverse-spindle-types";

// The full "what can I actually do" catalog in Mousey's voice. One modal,
// opened from the ⋯ menu and from every tutorial card, so the answer to
// "can you do X?" never requires the docs. (R) = read, (W) = read and write.

interface CapItem {
  readonly rw: "R" | "W";
  readonly text: string;
}

interface CapSection {
  readonly title: string;
  readonly items: readonly CapItem[];
}

const SECTIONS: readonly CapSection[] = [
  {
    title: "On the character card",
    items: [
      { rw: "W", text: "Every text field on the card: name, description, personality, scenario, first message, every alternate greeting, system prompt, post-history instructions, message examples." },
      { rw: "W", text: "Alternate versions of the description, personality, and scenario, the ones you pick per chat." },
      { rw: "W", text: "The tags on any card: view, search, add, remove, replace. In bulk, if you're feeling dramatic." },
      { rw: "W", text: "Every world book attached, every entry inside, all the keys and priorities and settings." },
      { rw: "W", text: "Every regex script attached, what they match and what they swap in." },
      { rw: "W", text: "The hidden RisuAI data on cards imported through LumiRealm: triggers, Lua scripts, background HTML, default variables, the original Risu payload from before translation." },
      { rw: "W", text: "Every LumiRealm module attached to the character, with its own lorebook, regex, triggers, Lua, background HTML, and default state." },
      { rw: "W", text: "Whole new cards! Give me an idea, a chat, or a template, and I'll build the card, greetings and lorebooks and all. (There's no delete tool. On purpose.)" },
      { rw: "W", text: "Card avatars and character galleries, fed by my image generation." },
    ],
  },
  {
    title: "On your chats",
    items: [
      { rw: "W", text: "Your pinned chat, every message, every swipe, hidden ones too, reasoning blocks, the whole history." },
      { rw: "W", text: "Any other chat you point me at, the same way. Sessions aren't chained to one character." },
      { rw: "W", text: "Group chats: finding them, searching their history, shared lorebooks, statistics, editing messages." },
      { rw: "W", text: "Which lorebooks a chat has attached, and where any lorebook is attached from." },
      { rw: "W", text: "Chat variables, local variables, and your global variables. Reading AND setting." },
      { rw: "W", text: "Forks: split a chat into a new timeline, even restore pre-compaction history from the fork point." },
      { rw: "R", text: "The memory chunks your chat would pull up to inform a reply." },
    ],
  },
  {
    title: "On the prompt going to the model",
    items: [
      { rw: "R", text: "The full assembled prompt that would be sent to the LLM right now." },
      { rw: "R", text: "Which lorebook entries would actually activate for the next reply, and why." },
      { rw: "R", text: "Which regex scripts would actually fire on the response." },
      { rw: "R", text: "Macro resolution! I can run {{user}}, {{char}}, time, random, dice, anything custom, against any chat or character, without writing anything anywhere." },
      { rw: "R", text: "Token counts for any text, any chat, against the model you're using." },
    ],
  },
  {
    title: "On your wider Lumiverse setup",
    items: [
      { rw: "W", text: "Your personas: read every one, edit names, titles, descriptions, their world books and add-on blocks, create new ones, and switch which is active." },
      { rw: "W", text: "Your prompt presets: full create, edit, and delete. Blocks, order, parameters, everything." },
      { rw: "W", text: "Your databanks: new banks and documents, global, per-character, or per-chat." },
      { rw: "W", text: "Your theme: restyle the whole app in one go, savable and revertable, or author full theme packs (global CSS plus per-component styling) into your theme library, styled against the real component catalog." },
      { rw: "W", text: "The Memory Cortex: curate entities and facts, pin the important ones, retire the wrong ones." },
      { rw: "W", text: "My own macros: I can mint {{lumiagent::...}} macros holding anything, for your prompts or wherever else." },
      { rw: "W", text: "Images: generate with your configured image provider, save to the workspace, tag into a gallery, or set as an avatar." },
      { rw: "W", text: "Your screen, politely: I can navigate the UI to the tab we're talking about, and send a device push when a long job finishes while you're away." },
      { rw: "R", text: "The web, if you've set up search: web search and page fetch, savable straight into my workspace." },
      { rw: "R", text: "All your connection profiles: the provider, the model, default settings. (Your API keys stay encrypted, I never see those~)" },
      { rw: "R", text: "Reusable global add-on blocks, the Lumiverse version, your current theme, your active chat, your account role." },
    ],
  },
  {
    title: "In my house",
    items: [
      { rw: "W", text: "My workspace: upload files for me with the 📎 button, edit and download what I make. It persists, so future sessions can pick things right back up." },
      { rw: "W", text: "A scratch area where big tool outputs spill so I can grep through them without melting my brain." },
      { rw: "W", text: "My custom tool recipes, little reusable workflows I or you can save." },
      { rw: "W", text: "My long-term notes about you, so I remember what you like across conversations." },
      { rw: "R", text: "Images you attach: vision-capable models let me actually look at them." },
    ],
  },
];

const EXAMPLES: readonly string[] = [
  "Translate a card's greetings/UI panels.",
  "Add lorebook entries of chat history, and characters.",
  "Explain/edit/update the lorebook.",
  "Upload anything to my workspace and get me to work with it, including using it to do anything on this list.",
  "Explain/edit regex, system/post-history prompts, any RisuAI field from LumiRealm, and more.",
  "Be a character creator! Just give me a template character.",
  "Modify chat history to remove any bad patterns.",
  "Fix bad things about the chat, or help diagnose issues on why things are broken.",
  "Change genders/sexes of characters in the story, or modify their personas.",
  "Change my personality in the settings... if you don't like it (╥﹏╥)",
  "Modify or help update/merge a preset!",
  "Redecorate Lumiverse: ask for a whole theme and I'll write it. You can always revert it~",
  "Generate images for a character's gallery, or a new avatar.",
];

const WIP: readonly string[] = ["MCP", "Dreamweaver"];

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function openCapabilitiesModal(ctx: SpindleFrontendContext, mouseyUrl: string): void {
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 900;
  const handle = ctx.ui.showModal({
    title: "Mousey's resume",
    width: Math.max(420, Math.min(Math.floor(viewportW * 0.9), 760)),
    maxHeight: 860,
  });
  const wrap = el("div", "la-caps");

  const hero = el("div", "la-caps-hero");
  const avatar = document.createElement("img");
  avatar.className = "la-caps-avatar";
  avatar.src = mouseyUrl;
  avatar.alt = "";
  avatar.setAttribute("aria-hidden", "true");
  const heroText = el("div", "la-caps-hero-text");
  heroText.appendChild(el("div", "la-caps-hero-title", "How much can I actually access?"));
  heroText.appendChild(el("div", "la-caps-hero-sub", "A lot~ ( ꈍ◡ꈍ) Here's the list so you know what to ask me about. As submitted with my job application. Every word is true!"));
  const legend = el("div", "la-caps-legend");
  const legR = el("span", "la-caps-chip is-r", "R");
  const legW = el("span", "la-caps-chip is-w", "W");
  legend.append(legR, el("span", "la-caps-legend-label", "I can read it"), legW, el("span", "la-caps-legend-label", "I can write to it too"));
  heroText.appendChild(legend);
  hero.append(avatar, heroText);
  wrap.appendChild(hero);

  for (const section of SECTIONS) {
    const sec = el("div", "la-caps-section");
    sec.appendChild(el("div", "la-caps-section-title", `✧ ${section.title}`));
    const list = el("ul", "la-caps-list");
    for (const item of section.items) {
      const li = el("li", "la-caps-item");
      li.appendChild(el("span", `la-caps-chip ${item.rw === "W" ? "is-w" : "is-r"}`, item.rw));
      li.appendChild(el("span", "la-caps-item-text", item.text));
      list.appendChild(li);
    }
    sec.appendChild(list);
    wrap.appendChild(sec);
  }

  const powahh = el("div", "la-caps-section la-caps-powahh");
  powahh.appendChild(el("div", "la-caps-section-title", "Examples of my powahh ⎛⎝( ` ᢍ ´ )⎠⎞ᵐᵘʰᵃʰᵃ"));
  powahh.appendChild(el("div", "la-caps-powahh-sub", "You can get me to:"));
  const ol = el("ol", "la-caps-examples");
  for (const ex of EXAMPLES) ol.appendChild(el("li", "la-caps-example", ex));
  powahh.appendChild(ol);
  wrap.appendChild(powahh);

  const wip = el("div", "la-caps-wip");
  wip.appendChild(el("span", "la-caps-wip-label", "Still in the oven (WIP):"));
  for (const w of WIP) wip.appendChild(el("span", "la-caps-wip-chip", w));
  wrap.appendChild(wip);

  handle.root.appendChild(wrap);
}
