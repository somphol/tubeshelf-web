const DEVICE_KEY = "tubeshelf-rw-device-name";

/** A readable browser-platform label; the real OS hostname is not exposed. */
export function detectedDeviceName() {
  if (typeof navigator === "undefined") return "Web";
  const ua = navigator.userAgent || "";
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  if (/iPad/i.test(ua) || (/Mac/i.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return "Android";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Mac/i.test(platform) || /Mac OS X/i.test(ua)) return "macOS";
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return "Linux";
  return "Web";
}

export function deviceName() {
  try {
    return localStorage.getItem(DEVICE_KEY) || detectedDeviceName();
  } catch {
    return detectedDeviceName();
  }
}

export function setDeviceName(value) {
  const cleaned = String(value || "").trim();
  try {
    if (cleaned) localStorage.setItem(DEVICE_KEY, cleaned);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {}
}
