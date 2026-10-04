import { IntentTextSchema, type Execution } from "@9oob/schema";

import { requestListeners as listeners } from "./transport/events.js";

export const noob = {
  run(intent: string): Promise<Execution> {
    const parsed = IntentTextSchema.safeParse(intent);
    if (!parsed.success) return Promise.reject(new Error("Intent must contain 1 to 2,000 characters"));
    const value = parsed.data;
    if (listeners.size === 0) return Promise.reject(new Error("Mount <NoobProvider> before calling noob.run()"));
    if (listeners.size !== 1)
      return Promise.reject(new Error("Mount exactly one <NoobProvider> before calling noob.run()"));
    return new Promise((resolve, reject) => {
      try {
        [...listeners][0]({ intent: value, resolve, reject });
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Could not start the 9oob execution"));
      }
    });
  },
};
