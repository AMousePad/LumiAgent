// Mousey's onboarding tour, staged as a visual novel: the user hired her and
// this is her first shift in the workshop. Speech, asterisked thoughts,
// narration, and sound effects are separate line kinds so the engine can
// style them like a VN dialogue box. Five quizzes play as choice menus.
// Anchors name data-tut ids on real drawer controls; the engine spotlights
// them through the dimmed overlay.

export type VnLineKind = "speech" | "thought" | "prose" | "sfx";

// Sprite set slugs; one webp each under assets/branding/expressions. The -2
// entries are pose variations: happy/excited-2 are finger-raised teaching
// poses (the originals wave / clench fists), determined is the podium point,
// determined-2 the finger-raised lecture.
export type MouseyExpression =
  | "neutral" | "happy" | "happy-2" | "excited" | "excited-2"
  | "embarrassed" | "nervous" | "dizzy" | "deadpan" | "devastated"
  | "smug" | "determined" | "determined-2" | "wince" | "shifty" | "pleading"
  | "scared" | "mischief" | "soft"
  // Intro prop, not a face: the shaking box she bursts out of (via poof.gif).
  | "cardboard";

export interface VnLine {
  readonly kind: VnLineKind;
  readonly text: string;
  // Sprite swap when this line reveals; carries over until the next change.
  readonly expr?: MouseyExpression;
  // One-shot sprite stunt fired when this line reveals.
  readonly anim?: "fall";
}

const s = (text: string, expr?: MouseyExpression): VnLine => ({ kind: "speech", text, ...(expr ? { expr } : {}) });
const t = (text: string, expr?: MouseyExpression): VnLine => ({ kind: "thought", text, ...(expr ? { expr } : {}) });
const p = (text: string, expr?: MouseyExpression): VnLine => ({ kind: "prose", text, ...(expr ? { expr } : {}) });
const fx = (text: string, expr?: MouseyExpression, anim?: "fall"): VnLine => ({ kind: "sfx", text, ...(expr ? { expr } : {}), ...(anim ? { anim } : {}) });

export interface TutQuizOption {
  readonly text: string;
  readonly correct?: boolean;
}

interface TutStepBase {
  // data-tut id of the drawer control to spotlight. Omit for a plain card.
  readonly anchor?: string;
}

export interface TutSayStep extends TutStepBase {
  readonly kind: "say";
  readonly lines: readonly VnLine[];
}

export interface TutQuizStep extends TutStepBase {
  readonly kind: "quiz";
  readonly id: string;
  // Flavor plus the question itself, ending on the question speech line.
  readonly lines: readonly VnLine[];
  readonly options: readonly TutQuizOption[];
  // Her explanation after answering, right or wrong.
  readonly why: string;
}

export type TutStep = TutSayStep | TutQuizStep;

// Reaction beats the engine plays before the why line.
export const VERDICT_RIGHT: readonly VnLine[] = [fx("*happy tail flick!*", "happy"), s("Correct! Ehehe~", "happy")];
export const VERDICT_WRONG: readonly VnLine[] = [fx("*squeak.*", "devastated"), s("N-not quite...", "devastated")];

