// Browser-side image downscaling for chat attachments. CC resizes with native
// `sharp`; the worker sandbox forbids native modules, so the pixel work runs in
// the browser via Canvas. Same shape as CC's readImage ladder (keep the
// original when it fits, else resize then a JPEG quality ladder), but the
// per-image budget is tighter because each image rides inline in one WS frame
// (4 MB cap, quirk #6), not CC's 5 MB API limit.

// Resized image bytes ready to upload. Not a MessageImage (which is a path ref):
// this carries the base64 the frontend ships once on send_message.
export interface ResizedImage {
  readonly data: string;
  readonly mime_type: string;
}

export const MAX_IMAGES = 4;
const MAX_EDGE = 1568;
// base64 char budget per image. 4 x this stays under the 4 MB frame with room
// for text. base64 length approximates the on-wire byte count.
const MAX_B64_PER_IMAGE = 700_000;
const SUPPORTED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function isSupportedImage(type: string): boolean {
  return SUPPORTED.has(type);
}

function canvasToBase64(canvas: HTMLCanvasElement, mime: string, quality?: number): string {
  const url = canvas.toDataURL(mime, quality);
  const comma = url.indexOf(",");
  return comma >= 0 ? url.slice(comma + 1) : "";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]!);
  return btoa(binary);
}

function drawScaled(bitmap: ImageBitmap, edge: number): HTMLCanvasElement {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const cx = canvas.getContext("2d");
  if (!cx) throw new Error("2D canvas context unavailable");
  cx.drawImage(bitmap, 0, 0, w, h);
  return canvas;
}

// Resize a base64 image (used by the backend view_image tool over the
// callFrontend RPC, since the worker sandbox can't run image libraries).
export async function resizeBase64(data: string, mimeType: string): Promise<ResizedImage> {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return resizeBlob(new Blob([bytes], { type: mimeType || "image/png" }));
}

// Resize/recompress one image blob into an inline-safe ResizedImage. Throws if
// the type is unsupported or the image can't be decoded.
export async function resizeBlob(blob: Blob): Promise<ResizedImage> {
  const type = blob.type || "image/png";
  if (!isSupportedImage(type)) throw new Error(`Unsupported image type: ${type || "unknown"}`);

  // Keep the original bytes when it already fits and isn't huge: preserves
  // crispness for screenshots of text (the likely attachment).
  if (blob.size <= MAX_B64_PER_IMAGE * 0.7) {
    const data = await blobToBase64(blob);
    if (data.length <= MAX_B64_PER_IMAGE) return { data, mime_type: type };
  }

  const bitmap = await createImageBitmap(blob);
  try {
    for (const edge of [MAX_EDGE, 1000, 700]) {
      const canvas = drawScaled(bitmap, edge);
      for (const q of [0.85, 0.7, 0.55, 0.4]) {
        const data = canvasToBase64(canvas, "image/jpeg", q);
        if (data.length > 0 && data.length <= MAX_B64_PER_IMAGE) {
          return { data, mime_type: "image/jpeg" };
        }
      }
    }
    // Floor: smallest edge, lowest quality, accept whatever it produces.
    const data = canvasToBase64(drawScaled(bitmap, 512), "image/jpeg", 0.3);
    if (!data) throw new Error("Image encoding failed");
    return { data, mime_type: "image/jpeg" };
  } finally {
    bitmap.close();
  }
}
