// Live dashboard / visualizer (Phase 4).
//
// The point of this view is answering "is the threshold sitting in the
// right place, and is the signal steady or flickering?" — questions a
// single status dot cannot answer. So every device tile draws its
// movement score over time with the threshold marked on it.
//
// One chart, two data sources: it is fed by Home Assistant polling
// (~5s) by default, and switches to the device's own BLE telemetry
// (~10-50ms) when you connect, per ESPectre's documented GATT protocol:
// https://github.com/francescopace/espectre/blob/main/docs/game/README.md
//
// That BLE path is built to the documented spec but has NOT been
// exercised against real hardware; the polled path is the verified one.

const BLE_SERVICE_UUID = "d33ff46b-2203-4775-bc6f-b3a2c36af8f0";
const BLE_TELEMETRY_UUID = "119d5cac-48da-4bd9-bfc3-169805868258";
const BLE_SYSINFO_UUID = "c8c89ffa-c401-461f-9ffc-942fa04adfe3";
const BLE_CONTROL_UUID = "33ed9214-a8d7-40e8-82d1-c82747dcdc71";

const POLL_MS = 5000;
const HISTORY_MINUTES = 30;
const MAX_POINTS = 400;

const bleConnections = new Map(); // device id -> { device, sysinfoBuffer }
const traces = new Map(); // device id -> { points: [{t, v}], threshold, live }
let pollTimer = null;

/* ---------- data ---------- */

function trace(id) {
  if (!traces.has(id)) traces.set(id, { points: [], threshold: null, live: false });
  return traces.get(id);
}

function pushPoint(id, value, threshold) {
  const t = trace(id);
  if (value != null) {
    t.points.push({ t: Date.now(), v: value });
    if (t.points.length > MAX_POINTS) t.points.splice(0, t.points.length - MAX_POINTS);
  }
  if (threshold != null) t.threshold = threshold;
}

function parseTelemetry(dataView) {
  return {
    movement: dataView.getFloat32(0, true),
    threshold: dataView.getFloat32(4, true),
  };
}

/* ---------- chart ---------- */

// Canvas rather than SVG: at BLE notify rates a polyline rebuild per
// frame gets expensive, and this keeps redraws cheap.
function drawTrace(canvas, id) {
  const t = trace(id);
  const css = getComputedStyle(document.documentElement);
  const line = css.getPropertyValue("--accent").trim() || "#0d9488";
  const over = css.getPropertyValue("--ok").trim() || "#15803d";
  const grid = css.getPropertyValue("--faint").trim() || "#8b93a3";

  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== w * ratio || canvas.height !== h * ratio) {
    canvas.width = w * ratio;
    canvas.height = h * ratio;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pts = t.points;
  if (!pts.length) {
    ctx.fillStyle = grid;
    ctx.globalAlpha = 0.65;
    ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText("warte auf Daten…", 4, h / 2 + 4);
    ctx.globalAlpha = 1;
    return;
  }

  // Scale to the data, but always keep the threshold line in frame —
  // a chart that hides the threshold defeats the purpose.
  const values = pts.map((p) => p.v);
  const candidates = values.concat(t.threshold != null ? [t.threshold] : []);
  const max = Math.max(...candidates, 0.5) * 1.15;
  const x = (i) => (pts.length === 1 ? w : (i / (pts.length - 1)) * w);
  const y = (v) => h - (Math.max(0, v) / max) * h;

  if (t.threshold != null) {
    ctx.strokeStyle = grid;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y(t.threshold));
    ctx.lineTo(w, y(t.threshold));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  const latest = values[values.length - 1];
  const hot = t.threshold != null && latest > t.threshold;
  const stroke = hot ? over : line;

  const area = ctx.createLinearGradient(0, 0, 0, h);
  area.addColorStop(0, stroke);
  area.addColorStop(1, "transparent");
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = area;
  ctx.beginPath();
  ctx.moveTo(x(0), h);
  pts.forEach((p, i) => ctx.lineTo(x(i), y(p.v)));
  ctx.lineTo(x(pts.length - 1), h);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.75;
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.v)) : ctx.moveTo(x(i), y(p.v))));
  ctx.stroke();

  ctx.fillStyle = stroke;
  ctx.beginPath();
  ctx.arc(x(pts.length - 1), y(latest), 2.5, 0, Math.PI * 2);
  ctx.fill();
}

