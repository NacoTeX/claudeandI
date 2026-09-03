// Alle API-Pfade sind relativ (ohne führenden Slash), damit sie unter dem
// Ingress-Token-Präfix von Home Assistant bleiben statt auf dessen Wurzel
// zu zeigen.

async function setStatus(elementId, url, formatOk) {
  const el = document.getElementById(elementId);
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (res.ok && data && (data.status === "ok" || data.available)) {
      el.textContent = formatOk(data);
      el.className = "status status-ok";
    } else {
      el.textContent = data.error || "nicht verfügbar";
      el.className = "status status-warn";
    }
  } catch (err) {
    el.textContent = "nicht erreichbar";
    el.className = "status status-err";
  }
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

async function loadInventory() {
  const el = document.getElementById("inventory-status");
  try {
    const [devices, zones] = await Promise.all([
      fetch("api/devices").then((r) => r.json()),
      fetch("api/zones").then((r) => r.json()),
    ]);
    if (!devices.length) {
      el.textContent = "noch keine Geräte";
      el.className = "status status-pending";
      return;
    }
    const built = devices.filter((d) => d.status === "success").length;
    const parts = [plural(devices.length, "Gerät", "Geräte")];
    if (built < devices.length) parts.push(`${built} gebaut`);
    if (zones.length) parts.push(plural(zones.length, "Zone", "Zonen"));
    el.textContent = parts.join(" · ");
    el.className = "status status-ok";
  } catch (err) {
    el.textContent = "nicht erreichbar";
    el.className = "status status-err";
  }
}

setStatus("health-status", "api/health", () => "online");
setStatus("esphome-status", "api/esphome/version", (d) => d.version || "installiert");
loadInventory();

for (const btn of document.querySelectorAll(".tab-btn")) {
  btn.addEventListener("click", () => {
    for (const b of document.querySelectorAll(".tab-btn")) b.classList.remove("active");
    btn.classList.add("active");
    for (const panel of document.querySelectorAll(".tab-panel")) panel.hidden = true;
    document.getElementById(`tab-${btn.dataset.tab}`).hidden = false;
    if (btn.dataset.tab === "overview") loadInventory();
  });
}