export const TUTORIAL_STEPS: readonly TutStep[] = [
  {
    kind: "say",
    lines: [
      p("The drawer slides open. Something small is already inside, wrestling a giant stack of index cards.", "cardboard"),
      fx("*fwump. fwumpfwump.*", "cardboard"),
      s("Wah!! ...O-oh. You're here! H-hello! I'm Mousey, your new workshop assistant. T-This is my first shift, I'm very qualified. Please ignore the cards.", "dizzy"),
      t("Smooth, Mousey. Very smooth.", "devastated"),
    ],
  },
  {
    kind: "say",
    lines: [
      p("She dusts herself off and starts flipping through the fallen cards, sorting as she goes. You see a scandalous looking greeting, and lorebook entry that just says 'cat??'.", "excited"),
      s("Ohhh, there's so much to DO here. Ehehe~", "excited"),
      s("Ahem. So I'm your new assistant. You did read my resume before hiring me, right?", "smug"),
      t("They didn't read the resume.", "deadpan"),
      s("This.. \"manual\" says orientation comes first, though! I also have questions for you. It's not a test! ...Okay. It's a tiny test.", "soft"),
    ],
  },

  // ── picking who and what she works on ──
  {
    kind: "say",
    anchor: "char-row",
    lines: [
      p("She scampers up to the header and pats the dropdown, proudly.", "smug"),
      s("So I'm an assistant you can talk with! This picks which character card I'm reading. And the little pin next to it picks which chat I'm allowed to read, so when you say 'this chat', I don't need to dig through your chat list.", "happy-2"),
      t("Guessing wrong would be SO embarrassing. ...It seems you have... interesting chats.", "shifty"),
    ],
  },
  {
    kind: "quiz",
    id: "q_focus",
    anchor: "char-row",
    lines: [
      p("She flips the clipboard around. It's slightly too big for her.", "smug"),
      s("Question one! You want me to add a greeting in your weird chat with \"Seraphina\". What do you set up first?", "smug"),
    ],
    options: [
      { text: "Pick \"Seraphina\" in the dropdown and pin that chat", correct: true },
      { text: "Nothing, she can smell which chat you mean" },
      { text: "Paste the whole chat into the message box" },
      { text: "Rename the chat to 'the weird one' so she can find it" },
    ],
    why: "I teeechnically don't need you to select character or chat, but I'll have to use some tokens to find them. It's better if you pin them instead!.",
  },
  {
    kind: "say",
    anchor: "conn",
    lines: [
      p("She hops down toward the connection picker and lands on her face."),
      fx("*thump.*", "dizzy"),
      s("AH FUCK", "dizzy"),
      s("Ahaha! I'm okay!", "soft"),
      s("This is where you pick my model. Get me a strong one with a big memory, 256k context or more is comfy. A small context forgets what it's doing, and then we're both sad.", "happy-2"),
    ],
  },
  {
    kind: "say",
    anchor: "sessions",
    lines: [
      s("Conversations with me are \"sessions\"! Find sessions with the list button, and make new sessions with the plus button.", "happy"),
      t("I'll be their ChatGPT!", "happy"),
    ],
  },

  // ── talking to her ──
  {
    kind: "say",
    anchor: "composer",
    lines: [
      s("And you talk to me riiight down here!", "happy"),
    ],
  },
  {
    kind: "say",
    anchor: "composer",
    lines: [
      p("She straightens up. This is clearly the part she rehearsed in the mirror.", "determined-2"),
      fx("*BAM!*", "determined"),
      p("A tiny hand slams the desk. Then points across the room."),
      s("Important! Words are cheap so I don't use words! No words! I change your things with 🌟tools🌟. And after I use those tools, it leaves a changelog in the \"Workshop\"!", "determined"),
    ],
  },
  // ── the workshop ──
  {
    kind: "say",
    anchor: "workshop",
    lines: [
      s("This button is the Workshop! Everything I change lands there as a little before-and-after card, old text and new text side by side. You can undo one card, or a whole session in one go. So even if I trip...", "happy-2"),
      fx("*wobble... wobble...AAAA*", "nervous", "fall"),
      s("...nothing breaks forever. It's mouse-proofed. I checked just now.", "smug"),
    ],
  },
  {
    kind: "quiz",
    id: "q_tools",
    anchor: "workshop",
    lines: [
      s("Question two! I say 'Done! I rewrote the greeting~', where do you see the change?", "smug"),
    ],
    options: [
      { text: "In the Workshop!", correct: true },
      { text: "No one will ever know." },
      { text: "Ask the discord." },
      { text: "She is lying." },
    ],
    why: "All my edits leave revertable changelogs in the Workshop!",
  },
  {
    kind: "quiz",
    id: "q_revert",
    anchor: "workshop",
    lines: [
      s("Question three! Let's say I made five edits. Four are great, one is a crime against humanity. What do you do?", "smug"),
    ],
    options: [
      { text: "Open the Workshop and revert that edit", correct: true },
      { text: "Delete the session, that undoes everything" },
      { text: "Demand an apology in chat, passionately cussing her out" },
      { text: "Smash your keyboard" },
    ],
    why: "You should know better than to get mad.",
  },
  {
    kind: "say",
    anchor: "workshop",
    lines: [
      s("The Workshop also has a Files tab. That's my own filesystem! Drop things in for me to read, and whatever I make, drafts, exports, image gens, will go there too.", "happy"),
      s("My own manuals live in there too, under docs. I read them.", "smug"),
      t("Most of them.", "shifty"),
      s("All of them!", "determined-2"),
    ],
  },

  // ── while she works ──
  {
    kind: "say",
    anchor: "composer",
    lines: [
      s("You want to be OPTIMAL?? You can steer me or queue messages! Send me a message when I'm working to steer!", "excited-2"),
      t("Mwahaha I stole this from OpenAI Codex.", "mischief"),
    ],
  },
  {
    kind: "say",
    anchor: "compact",
    lines: [
      s("This ring is my memory filling up as we talk. When it gets full I compact everything. You can click it to compact early."),
      s("It's fine! Probably. But avoid it when you can!", "determined-2"),
    ],
  },

  // ── remembering things ──
  {
    kind: "say",
    anchor: "settings",
    lines: [
      p("She taps the side of her head, then nearly drops the clipboard."),
      fx("*fumble... caught it!*", "dizzy"),
      s("I keep a notes file called agent.md, in my Files tab or through this settings gear. I read it at the start of every session. So... don't put a anything bad in there.", "neutral"),
    ],
  },
  {
    kind: "quiz",
    id: "q_notes",
    anchor: "settings",
    lines: [
      s("Question four! You want me to ALWAYS write dialogue in British English, in every future session. Where do you put it?", "smug"),
    ],
    options: [
      { text: "In agent.md, her notes file", correct: true },
      { text: "Say it once in chat and trust her to remember" },
      { text: "You request it as a feature to amousepad" },
      { text: "You yell loudly at your computer" },
    ],
    why: "You can edit agent.md, OR you can tell me to edit it instead!",
  },

  // ── making her yours ──
  {
    kind: "say",
    anchor: "settings",
    lines: [
      p("She fidgets with the hem of her sleeve.", "embarrassed"),
      s("The gear also holds a Persona box. That's... me. Who I am. And a System prompt body, which is how I work. You can rewrite either one. Even the mousegirl part.", "embarrassed"),
      s("...", "pleading"),
    ],
  },
  {
    kind: "quiz",
    id: "q_persona",
    anchor: "settings",
    lines: [
      s("Ahem anyway, question five! Last one! You'd rather have a devilish, ELDRICH-looking entity named Gabriel instead of me. Where do you change that?", "embarrassed"),
    ],
    options: [
      { text: "The settings gear, in the Persona box", correct: true },
      { text: "In agent.md, the notes file" },
      { text: "In the character card" },
      { text: "You can't. Mousey is forever" },
    ],
    why: "...'Mousey is forever' was emotionally correct, though.",
  },
  {
    kind: "say",
    anchor: "settings",
    lines: [
      s("There's a more options in settings: an approval modal, speed and memory limits, TPM or RPM limits, and a reasoning effort.", "neutral"),
    ],
  },

  // ── comfort ──
  {
    kind: "say",
    anchor: "expand",
    lines: [
      s("Feeling cramped? This arrow makes the drawer fullscreen! Esc puts it back. I fit either way.", "happy-2"),
      s("I'm a mouse.", "happy-2"),
    ],
  },
  {
    kind: "say",
    lines: [
      p("She hops onto the desk. The checklist is, at last, fully crossed out.", "soft"),
      s("That's all! If you're ever lost, just ask me. 'What can you do?', 'Why did that break?', 'Please change the CSS of LumiRealm into SillyTavern' I have access to docs, and explaining things is half my job~", "soft"),
    ],
  },
];