function redraw(id) {
  const canvas = document.querySelector(`canvas[data-trace="${id}"]`);
  if (canvas) drawTrace(canvas, id);
}

/* ---------- rendering ---------- */

function relativeTime(ms) {
  if (ms == null) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`;
}

function renderDeviceTile(device, boardsByKey, zoneNamesByDevice) {
  const c = device.config;
  const board = boardsByKey[c.board];
  // Comes from the board registry, which also decides whether the
  // firmware gets a BLE server at all — one source, no drift.
  const bleCapable = Boolean(board && board.ble);
  const zoneNames = zoneNamesByDevice[device.id] || [];

  if (device.status !== "success") {
    return `
      <div class="glass-tile tile-idle" data-dash-id="${device.id}">
        <div class="glass-tile-header">
          <span class="tile-dot"></span>
          <h3>${escapeHtml(c.friendly_name || c.name)}</h3>
        </div>
        <p class="tile-sub">noch nicht gebaut — im Tab „Geräte“ bauen</p>
      </div>`;
  }

  return `
    <div class="glass-tile" data-dash-id="${device.id}">
      <div class="glass-tile-header">
        <span class="tile-dot" data-dot></span>
        <h3>${escapeHtml(c.friendly_name || c.name)}</h3>
        <span class="tile-state" data-state>…</span>
      </div>
      ${zoneNames.length ? `<p class="tile-sub">${zoneNames.map(escapeHtml).join(", ")}</p>` : ""}
      <canvas class="trace" data-trace="${device.id}" height="56"></canvas>
      <div class="tile-readout">
        <span class="readout-item"><b data-score>—</b> Wert</span>
        <span class="readout-item readout-threshold"><b data-threshold>—</b> Schwelle</span>
        ${bleCapable ? '<button type="button" class="ble-connect-btn">Live</button>' : ""}
      </div>
      <p class="tile-note" data-note hidden></p>
    </div>`;
}

function renderZoneTile(zone) {
  return `
    <div class="glass-tile" data-dash-zone="${zone.id}">
      <div class="glass-tile-header">
        <span class="tile-dot" data-dot></span>
        <h3>${escapeHtml(zone.name)}</h3>
        <span class="tile-state" data-zone-state>…</span>
      </div>
      <div class="zone-members" data-members>
        ${zone.device_ids.map((id) => `<span class="chip" data-member="${id}">…</span>`).join("")}
      </div>
    </div>`;
}

async function loadDashboard() {
  const grid = document.getElementById("dashboard-grid");
  document.getElementById("ble-unsupported-notice").hidden = !!navigator.bluetooth;

  let deviceList, zoneList, boards;
  try {
    [deviceList, zoneList, boards] = await Promise.all([
      fetch("api/devices").then((r) => r.json()),
      fetch("api/zones").then((r) => r.json()),
      fetch("api/boards").then((r) => r.json()),
    ]);
  } catch (err) {
    grid.innerHTML = '<p class="status status-err">Dashboard-Daten konnten nicht geladen werden</p>';
    return;
  }

  const boardsByKey = Object.fromEntries(boards.map((b) => [b.key, b]));
  const zoneNamesByDevice = {};
  for (const zone of zoneList) {
    for (const id of zone.device_ids) (zoneNamesByDevice[id] ||= []).push(zone.name);
  }

  const sections = [];
  if (deviceList.length) {
    sections.push(`<section class="dash-section"><h2 class="dash-heading">Geräte</h2>
      <div class="dashboard-grid">${deviceList.map((d) => renderDeviceTile(d, boardsByKey, zoneNamesByDevice)).join("")}</div>
    </section>`);
  }
  if (zoneList.length) {
    sections.push(`<section class="dash-section"><h2 class="dash-heading">Zonen</h2>
      <div class="dashboard-grid">${zoneList.map(renderZoneTile).join("")}</div>
    </section>`);
  }
  grid.innerHTML = sections.length
    ? sections.join("")
    : '<p class="status status-pending">Lege zuerst Geräte und Zonen in den anderen Tabs an.</p>';

  for (const el of grid.querySelectorAll("[data-dash-id]")) {
    const btn = el.querySelector(".ble-connect-btn");
    if (btn) btn.addEventListener("click", () => toggleBleConnection(el.dataset.dashId, el));
  }

  // Seed each chart from recorded history so it opens with context.
  await Promise.all(
    deviceList.filter((d) => d.status === "success").map(async (d) => {
      try {
        const hist = await (await fetch(`api/devices/${d.id}/history?minutes=${HISTORY_MINUTES}`)).json();
        if (hist.available && hist.points.length) {
          const t = trace(d.id);
          t.points = hist.points.slice(-MAX_POINTS).map((p) => ({ t: p.t * 1000, v: p.v }));
          redraw(d.id);
        }
      } catch (err) {
        /* history is a nicety; the chart still fills from live polling */
      }
    })
  );

  refreshAll();
}

/* ---------- live updates ---------- */

async function refreshDevice(id, tileEl) {
  const dot = tileEl.querySelector("[data-dot]");
  const stateEl = tileEl.querySelector("[data-state]");
  const scoreEl = tileEl.querySelector("[data-score]");
  const thresholdEl = tileEl.querySelector("[data-threshold]");
  const noteEl = tileEl.querySelector("[data-note]");
  if (!dot) return;

  // While BLE is streaming, it owns the tile — don't fight it with polls.
  if (bleConnections.has(id)) return;

  let state;
  try {
    state = await (await fetch(`api/devices/${id}/state`)).json();
  } catch (err) {
    state = { available: false, error: "Backend nicht erreichbar" };
  }

  if (!state.available) {
    dot.className = "tile-dot tile-dot-unknown";
    stateEl.textContent = "nicht verfügbar";
    stateEl.className = "tile-state status-warn";
    noteEl.textContent = state.error || "";
    noteEl.hidden = !state.error;
    return;
  }

  noteEl.hidden = true;
  pushPoint(id, state.movement_score, state.threshold);
  const t = trace(id);
  if (state.motion) t.lastMotion = Date.now();

  dot.className = `tile-dot ${state.motion ? "tile-dot-on" : "tile-dot-off"}`;
  stateEl.textContent = state.motion
    ? "Bewegung"
    : t.lastMotion
      ? `frei · seit ${relativeTime(Date.now() - t.lastMotion)}`
      : "frei";
  stateEl.className = `tile-state ${state.motion ? "status-ok" : "status-pending"}`;
  scoreEl.textContent = state.movement_score != null ? state.movement_score.toFixed(2) : "—";
  thresholdEl.textContent = state.threshold != null ? state.threshold.toFixed(2) : "—";
  redraw(id);
}

async function refreshZone(id, tileEl) {
  const dot = tileEl.querySelector("[data-dot]");
  const stateEl = tileEl.querySelector("[data-zone-state]");
  let state;
  try {
    state = await (await fetch(`api/zones/${id}/state`)).json();
  } catch (err) {
    dot.className = "tile-dot tile-dot-unknown";
    stateEl.textContent = "nicht erreichbar";
    stateEl.className = "tile-state status-err";
    return;
  }

  if (!state.available) {
    dot.className = "tile-dot tile-dot-unknown";
    stateEl.textContent = "nicht verfügbar";
    stateEl.className = "tile-state status-warn";
  } else {
    dot.className = `tile-dot ${state.occupied ? "tile-dot-on" : "tile-dot-off"}`;
    stateEl.textContent = state.occupied ? "belegt" : "frei";
    stateEl.className = `tile-state ${state.occupied ? "status-ok" : "status-pending"}`;
  }

  // Which member actually tripped is the useful part of a zone.
  for (const member of state.members || []) {
    const chip = tileEl.querySelector(`[data-member="${member.device_id}"]`);
    if (!chip) continue;
    chip.textContent = member.name || member.device_id.slice(0, 8);
    chip.className = `chip ${member.available ? (member.motion ? "chip-on" : "") : "chip-unknown"}`;
    chip.title = member.available ? "" : member.error || "nicht verfügbar";
  }
}

function refreshAll() {
  if (document.getElementById("tab-dashboard").hidden) return;
  for (const el of document.querySelectorAll("[data-dash-id]")) refreshDevice(el.dataset.dashId, el);
  for (const el of document.querySelectorAll("[data-dash-zone]")) refreshZone(el.dataset.dashZone, el);
}

// Polling only runs while the tab is actually on screen.
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(refreshAll, POLL_MS);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

/* ---------- BLE ---------- */

async function writeControl(characteristic, text) {
  const bytes = new TextEncoder().encode(text);
  if (characteristic.writeValueWithoutResponse) await characteristic.writeValueWithoutResponse(bytes);
  else await characteristic.writeValue(bytes);
}

async function toggleBleConnection(id, tileEl) {
  if (bleConnections.has(id)) {
    bleConnections.get(id).device.gatt.disconnect();
    return;
  }

  const btn = tileEl.querySelector(".ble-connect-btn");
  const noteEl = tileEl.querySelector("[data-note]");
  noteEl.hidden = true;

  if (!navigator.bluetooth) {
    noteEl.textContent = "Dieser Browser unterstützt kein Web Bluetooth.";
    noteEl.hidden = false;
    return;
  }

  try {
    btn.disabled = true;
    btn.textContent = "…";
    const bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLE_SERVICE_UUID] }],
      optionalServices: [BLE_SERVICE_UUID],
    });
    const server = await bleDevice.gatt.connect();
    const service = await server.getPrimaryService(BLE_SERVICE_UUID);
    const telemetryChar = await service.getCharacteristic(BLE_TELEMETRY_UUID);
    const sysinfoChar = await service.getCharacteristic(BLE_SYSINFO_UUID);
    const controlChar = await service.getCharacteristic(BLE_CONTROL_UUID);

    const state = { device: bleDevice, sysinfoBuffer: "" };
    bleConnections.set(id, state);
    trace(id).live = true;

    telemetryChar.addEventListener("characteristicvaluechanged", (evt) => {
      const { movement, threshold } = parseTelemetry(evt.target.value);
      pushPoint(id, movement, threshold);
      const t = trace(id);
      const hot = movement > threshold;
      if (hot) t.lastMotion = Date.now();
      tileEl.querySelector("[data-dot]").className = `tile-dot ${hot ? "tile-dot-on" : "tile-dot-off"}`;
      const stateEl = tileEl.querySelector("[data-state]");
      stateEl.textContent = hot ? "Bewegung" : "frei";
      stateEl.className = `tile-state ${hot ? "status-ok" : "status-pending"}`;
      tileEl.querySelector("[data-score]").textContent = movement.toFixed(2);
      tileEl.querySelector("[data-threshold]").textContent = threshold.toFixed(2);
      redraw(id);
    });
    await telemetryChar.startNotifications();

    sysinfoChar.addEventListener("characteristicvaluechanged", (evt) => {
      state.sysinfoBuffer += new TextDecoder().decode(evt.target.value);
      const end = state.sysinfoBuffer.indexOf("END");
      if (end === -1) return;
      const text = state.sysinfoBuffer.slice(0, end);
      state.sysinfoBuffer = "";
      noteEl.textContent = text.trim().split("\n").join(" · ");
      noteEl.hidden = false;
    });
    await sysinfoChar.startNotifications();
    await writeControl(controlChar, "REQ_SYSINFO");

    bleDevice.addEventListener("gattserverdisconnected", () => {
      bleConnections.delete(id);
      trace(id).live = false;
      tileEl.classList.remove("tile-live");
      btn.disabled = false;
      btn.textContent = "Live";
    });

    tileEl.classList.add("tile-live");
    btn.disabled = false;
    btn.textContent = "Stopp";
  } catch (err) {
    bleConnections.delete(id);
    trace(id).live = false;
    noteEl.textContent = err.message || "BLE-Verbindung fehlgeschlagen";
    noteEl.hidden = false;
    btn.disabled = false;
    btn.textContent = "Live";
  }
}

/* ---------- wiring ---------- */

document.querySelector('.tab-btn[data-tab="dashboard"]').addEventListener("click", () => {
  loadDashboard();
  startPolling();
});

for (const btn of document.querySelectorAll('.tab-btn:not([data-tab="dashboard"])')) {
  btn.addEventListener("click", stopPolling);
}

window.addEventListener("resize", () => {
  for (const el of document.querySelectorAll("[data-dash-id]")) redraw(el.dataset.dashId);
});

loadDashboard();
