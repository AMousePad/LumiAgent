import { Upload } from "tus-js-client";

export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

export function uploadFile(
  file: File,
  options: {
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
    onDiscard: (uploadId: string) => void;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const uploadId = (): string | undefined => {
      if (!upload.url) return undefined;
      const url = new URL(upload.url, location.href);
      if (url.origin !== location.origin) return undefined;
      return /^\/api\/v1\/spindle-uploads\/([a-zA-Z0-9-]+)$/.exec(url.pathname)?.[1];
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", cancel);
      const id = uploadId();
      if (error || !id) {
        try { if (id) options.onDiscard(id); }
        finally { reject(error ?? new Error("Upload returned an invalid file reference")); }
      } else resolve(id);
    };
    const upload = new Upload(file, {
      endpoint: "/api/v1/spindle-uploads",
      chunkSize: UPLOAD_CHUNK_BYTES,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      // Session cookies can change between page loads, so resume only within this operation.
      storeFingerprintForResuming: false,
      metadata: { extension: "lumiagent", filename: file.name, spindle_read_mode: "chunked" },
      onBeforeRequest: (request) => {
        const url = new URL(request.getURL(), location.href);
        if (url.origin !== location.origin || !url.pathname.startsWith("/api/v1/spindle-uploads")) {
          throw new Error("Upload destination must be on this Lumiverse host");
        }
        request.getUnderlyingObject().withCredentials = true;
      },
      onProgress: (sent, total) => options.onProgress?.(total === 0 ? 1 : sent / total),
      onError: (error) => finish(error),
      onSuccess: () => finish(),
    });
    const cancel = (): void => {
      void upload.abort().then(
        () => finish(new DOMException("Upload cancelled", "AbortError")),
        (error: Error) => finish(error),
      );
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    else upload.start();
  });
}