export function tutorialQuizCount(): number {
  return TUTORIAL_STEPS.filter((st) => st.kind === "quiz").length;
}

// Finale scene by score. Dry, but encouraging. Mostly dry.
export function tutorialFinale(score: number, total: number): readonly VnLine[] {
  if (score >= total) {
    return [
      p("She stares at the clipboard. Then at you. Then back at the clipboard.", "deadpan"),
      fx("*scribble scribble scribble*", "deadpan"),
      s(`${score} out of ${total}. A PERFECT score! I'm putting a gold star on your file. You may now operate the mouse~`, "excited"),
      p("She walks away giggling manically.", "mischief"),
      fx("mwahaha MWAHHAHA", "mischief"),
    ];
  }
  if (score >= total - 2) {
    return [
      p("She stares at the clipboard. Then at you. Then back at the clipboard.", "deadpan"),
      s(`${score} out of ${total}. W-we'll call that a warm-up lap! If you ever need a reminder, you can find me in the 3 dots menu thing at the top.`, "soft"),
      p("She looks at you with an unreadable expression, and leaves.", "soft")
    ];
  }
  return [
    p("She looks at the clipboard for a long moment, then quietly turns it face-down.", "deadpan"),
    t("You'll be fine. Probably. I'll be here.", "deadpan"),
    fx("*pat pat*", "deadpan"),
    p("She gives you a reassuring pat.", "deadpan"),
  ];
}
