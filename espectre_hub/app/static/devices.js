// Device management + browser flashing (Phase 2).
//
// All API paths below are relative (no leading slash) so they stay under
// the Home Assistant Ingress token prefix — see app.js for why.

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
    select.innerHTML = '<option value="">Failed to load boards</option>';
  }
}

function statusLabel(status) {
  return { idle: "not built", queued: "queued…", running: "building…", success: "ready to flash", error: "build failed" }[status] || status;
}

function statusClass(status) {
  return { success: "status-ok", error: "status-err", running: "status-warn", queued: "status-warn" }[status] || "status-pending";
}

function renderDevice(device) {
  const c = device.config;
  const title = c.friendly_name || c.name;
  const canBuild = device.status !== "queued" && device.status !== "running";

  const logBlock = device.build_log
    ? `<details><summary>Build log</summary><pre class="build-log">${escapeHtml(device.build_log.slice(-4000))}</pre></details>`
    : "";
  const errorLine = device.build_error
    ? `<p class="status status-err">${escapeHtml(device.build_error)}</p>`
    : "";

  const flashBlock = device.status === "success"
    ? `<esp-web-install-button manifest="api/devices/${device.id}/manifest.json">
         <button slot="activate">Flash over USB</button>
         <span slot="unsupported">Your browser doesn't support Web Serial (use Chrome or Edge).</span>
         <span slot="not-allowed">Web Serial needs HTTPS or localhost — see the notice above.</span>
       </esp-web-install-button>`
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
        <button class="build-btn" ${canBuild ? "" : "disabled"}>${device.status === "success" ? "Rebuild" : "Build firmware"}</button>
        <button class="delete-btn">Delete</button>
      </div>
      ${flashBlock}
      ${logBlock}
    </div>`;
}

async function loadDevices() {
  const list = document.getElementById("device-list");
  let devices;
  try {
    devices = await (await fetch("api/devices")).json();
  } catch (err) {
    list.innerHTML = '<p class="status status-err">Failed to load devices</p>';
    return;
  }

  list.innerHTML = devices.length
    ? devices.map(renderDevice).join("")
    : '<p class="status status-pending">No devices yet — add one above.</p>';

  for (const el of list.querySelectorAll(".device-card")) {
    const id = el.dataset.id;
    el.querySelector(".build-btn").addEventListener("click", () => startBuild(id));
    el.querySelector(".delete-btn").addEventListener("click", () => deleteDevice(id));
  }

  for (const d of devices) {
    if (d.status === "queued" || d.status === "running") pollDevice(d.id);
  }
}

async function startBuild(id) {
  try {
    const res = await fetch(`api/devices/${id}/build`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.detail || "Failed to start build");
      return;
    }
  } catch (err) {
    alert("Failed to reach the backend");
    return;
  }
  await loadDevices();
}

async function deleteDevice(id) {
  if (!confirm("Delete this device?")) return;
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
        : body.detail || "Failed to add device";
      errorEl.textContent = detail;
      errorEl.hidden = false;
      return;
    }
    form.reset();
    await loadDevices();
  } catch (err) {
    errorEl.textContent = "Failed to reach the backend";
    errorEl.hidden = false;
  }
});

loadBoards();
loadDevices();
