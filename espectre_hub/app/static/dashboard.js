// Live dashboard (Phase 4): a glanceable view of all devices + zones.
//
// Status dots poll Home Assistant every few seconds, same as the Devices/
// Zones tabs. Optionally, on BLE-capable boards, "Connect live" opens a
// direct Web Bluetooth connection to the device itself for a much higher
// update rate (~10-50ms) — entirely client-side, no backend involved, per
// ESPectre's own BLE game client docs:
// https://github.com/francescopace/espectre/blob/main/docs/game/README.md
//
// This GATT protocol is implemented strictly to that documented spec but
// has NOT been exercised against real ESPectre hardware (no BLE-capable
// browser/device available in the environment this was built in) — the
// polling fallback below is the verified path.

const BLE_SERVICE_UUID = "d33ff46b-2203-4775-bc6f-b3a2c36af8f0";
const BLE_TELEMETRY_UUID = "119d5cac-48da-4bd9-bfc3-169805868258";
const BLE_SYSINFO_UUID = "c8c89ffa-c401-461f-9ffc-942fa04adfe3";
const BLE_CONTROL_UUID = "33ed9214-a8d7-40e8-82d1-c82747dcdc71";

// Chips ESPectre's BLE channel supports (S2 and H2 are excluded upstream).
const BLE_CAPABLE_CHIP_FAMILIES = new Set(["ESP32", "ESP32-C3", "ESP32-C5", "ESP32-C6", "ESP32-S3"]);

const bleConnections = new Map(); // device id -> { device, sysinfoBuffer }

function parseTelemetry(dataView) {
  return {
    movement: dataView.getFloat32(0, true),
    threshold: dataView.getFloat32(4, true),
  };
}

async function writeControl(characteristic, text) {
  const bytes = new TextEncoder().encode(text);
  if (characteristic.writeValueWithoutResponse) {
    await characteristic.writeValueWithoutResponse(bytes);
  } else {
    await characteristic.writeValue(bytes);
  }
}

function renderDashboardTile(device, boardsByKey, zoneNamesByDevice) {
  const c = device.config;
  const title = c.friendly_name || c.name;
  const board = boardsByKey[c.board];
  const bleCapable = board && BLE_CAPABLE_CHIP_FAMILIES.has(board.chip_family);
  const zoneNames = zoneNamesByDevice[device.id] || [];

  const bleBlock = bleCapable
    ? `<button type="button" class="ble-connect-btn">Connect live (BLE)</button>
       <div class="ble-gauge" hidden>
         <div class="gauge-track"><div class="gauge-fill"></div></div>
         <p class="gauge-readout"><span class="gauge-movement">0.00</span> / <span class="gauge-threshold">—</span></p>
         <p class="gauge-sysinfo"></p>
       </div>
       <p class="ble-error status status-err" hidden></p>`
    : device.status === "success"
      ? `<p class="hint" style="margin:0.5rem 0 0">This board's chip doesn't support ESPectre's BLE telemetry channel.</p>`
      : "";

  return `
    <div class="glass-tile" data-dash-id="${device.id}">
      <div class="glass-tile-header">
        <span class="tile-dot" data-dot></span>
        <h3>${escapeHtml(title)}</h3>
      </div>
      <p class="tile-sub">${escapeHtml(c.board)}${zoneNames.length ? " · " + zoneNames.map(escapeHtml).join(", ") : ""}</p>
      ${device.status !== "success" ? '<p class="status status-pending">not built yet</p>' : ""}
      ${bleBlock}
    </div>`;
}

function renderZoneTile(zone) {
  return `
    <div class="glass-tile" data-dash-zone="${zone.id}">
      <div class="glass-tile-header">
        <span class="tile-dot" data-dot></span>
        <h3>${escapeHtml(zone.name)}</h3>
      </div>
      <p class="tile-sub">${zone.device_ids.length} device${zone.device_ids.length === 1 ? "" : "s"}</p>
    </div>`;
}

async function loadDashboard() {
  const grid = document.getElementById("dashboard-grid");
  const bleNotice = document.getElementById("ble-unsupported-notice");
  bleNotice.hidden = !!navigator.bluetooth;

  let deviceList, zoneList, boards;
  try {
    [deviceList, zoneList, boards] = await Promise.all([
      fetch("api/devices").then((r) => r.json()),
      fetch("api/zones").then((r) => r.json()),
      fetch("api/boards").then((r) => r.json()),
    ]);
  } catch (err) {
    grid.innerHTML = '<p class="status status-err">Failed to load dashboard data</p>';
    return;
  }

  const boardsByKey = Object.fromEntries(boards.map((b) => [b.key, b]));
  const zoneNamesByDevice = {};
  for (const zone of zoneList) {
    for (const id of zone.device_ids) {
      (zoneNamesByDevice[id] ||= []).push(zone.name);
    }
  }

  // Devices and zones are visually identical as bare tiles, so they get
  // their own labelled sections rather than one undifferentiated grid.
  const sections = [];
  if (deviceList.length) {
    sections.push(`
      <section class="dash-section">
        <h2 class="dash-heading">Devices</h2>
        <div class="dashboard-grid">
          ${deviceList.map((d) => renderDashboardTile(d, boardsByKey, zoneNamesByDevice)).join("")}
        </div>
      </section>`);
  }
  if (zoneList.length) {
    sections.push(`
      <section class="dash-section">
        <h2 class="dash-heading">Zones</h2>
        <div class="dashboard-grid">${zoneList.map(renderZoneTile).join("")}</div>
      </section>`);
  }
  grid.innerHTML = sections.length
    ? sections.join("")
    : '<p class="status status-pending">Add devices and zones on the other tabs first.</p>';

  for (const el of grid.querySelectorAll("[data-dash-id]")) {
    const id = el.dataset.dashId;
    const btn = el.querySelector(".ble-connect-btn");
    if (btn) btn.addEventListener("click", () => toggleBleConnection(id, el));
    refreshDashboardDeviceDot(id, el);
  }
  for (const el of grid.querySelectorAll("[data-dash-zone]")) {
    refreshDashboardZoneDot(el.dataset.dashZone, el);
  }
}

