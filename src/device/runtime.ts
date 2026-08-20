import { isTauri } from "@tauri-apps/api/core";
import { Capacitor } from "@capacitor/core";

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

export function resolveRuntimeInfo(): RuntimeInfo {
  const platform = Capacitor.isNativePlatform()
    ? Platform.Capacitor
    : isTauri()
      ? Platform.Tauri
      : Platform.Web;

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
