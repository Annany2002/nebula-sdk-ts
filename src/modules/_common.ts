// src/modules/_common.ts
// Define a common context type to avoid repetition
import { NebulaClientConfig } from "../types";

/** Internal context passed from NebulaClient to modules */
export interface ModuleContext {
  config: Required<NebulaClientConfig>;
  getAuthToken: () => string | null;
}