async function refreshDashboardDeviceDot(id, tileEl) {
  if (bleConnections.has(id)) return; // BLE telemetry drives the dot instead while connected
  const dot = tileEl.querySelector("[data-dot]");
  try {
    const state = await (await fetch(`api/devices/${id}/state`)).json();
    dot.className = `tile-dot ${state.available ? (state.motion ? "tile-dot-on" : "tile-dot-off") : "tile-dot-unknown"}`;
  } catch (err) {
    dot.className = "tile-dot tile-dot-unknown";
  }
}

async function refreshDashboardZoneDot(id, tileEl) {
  const dot = tileEl.querySelector("[data-dot]");
  try {
    const state = await (await fetch(`api/zones/${id}/state`)).json();
    dot.className = `tile-dot ${state.available ? (state.occupied ? "tile-dot-on" : "tile-dot-off") : "tile-dot-unknown"}`;
  } catch (err) {
    dot.className = "tile-dot tile-dot-unknown";
  }
}

function refreshAllDashboardDots() {
  for (const el of document.querySelectorAll("[data-dash-id]")) refreshDashboardDeviceDot(el.dataset.dashId, el);
  for (const el of document.querySelectorAll("[data-dash-zone]")) refreshDashboardZoneDot(el.dataset.dashZone, el);
}

async function toggleBleConnection(id, tileEl) {
  if (bleConnections.has(id)) {
    bleConnections.get(id).device.gatt.disconnect();
    return;
  }

  const btn = tileEl.querySelector(".ble-connect-btn");
  const gauge = tileEl.querySelector(".ble-gauge");
  const errorEl = tileEl.querySelector(".ble-error");
  errorEl.hidden = true;

  if (!navigator.bluetooth) {
    errorEl.textContent = "Web Bluetooth isn't supported in this browser.";
    errorEl.hidden = false;
    return;
  }

  try {
    btn.disabled = true;
    btn.textContent = "Connecting…";
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

    telemetryChar.addEventListener("characteristicvaluechanged", (evt) => {
      const { movement, threshold } = parseTelemetry(evt.target.value);
      updateGauge(tileEl, movement, threshold);
    });
    await telemetryChar.startNotifications();

    sysinfoChar.addEventListener("characteristicvaluechanged", (evt) => {
      state.sysinfoBuffer += new TextDecoder().decode(evt.target.value);
      const endIdx = state.sysinfoBuffer.indexOf("END");
      if (endIdx === -1) return;
      const text = state.sysinfoBuffer.slice(0, endIdx);
      state.sysinfoBuffer = "";
      tileEl.querySelector(".gauge-sysinfo").textContent = text.trim().split("\n").join(" · ");
    });
    await sysinfoChar.startNotifications();
    await writeControl(controlChar, "REQ_SYSINFO");

    bleDevice.addEventListener("gattserverdisconnected", () => {
      bleConnections.delete(id);
      gauge.hidden = true;
      btn.disabled = false;
      btn.textContent = "Connect live (BLE)";
      refreshDashboardDeviceDot(id, tileEl);
    });

    gauge.hidden = false;
    btn.disabled = false;
    btn.textContent = "Disconnect";
  } catch (err) {
    bleConnections.delete(id);
    errorEl.textContent = err.message || "BLE connection failed";
    errorEl.hidden = false;
    btn.disabled = false;
    btn.textContent = "Connect live (BLE)";
  }
}

function updateGauge(tileEl, movement, threshold) {
  const dot = tileEl.querySelector("[data-dot]");
  const fill = tileEl.querySelector(".gauge-fill");
  const movementEl = tileEl.querySelector(".gauge-movement");
  const thresholdEl = tileEl.querySelector(".gauge-threshold");

  const occupied = movement > threshold;
  dot.className = `tile-dot ${occupied ? "tile-dot-on" : "tile-dot-off"}`;
  movementEl.textContent = movement.toFixed(2);
  thresholdEl.textContent = threshold.toFixed(2);
  const pct = Math.max(0, Math.min(1, movement / (threshold * 1.5 || 1))) * 100;
  fill.style.width = `${pct}%`;
  fill.className = `gauge-fill ${occupied ? "gauge-fill-on" : ""}`;
}

document.querySelector('.tab-btn[data-tab="dashboard"]').addEventListener("click", loadDashboard);

loadDashboard();
setInterval(refreshAllDashboardDots, 5000);
