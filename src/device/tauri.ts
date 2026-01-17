import { invoke, isTauri } from "@tauri-apps/api/core";

const POSTURE_TYPE_COMMAND = "read_posture_type";
const POLL_INTERVAL_MS = 500;

let lastPostureType = "unknown";
let lastPosturePollMs = -Infinity;
let posturePollInFlight = false;

const nowMs = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

export function getTauriPostureType(): string {
  if (!isTauri()) return "unknown";

  const now = nowMs();
  if (!posturePollInFlight && now - lastPosturePollMs >= POLL_INTERVAL_MS) {
    posturePollInFlight = true;
    void invoke<string>(POSTURE_TYPE_COMMAND)
      .then((posture) => {
        lastPostureType = posture;
      })
      .catch((err) => {
        console.warn("Failed to read Tauri posture type", err);
      })
      .finally(() => {
        lastPosturePollMs = nowMs();
        posturePollInFlight = false;
      });
  }

  return lastPostureType;
}
