// Geräteverwaltung + Flashen über den Browser (Phase 2).
//
// Alle API-Pfade sind relativ (ohne führenden Slash), damit sie unter dem
// Ingress-Präfix bleiben — Begründung in app.js.

const POLL_INTERVAL_MS = 2000;
const activePolls = new Set();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function loadBoards() {
  const select = document.getElementById("board-select");
  try {
    const boards = await (await fetch("api/boards")).json();
    select.innerHTML = boards
      .map((b) => `<option value="${escapeHtml(b.key)}">${escapeHtml(b.label)}${b.experimental ? " ⚠" : ""}</option>`)
      .join("");
  } catch (err) {
    select.innerHTML = '<option value="">Boards konnten nicht geladen werden</option>';
  }
}

function statusLabel(status) {
  return { idle: "nicht gebaut", queued: "in Warteschlange…", running: "wird gebaut…", success: "bereit zum Flashen", error: "Build fehlgeschlagen" }[status] || status;
}

function statusClass(status) {
  return { success: "status-ok", error: "status-err", running: "status-warn", queued: "status-warn" }[status] || "status-pending";
}

const ENTITY_FIELDS = ["entity_motion", "entity_movement_score", "entity_threshold", "entity_calibrate"];
const ENTITY_LABELS = { entity_motion: "Bewegung", entity_movement_score: "Bewegungswert", entity_threshold: "Schwelle", entity_calibrate: "Kalibrierung" };

function renderDevice(device) {
  const c = device.config;
  const title = c.friendly_name || c.name;
  const canBuild = device.status !== "queued" && device.status !== "running";
  const built = device.status === "success";

  const logBlock = device.build_log
    ? `<details><summary>Build-Protokoll</summary><pre class="build-log">${escapeHtml(device.build_log.slice(-4000))}</pre></details>`
    : "";
  const errorLine = device.build_error
    ? `<p class="status status-err">${escapeHtml(device.build_error)}</p>`
    : "";

  const flashBlock = built
    ? `<esp-web-install-button manifest="api/devices/${device.id}/manifest.json">
         <button slot="activate">Über USB flashen</button>
         <span slot="unsupported">Dieser Browser unterstützt kein Web Serial (nutze Chrome oder Edge).</span>
         <span slot="not-allowed">Web Serial benötigt HTTPS oder localhost — siehe Hinweis oben.</span>
       </esp-web-install-button>`
    : "";

  const liveBlock = built
    ? `<div class="live-block" data-live-id="${device.id}">
         <div class="live-row"><span class="live-label">Bewegung</span><span class="live-motion status status-pending">wird geprüft…</span></div>
         <div class="live-row"><span class="live-label">Bewegungswert</span><span class="live-score">—</span></div>
         <form class="threshold-form">
           <label>Schwelle
             <input class="threshold-input" type="number" min="0" max="10" step="0.1" placeholder="0.0–10.0">
           </label>
           <button type="submit">Senden</button>
         </form>
         <button type="button" class="calibrate-btn">Neu kalibrieren</button>
         <p class="live-error status status-err" hidden></p>
       </div>
       <details class="entity-editor">
         <summary>HA-Entity-IDs</summary>
         ${ENTITY_FIELDS.map((f) => `
           <label>${ENTITY_LABELS[f]}
             <input class="entity-input" data-field="${f}" value="${escapeHtml(device[f] || "")}">
           </label>`).join("")}
         <button type="button" class="save-entities-btn">Entity-IDs speichern</button>
       </details>`
    : "";

  return `
    <div class="card device-card" data-id="${device.id}">
      <div class="device-card-header">
        <h3>${escapeHtml(title)}</h3>
        <span class="status ${statusClass(device.status)}">${statusLabel(device.status)}</span>
      </div>
      <p class="device-meta">${escapeHtml(c.name)} · ${escapeHtml(c.board)} · ${escapeHtml(c.detection_algorithm)}</p>
      ${errorLine}
      <div class="device-actions">
        <button class="build-btn${built ? " btn-secondary" : ""}" ${canBuild ? "" : "disabled"}>${built ? "Neu bauen" : "Firmware bauen"}</button>
        ${flashBlock}
        <button class="delete-btn">Löschen</button>
      </div>
      ${liveBlock}
      ${logBlock}
    </div>`;
}

async function loadDevices() {
  const list = document.getElementById("device-list");
  let devices;
  try {
    devices = await (await fetch("api/devices")).json();
  } catch (err) {
    list.innerHTML = '<p class="status status-err">Geräte konnten nicht geladen werden</p>';
    return;
  }

  list.innerHTML = devices.length
    ? devices.map(renderDevice).join("")
    : '<p class="status status-pending">Noch keine Geräte — lege oben eines an.</p>';

  for (const el of list.querySelectorAll(".device-card")) {
    const id = el.dataset.id;
    el.querySelector(".build-btn").addEventListener("click", () => startBuild(id));
    el.querySelector(".delete-btn").addEventListener("click", () => deleteDevice(id));

    const thresholdForm = el.querySelector(".threshold-form");
    if (thresholdForm) thresholdForm.addEventListener("submit", (evt) => pushThreshold(evt, id));

    const calibrateBtn = el.querySelector(".calibrate-btn");
    if (calibrateBtn) calibrateBtn.addEventListener("click", () => calibrateDevice(id, calibrateBtn));

    const saveEntitiesBtn = el.querySelector(".save-entities-btn");
    if (saveEntitiesBtn) saveEntitiesBtn.addEventListener("click", () => saveEntityIds(id, el));
  }

  for (const d of devices) {
    if (d.status === "queued" || d.status === "running") pollDevice(d.id);
    if (d.status === "success") refreshLiveState(d.id);
  }
}

