// Alle API-Pfade sind relativ (ohne führenden Slash), damit sie unter dem
// Ingress-Token-Präfix von Home Assistant bleiben statt auf dessen Wurzel
// zu zeigen.

const OVERVIEW_REFRESH_MS = 10000;

// Shared by every script on the page. app.js is loaded first, so these are
// defined before devices.js, zones.js and dashboard.js run — each of which
// used to carry its own copy.
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

//: Seconds a person can read: "45 s", "3 min", "3 min 20 s".
function formatSeconds(seconds) {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return rest ? `${m} min ${rest} s` : `${m} min`;
  }
  return `${Math.round(seconds)} s`;
}

function switchTab(name) {
  const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  if (btn) btn.click();
}

function renderZones(zones) {
  const el = document.getElementById("overview-zones");
  const section = document.getElementById("overview-zones-section");

  if (!zones.length) {
    section.hidden = false;
    el.innerHTML =
      '<p class="hint">Noch keine Zonen. Erst eine Zone macht aus einzelnen ' +
      'Geräten einen Anwesenheitszustand, den Home Assistant nutzen kann. ' +
      '<button class="link-btn" data-goto="zones">Zone anlegen</button></p>';
    return;
  }

  section.hidden = false;
  el.innerHTML = zones
    .map((z) => {
      // Three states, not two: "hält" is occupied but counting down, and
      // conflating it with "belegt" hides why a zone is still on.
      let label, cls;
      if (!z.device_count) {
        // A zone with no members is not "unavailable" — the cause is known
        // and different, and saying so points at the fix.
        label = "keine Geräte";
        cls = "zone-pill-unknown";
      } else if (!z.available) {
        label = "nicht verfügbar";
        cls = "zone-pill-unknown";
      } else if (z.state === "holding") {
        label = `hält noch ${formatSeconds(z.hold_remaining)}`;
        cls = "zone-pill-holding";
      } else if (z.occupied) {
        label = "belegt";
        cls = "zone-pill-on";
      } else {
        label = "frei";
        cls = "zone-pill-off";
      }
      return `
        <button class="zone-pill ${cls}" data-goto="dashboard">
          <span class="zone-pill-name">${escapeHtml(z.name)}</span>
          <span class="zone-pill-state">${escapeHtml(label)}</span>
        </button>`;
    })
    .join("");
}

function renderProblems(problems) {
  const section = document.getElementById("overview-problems-section");
  const list = document.getElementById("overview-problems");
  if (!problems.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = problems
    .map(
      (p) => `
      <li class="problem">
        <span>${escapeHtml(p.message)}</span>
        <button class="link-btn" data-goto="${escapeHtml(p.tab)}">ansehen</button>
      </li>`
    )
    .join("");
}

function renderSystem(data) {
  const el = document.getElementById("overview-system");
  const rows = [];

  const d = data.devices;
  rows.push([
    "Geräte",
    d.total === 0
      ? "keine"
      : d.built === d.total
        ? plural(d.total, "Gerät", "Geräte")
        : `${plural(d.total, "Gerät", "Geräte")}, davon ${d.built} gebaut`,
  ]);

  // Every device probes the air continuously, so the fleet total is the
  // number that matters for the household's Wi-Fi, not the per-device one.
  if (d.total) {
    rows.push(["Funklast", `≈ ${data.radio_load_kb_per_second.toFixed(1)} KB/s insgesamt`]);
  }

  rows.push([
    "Zonen in Home Assistant",
    !data.mqtt.wanted
      ? "Export abgeschaltet"
      : data.mqtt.connected
        ? "werden exportiert"
        : "kein MQTT-Broker erreichbar",
  ]);

  // `esphome version` prints "Version: 2026.6.5"; with "ESPHome" already
  // as the term, the prefix reads as a stutter.
  const esphomeVersion = (data.esphome.version || "").replace(/^Version:\s*/i, "");
  rows.push([
    "ESPHome",
    data.esphome.available ? esphomeVersion || "installiert" : "nicht verfügbar",
  ]);

  el.innerHTML = rows
    .map(([term, value]) => `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
}

async function loadOverview() {
  const loading = document.getElementById("overview-loading");
  const empty = document.getElementById("overview-empty");
  const body = document.getElementById("overview-body");

  let data;
  try {
    const res = await fetch("api/overview");
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch (err) {
    loading.hidden = false;
    loading.textContent = "Backend nicht erreichbar";
    loading.className = "status status-err";
    body.hidden = true;
    empty.hidden = true;
    return;
  }

  loading.hidden = true;

  // With nothing set up, a status report has nothing to report — the
  // useful thing to show is the way in.
  const fresh = data.devices.total === 0 && data.zones.length === 0;
  empty.hidden = !fresh;
  body.hidden = fresh;
  if (fresh) return;

  renderZones(data.zones);
  renderProblems(data.problems);
  renderSystem(data);
}

// Any element can ask for a tab switch; that keeps the setup steps and the
// problem list from each needing their own wiring.
document.addEventListener("click", (evt) => {
  const target = evt.target.closest("[data-goto]");
  if (target) switchTab(target.dataset.goto);
});

for (const btn of document.querySelectorAll(".tab-btn")) {
  btn.addEventListener("click", () => {
    for (const b of document.querySelectorAll(".tab-btn")) b.classList.remove("active");
    btn.classList.add("active");
    for (const panel of document.querySelectorAll(".tab-panel")) panel.hidden = true;
    document.getElementById(`tab-${btn.dataset.tab}`).hidden = false;
    if (btn.dataset.tab === "overview") loadOverview();
  });
}

loadOverview();
setInterval(() => {
  // Only while the tab is actually showing: a hidden panel polling every
  // ten seconds costs Home Assistant requests for nothing.
  if (!document.getElementById("tab-overview").hidden) loadOverview();
}, OVERVIEW_REFRESH_MS);
