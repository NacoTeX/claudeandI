// Zonen: Geräte gruppieren, Präsenz per ODER-Verknüpfung (Phase 3).
//
// Alle API-Pfade sind relativ (ohne führenden Slash) — siehe app.js.

async function loadZoneDevicePicker() {
  const picker = document.getElementById("zone-device-picker");
  let devices;
  try {
    devices = await (await fetch("api/devices")).json();
  } catch (err) {
    picker.innerHTML = '<p class="status status-err">Geräte konnten nicht geladen werden</p>';
    return;
  }
  picker.innerHTML = devices.length
    ? devices
        .map(
          (d) => `
        <label class="zone-device-option">
          <input type="checkbox" name="device_ids" value="${d.id}">
          ${escapeHtml(d.config.friendly_name || d.config.name)}
        </label>`
        )
        .join("")
    : '<p class="status status-pending">Noch keine Geräte — lege zuerst im Tab „Geräte“ eines an.</p>';
}

function renderZone(zone) {
  const memberChips = zone.device_ids.length
    ? zone.device_ids.map((id) => `<span class="chip" data-member="${id}">…</span>`).join("")
    : '<span class="status status-pending">Keine Geräte in dieser Zone</span>';

  return `
    <div class="card zone-card" data-id="${zone.id}">
      <div class="device-card-header">
        <h3>${escapeHtml(zone.name)}</h3>
        <span class="status status-pending zone-status" data-zone-status="${zone.id}">wird geprüft…</span>
      </div>
      <div class="zone-members">${memberChips}</div>
      <div class="device-actions">
        <button class="delete-zone-btn">Löschen</button>
      </div>
    </div>`;
}

async function loadZones() {
  const list = document.getElementById("zone-list");
  let zoneList;
  try {
    zoneList = await (await fetch("api/zones")).json();
  } catch (err) {
    list.innerHTML = '<p class="status status-err">Zonen konnten nicht geladen werden</p>';
    return;
  }

  list.innerHTML = zoneList.length
    ? zoneList.map(renderZone).join("")
    : '<p class="status status-pending">Noch keine Zonen — lege oben eine an.</p>';

  for (const el of list.querySelectorAll(".zone-card")) {
    const id = el.dataset.id;
    el.querySelector(".delete-zone-btn").addEventListener("click", () => deleteZone(id));
    refreshZoneState(id);
  }
}

async function refreshZoneState(id) {
  const statusEl = document.querySelector(`[data-zone-status="${id}"]`);
  if (!statusEl) return;
  let state;
  try {
    state = await (await fetch(`api/zones/${id}/state`)).json();
  } catch (err) {
    statusEl.textContent = "nicht erreichbar";
    statusEl.className = "status status-err zone-status";
    return;
  }

  if (!state.available) {
    statusEl.textContent = "nicht verfügbar";
    statusEl.className = "status status-warn zone-status";
  } else {
    statusEl.textContent = state.occupied ? "belegt" : "frei";
    statusEl.className = `status zone-status ${state.occupied ? "status-ok" : "status-pending"}`;
  }

  const card = statusEl.closest(".zone-card");
  for (const member of state.members) {
    const chip = card.querySelector(`[data-member="${member.device_id}"]`);
    if (!chip) continue;
    const label = member.name || member.device_id.slice(0, 8);
    const flag = member.available ? (member.motion ? "●" : "○") : "?";
    chip.textContent = `${flag} ${label}`;
    chip.title = member.available ? "" : member.error || "nicht verfügbar";
  }
}

function refreshAllZoneStates() {
  for (const el of document.querySelectorAll(".zone-card")) {
    refreshZoneState(el.dataset.id);
  }
}

async function deleteZone(id) {
  if (!confirm("Diese Zone löschen?")) return;
  await fetch(`api/zones/${id}`, { method: "DELETE" });
  await loadZones();
}

document.getElementById("zone-form").addEventListener("submit", async (evt) => {
  evt.preventDefault();
  const errorEl = document.getElementById("zone-form-error");
  errorEl.hidden = true;

  const form = evt.target;
  const name = form.elements.name.value;
  const device_ids = Array.from(form.querySelectorAll('input[name="device_ids"]:checked')).map((el) => el.value);

  try {
    const res = await fetch("api/zones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, device_ids }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = Array.isArray(body.detail) ? body.detail.map((e) => e.msg).join("; ") : body.detail || "Zone konnte nicht angelegt werden";
      errorEl.textContent = detail;
      errorEl.hidden = false;
      return;
    }
    form.reset();
    await loadZones();
  } catch (err) {
    errorEl.textContent = "Backend nicht erreichbar";
    errorEl.hidden = false;
  }
});

document.querySelector('.tab-btn[data-tab="zones"]').addEventListener("click", loadZoneDevicePicker);

loadZoneDevicePicker();
loadZones();
setInterval(refreshAllZoneStates, 5000);
