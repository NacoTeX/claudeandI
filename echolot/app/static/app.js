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
  const trafficEl = document.getElementById("traffic-estimate");
  try {
    const [devices, zones, presetInfo] = await Promise.all([
      fetch("api/devices").then((r) => r.json()),
      fetch("api/zones").then((r) => r.json()),
      fetch("api/presets").then((r) => r.json()),
    ]);
    if (!devices.length) {
      el.textContent = "noch keine Geräte";
      el.className = "status status-pending";
      trafficEl.hidden = true;
      return;
    }
    const built = devices.filter((d) => d.status === "success").length;
    const parts = [plural(devices.length, "Gerät", "Geräte")];
    if (built < devices.length) parts.push(`${built} gebaut`);
    if (zones.length) parts.push(plural(zones.length, "Zone", "Zonen"));
    el.textContent = parts.join(" · ");
    el.className = "status status-ok";

    // Every device probes the air continuously; worth seeing the sum.
    const kb = devices.reduce(
      (sum, d) => sum + d.config.traffic_generator_rate * presetInfo.kb_per_second_per_pps,
      0
    );
    trafficEl.textContent = `≈ ${kb.toFixed(1)} KB/s Funklast insgesamt`;
    trafficEl.hidden = false;
  } catch (err) {
    el.textContent = "nicht erreichbar";
    el.className = "status status-err";
  }
}

async function loadMqttStatus() {
  const el = document.getElementById("mqtt-status");
  const note = document.getElementById("mqtt-note");
  try {
    const s = await (await fetch("api/mqtt/status")).json();
    if (s.connected) {
      el.textContent = "exportiert";
      el.className = "status status-ok";
      note.textContent = "Zonen erscheinen als Belegungssensoren und lassen sich in Automationen nutzen.";
    } else {
      el.textContent = "nicht aktiv";
      el.className = "status status-pending";
      note.textContent = s.error
        ? `${s.error}. Ohne MQTT-Broker bleiben Zonen nur hier sichtbar.`
        : "Ohne MQTT-Broker (Mosquitto-Add-on) bleiben Zonen nur hier sichtbar.";
    }
    note.hidden = false;
  } catch (err) {
    el.textContent = "nicht erreichbar";
    el.className = "status status-err";
  }
}

setStatus("health-status", "api/health", () => "online");
setStatus("esphome-status", "api/esphome/version", (d) => d.version || "installiert");
loadInventory();
loadMqttStatus();

for (const btn of document.querySelectorAll(".tab-btn")) {
  btn.addEventListener("click", () => {
    for (const b of document.querySelectorAll(".tab-btn")) b.classList.remove("active");
    btn.classList.add("active");
    for (const panel of document.querySelectorAll(".tab-panel")) panel.hidden = true;
    document.getElementById(`tab-${btn.dataset.tab}`).hidden = false;
    if (btn.dataset.tab === "overview") {
      loadInventory();
      loadMqttStatus();
    }
  });
}
