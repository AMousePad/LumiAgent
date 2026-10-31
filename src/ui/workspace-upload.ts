import { createUuid } from "./uuid";
import type { FrontendToBackend } from "../types";
import { uploadFile } from "./staged-upload";

export class WorkspaceUploads {
  private readonly active = new Set<AbortController>();
  private readonly pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();

  constructor(private readonly send: (message: FrontendToBackend) => void) {}

  complete(transferId: string, error?: string): void {
    const pending = this.pending.get(transferId);
    if (!pending) return;
    this.pending.delete(transferId);
    if (error) pending.reject(new Error(error));
    else pending.resolve();
  }

  dispose(): void {
    for (const controller of this.active) controller.abort();
    for (const id of this.pending.keys()) this.complete(id, "Upload interrupted: view closed");
  }

  async upload(file: File, path: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    this.active.add(controller);
    try {
      const uploadId = await uploadFile(file, {
        signal: controller.signal,
        onProgress: fraction => onProgress?.(fraction * 0.95),
        onDiscard: uploadId => this.send({ type: "ws_upload_discard", uploadId }),
      });
      if (controller.signal.aborted) {
        this.send({ type: "ws_upload_discard", uploadId });
        throw new DOMException("Upload cancelled", "AbortError");
      }
      const transferId = createUuid();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => this.complete(transferId, "Saving the upload timed out. Check the workspace before retrying."), 30 * 60_000);
        this.pending.set(transferId, {
          resolve: () => { clearTimeout(timer); resolve(); },
          reject: error => { clearTimeout(timer); reject(error); },
        });
        try { this.send({ type: "ws_upload_staged", transferId, path, uploadId }); }
        catch (error) {
          this.complete(transferId, (error as Error).message);
          this.send({ type: "ws_upload_discard", uploadId });
        }
      });
      onProgress?.(1);
    } finally {
      signal?.removeEventListener("abort", cancel);
      this.active.delete(controller);
    }
  }
}
