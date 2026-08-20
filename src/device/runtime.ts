import { isTauri } from "@tauri-apps/api/core";

export enum Platform {
  Tauri = "tauri",
  Capacitor = "capacitor",
  Web = "web",
}

export enum Device {
  Laptop = "laptop",
  Phone = "phone",
}

export interface RuntimeInfo {
  platform: Platform;
  device: Device;
}

function resolvePlatform(): Platform {
  if (isTauri()) return Platform.Tauri;
  const capacitor = (
    window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor;
  if (capacitor?.isNativePlatform?.()) return Platform.Capacitor;
  return Platform.Web;
}

export function resolveRuntimeInfo(): RuntimeInfo {
  const platform = resolvePlatform();

  let device = Device.Laptop;
  if (typeof navigator !== "undefined") {
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
    const ua = nav.userAgent?.toLowerCase() ?? "";
    const isMobile =
      nav.userAgentData?.mobile === true || /android|iphone|ipad|ipod|mobile/.test(ua);
    device = isMobile ? Device.Phone : Device.Laptop;
  }

  return { platform, device };
}
