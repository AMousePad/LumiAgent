import { domToCanvas } from "modern-screenshot";

export interface UiCaptureInput {
  selector?: string;
  max_edge?: number;
}

const EMPTY_IMAGE =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
const PRIVATE =
  "[data-private], [data-capture-exclude], [data-lumiagent-capture-exclude]";
let capturing = false;

export async function captureUi(
  input: UiCaptureInput,
  signal: AbortSignal,
): Promise<{
  base64: string;
  mime_type: string;
  width: number;
  height: number;
  method: "rendered_ui";
  warnings: string[];
}> {
  signal.throwIfAborted();
  if (capturing) throw new Error("A UI capture is already running.");
  if (document.visibilityState === "hidden")
    throw new Error(
      "The originating Lumiverse tab is hidden. Bring it into view and retry.",
    );
  const viewportWidth = Math.round(window.innerWidth),
    viewportHeight = Math.round(window.innerHeight);
  if (!viewportWidth || !viewportHeight)
    throw new Error("The originating tab has no visible viewport.");
  const maxEdge = input.max_edge ?? 1600;
  if (!Number.isInteger(maxEdge) || maxEdge < 512 || maxEdge > 2048)
    throw new Error("max_edge must be between 512 and 2048.");
  let crop = { x: 0, y: 0, width: viewportWidth, height: viewportHeight };
  if (input.selector) {
    if (input.selector.length > 1000)
      throw new Error("Capture selector is too long.");
    const nodes = document.querySelectorAll(input.selector);
    if (nodes.length !== 1)
      throw new Error(
        `Capture selector must match one element, found ${nodes.length}.`,
      );
    const node = nodes[0]!;
    if (node.closest(PRIVATE))
      throw new Error("This element is excluded from UI captures.");
    const rect = node.getBoundingClientRect();
    const x = Math.max(0, rect.x),
      y = Math.max(0, rect.y);
    crop = {
      x,
      y,
      width: Math.min(viewportWidth, rect.right) - x,
      height: Math.min(viewportHeight, rect.bottom) - y,
    };
    if (crop.width <= 0 || crop.height <= 0)
      throw new Error(
        "The selected element is outside the visible viewport. Open it before capturing.",
      );
  }
  const warnings = new Set([
    "Rendered UI snapshot, not native screen pixels. Backdrop blur, embedded frames, video and cross-origin resources may differ or be omitted.",
  ]);
  const scale = Math.min(1, maxEdge / Math.max(viewportWidth, viewportHeight));
  const backgroundColor =
    [document.body, document.documentElement]
      .map((node) => getComputedStyle(node).backgroundColor)
      .find(
        (color) => color !== "transparent" && color !== "rgba(0, 0, 0, 0)",
      ) ?? "#fff";
  capturing = true;
  try {
    const canvas = await domToCanvas(document.documentElement, {
      width: viewportWidth,
      height: viewportHeight,
      scale,
      maximumCanvasSize: 2048,
      backgroundColor,
      timeout: 5000,
      features: { restoreScrollPosition: true },
      fetch: { requestInit: { credentials: "same-origin", signal } },
      fetchFn: async (value) => {
        signal.throwIfAborted();
        const url = new URL(value, location.href);
        if (
          url.protocol === "data:" ||
          url.protocol === "blob:" ||
          url.origin === location.origin
        )
          return false;
        warnings.add("Cross-origin images or fonts were omitted.");
        return EMPTY_IMAGE;
      },
      filter: (node) =>
        !(
          node instanceof Element &&
          node.matches("script, iframe, video, audio")
        ),
      onCloneEachNode: (node) => {
        signal.throwIfAborted();
        if (!(node instanceof Element)) return;
        if (node.matches(PRIVATE) && node instanceof HTMLElement)
          node.style.setProperty('opacity', '0', 'important');
        if (
          node instanceof HTMLInputElement &&
          (node.type === "password" ||
            /password|secret|api.?key|access.?token/i.test(
              [node.name, node.id, node.autocomplete].join(" "),
            ))
        ) {
          node.value = "";
          node.setAttribute("value", "");
          node.placeholder = "[hidden]";
        }
      },
    });
    signal.throwIfAborted();
    const output = document.createElement("canvas");
    output.width = Math.max(1, Math.round(crop.width * scale));
    output.height = Math.max(1, Math.round(crop.height * scale));
    const context = output.getContext("2d");
    if (!context)
      throw new Error(
        "Canvas rendering is unavailable. Attach a screenshot instead.",
      );
    context.drawImage(
      canvas,
      crop.x * scale,
      crop.y * scale,
      crop.width * scale,
      crop.height * scale,
      0,
      0,
      output.width,
      output.height,
    );
    let data = "";
    for (const quality of [0.9, 0.75, 0.55]) {
      data = output.toDataURL("image/jpeg", quality).split(",")[1] ?? "";
      if (data.length <= 2_000_000) break;
    }
    if (!data || data.length > 2_000_000)
      throw new Error(
        "UI capture is too large. Capture a smaller selector or reduce max_edge.",
      );
    signal.throwIfAborted();
    return {
      base64: data,
      mime_type: "image/jpeg",
      width: output.width,
      height: output.height,
      method: "rendered_ui",
      warnings: [...warnings],
    };
  } finally {
    capturing = false;
  }
}