async function refreshLiveState(id) {
  const block = document.querySelector(`.live-block[data-live-id="${id}"]`);
  if (!block) return;
  const motionEl = block.querySelector(".live-motion");
  const scoreEl = block.querySelector(".live-score");
  const thresholdInput = block.querySelector(".threshold-input");
  const errorEl = block.querySelector(".live-error");

  let state;
  try {
    state = await (await fetch(`api/devices/${id}/state`)).json();
  } catch (err) {
    state = { available: false, error: "Backend nicht erreichbar" };
  }

  if (!state.available) {
    motionEl.textContent = "nicht verfügbar";
    motionEl.className = "live-motion status status-warn";
    scoreEl.textContent = "—";
    errorEl.textContent = state.error || "Nicht verfügbar";
    errorEl.hidden = false;
    return;
  }

  errorEl.hidden = true;
  motionEl.textContent = state.motion ? "erkannt" : "frei";
  motionEl.className = `live-motion status ${state.motion ? "status-ok" : "status-pending"}`;
  scoreEl.textContent = state.movement_score != null ? state.movement_score.toFixed(2) : "—";
  if (state.threshold != null && document.activeElement !== thresholdInput) {
    thresholdInput.value = state.threshold;
  }
}

function refreshAllLiveStates() {
  for (const block of document.querySelectorAll(".live-block")) {
    refreshLiveState(block.dataset.liveId);
  }
}

async function pushThreshold(evt, id) {
  evt.preventDefault();
  const form = evt.target;
  const input = form.querySelector(".threshold-input");
  const value = Number(input.value);
  const errorEl = form.closest(".live-block").querySelector(".live-error");
  try {
    const res = await fetch(`api/devices/${id}/threshold`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      errorEl.textContent = body.detail || "Schwelle konnte nicht gesendet werden";
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;
  } catch (err) {
    errorEl.textContent = "Backend nicht erreichbar";
    errorEl.hidden = false;
  }
}

async function calibrateDevice(id, button) {
  const errorEl = button.closest(".live-block").querySelector(".live-error");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Kalibriert…";
  try {
    const res = await fetch(`api/devices/${id}/calibrate`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      errorEl.textContent = body.detail || "Kalibrierung konnte nicht ausgelöst werden";
      errorEl.hidden = false;
    } else {
      errorEl.hidden = true;
    }
  } catch (err) {
    errorEl.textContent = "Backend nicht erreichbar";
    errorEl.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function saveEntityIds(id, cardEl) {
  const patch = {};
  for (const input of cardEl.querySelectorAll(".entity-input")) {
    patch[input.dataset.field] = input.value || null;
  }
  try {
    const res = await fetch(`api/devices/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) refreshLiveState(id);
  } catch (err) {
    // Best-effort — the entity editor has no dedicated error slot; a failed
    // save just leaves the live state as before.
  }
}

async function startBuild(id) {
  try {
    const res = await fetch(`api/devices/${id}/build`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.detail || "Build konnte nicht gestartet werden");
      return;
    }
  } catch (err) {
    alert("Backend nicht erreichbar");
    return;
  }
  await loadDevices();
}

async function deleteDevice(id) {
  if (!confirm("Dieses Gerät löschen?")) return;
  await fetch(`api/devices/${id}`, { method: "DELETE" });
  await loadDevices();
}

function pollDevice(id) {
  if (activePolls.has(id)) return;
  activePolls.add(id);
  const tick = async () => {
    let device;
    try {
      device = await (await fetch(`api/devices/${id}`)).json();
    } catch (err) {
      activePolls.delete(id);
      return;
    }
    if (device.status === "queued" || device.status === "running") {
      setTimeout(tick, POLL_INTERVAL_MS);
    } else {
      activePolls.delete(id);
      await loadDevices();
    }
  };
  setTimeout(tick, POLL_INTERVAL_MS);
}

document.getElementById("device-form").addEventListener("submit", async (evt) => {
  evt.preventDefault();
  const errorEl = document.getElementById("device-form-error");
  errorEl.hidden = true;

  const form = evt.target;
  const data = Object.fromEntries(new FormData(form).entries());
  data.traffic_generator_rate = Number(data.traffic_generator_rate);
  if (!data.friendly_name) delete data.friendly_name;
  if (!data.wifi_password) delete data.wifi_password;

  try {
    const res = await fetch("api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = Array.isArray(body.detail)
        ? body.detail.map((e) => e.msg).join("; ")
        : body.detail || "Gerät konnte nicht angelegt werden";
      errorEl.textContent = detail;
      errorEl.hidden = false;
      return;
    }
    form.reset();
    await loadDevices();
  } catch (err) {
    errorEl.textContent = "Backend nicht erreichbar";
    errorEl.hidden = false;
  }
});

loadBoards();
loadDevices();
setInterval(refreshAllLiveStates, 5000);
