// Relative (non-leading-slash) fetch paths are required so requests stay
// under the Home Assistant Ingress token prefix instead of hitting the
// Home Assistant root domain.

async function setStatus(elementId, url, formatOk) {
  const el = document.getElementById(elementId);
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (res.ok && data && (data.status === "ok" || data.available)) {
      el.textContent = formatOk(data);
      el.className = "status status-ok";
    } else {
      el.textContent = data.error || "unavailable";
      el.className = "status status-warn";
    }
  } catch (err) {
    el.textContent = "unreachable";
    el.className = "status status-err";
  }
}

setStatus("health-status", "api/health", () => "online");
setStatus("esphome-status", "api/esphome/version", (d) => d.version || "installed");
