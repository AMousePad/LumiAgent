import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { mountDrawer } from "./ui/drawer";

export function setup(ctx: SpindleFrontendContext): void {
  mountDrawer(ctx);
}
