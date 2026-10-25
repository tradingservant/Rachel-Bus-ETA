import {
  buildClusters,
  chooseCluster,
  companyLabel,
  ctbRouteStopUrl,
  ctbRouteUrl,
  ctbStopUrl,
  hongKongClock,
  kmbRouteStopUrl,
  kmbRouteUrl,
  kmbStopUrl,
  matchCluster,
  normalizeDest,
  planEtaQueries,
  presentEtas,
  rowsForSlot,
  stopHeading,
} from "./logic.js";

const STORAGE_STOP = "rachel-bus-eta:stop";
const STORAGE_META = "rachel-bus-eta:stop-meta:v1";
const META_TTL_MS = 24 * 60 * 60 * 1000;
const ETA_REFRESH_MS = 2 * 60 * 1000;
const KMB_ROUTES = ["299X", "99"];
const SERVICE_TYPES = ["1", "2", "3", "4"];
const DIRECTIONS = [
  { path: "outbound", code: "O" },
  { path: "inbound", code: "I" },
];

const els = {
  date: document.querySelector("#date"),
  weekday: document.querySelector("#weekday"),
  clock: document.querySelector("#clock"),
  stopButton: document.querySelector("#stop-button"),
  stopLabel: document.querySelector("#stop-label"),
  status: document.querySelector("#status"),
  routes: document.querySelector("#routes"),
  updated: document.querySelector("#updated"),
  refresh: document.querySelector("#refresh"),
  picker: document.querySelector("#picker"),
  pickerClose: document.querySelector("#picker-close"),
  search: document.querySelector("#search"),
  stopList: document.querySelector("#stop-list"),
  pickerCount: document.querySelector("#picker-count"),
};

let destOverrides = null;

const state = {
  clusters: [],
  selectedId: null,
  slots: [],
  rowsByQuery: new Map(),
  slotErrors: new Map(),
  indexError: "",
  loadingIndex: true,
  loadingEta: false,
  lastUpdated: null,
  etaToken: 0,
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

async function fetchJson(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (error.status && error.status < 500) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, run));
  return results;
}

function readMetaCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_META) || "null");
    if (!parsed || Date.now() - parsed.savedAt > META_TTL_MS) return {};
    return parsed.items || {};
  } catch {
    return {};
  }
}

function writeMetaCache(items) {
  try {
    localStorage.setItem(STORAGE_META, JSON.stringify({ savedAt: Date.now(), items }));
  } catch {
    /* private mode or a full quota should not block ETAs */
  }
}

function selectedCluster() {
  return state.clusters.find((cluster) => cluster.id === state.selectedId) || null;
}

function planFor(cluster) {
  const plan = planEtaQueries(cluster);
  if (!destOverrides) return plan;
  for (const slot of plan.slots) {
    const live = destOverrides[slot.route]?.[slot.dir];
    if (live) slot.fallbackDest = live;
  }
  return plan;
}

function setStatus(message) {
  if (!message) {
    els.status.hidden = true;
    els.status.textContent = "";
    return;
  }
  els.status.hidden = false;
  els.status.textContent = message;
}

function renderClock(now = new Date()) {
  const parts = hongKongClock(now);
  els.date.textContent = parts.date;
  els.weekday.textContent = parts.weekday;
  els.clock.textContent = parts.clock;
  if (state.lastUpdated && !state.loadingEta) {
    els.updated.textContent = `更新 ${hongKongClock(state.lastUpdated).clock}`;
  }
}

function renderStopLabel() {
  const cluster = selectedCluster();
  if (!cluster) {
    els.stopLabel.textContent = state.loadingIndex ? "載入車站…" : "選擇車站";
    return;
  }
  els.stopLabel.textContent = stopHeading(cluster, state.slots);
}

function renderRoutes(now = new Date()) {
  const cluster = selectedCluster();
  renderStopLabel();
  if (state.loadingIndex) {
    els.routes.innerHTML = `<p class="hint">正在讀取 299X、99、580 的車站…</p>`;
    return;
  }
  if (state.indexError) {
    els.routes.innerHTML = `
      <div class="empty">
        <p>${esc(state.indexError)}</p>
        <button id="retry" type="button">重試</button>
      </div>`;
    document.querySelector("#retry")?.addEventListener("click", () => {
      loadIndex();
    });
    return;
  }
  if (!cluster || !state.slots.length) {
    els.routes.innerHTML = `<p class="hint">此站沒有 299X、99 或 580。</p>`;
    return;
  }

  const groups = [];
  for (const slot of state.slots) {
    let group = groups.find((item) => item.route === slot.route);
    if (!group) {
      group = { route: slot.route, co: slot.co, slots: [] };
      groups.push(group);
    }
    group.slots.push(slot);
  }

  els.routes.innerHTML = groups.map((group) => {
    const dirs = group.slots.map((slot) => renderDirection(slot, now)).join("");
    return `
      <section class="route">
        <div class="route-head">
          <h2>${esc(group.route)}</h2>
          <span class="co">${esc(companyLabel(group.co))}</span>
        </div>
        ${dirs}
      </section>`;
  }).join("");
}

function renderDirection(slot, now) {
  const failed = state.slotErrors.get(`${slot.route}|${slot.dir}`);
  const ready = slot.queryKeys.every((key) => state.rowsByQuery.has(key));
  let body;
  let note = "";
  let dest = slot.fallbackDest;
  if (failed) {
    body = `<span class="empty-eta">未能取得</span>`;
  } else if (!ready) {
    body = `<span class="empty-eta">…</span>`;
  } else {
    const presented = presentEtas(rowsForSlot(slot, state.rowsByQuery), now.getTime());
    if (presented.dest) dest = presented.dest;
    if (!presented.times.length) {
      body = `<span class="empty-eta">${esc(presented.emptyText)}</span>`;
    } else {
      body = presented.times.map((time) => `
        <span class="time${time.soon ? " soon" : ""}">${esc(time.label)}</span>`).join("");
      const notes = [...new Set(presented.times.map((time) => time.rmk).filter(Boolean))];
      if (notes.length) note = `<div class="dir-note">${esc(notes.join("、"))}</div>`;
    }
  }
  return `
    <div class="dir-block">
      <div class="dir">
        <span class="dest">往${esc(dest)}</span>
        <span class="times">${body}</span>
      </div>
      ${note}
    </div>`;
}

function renderPicker() {
  const query = els.search.value;
  const visible = state.clusters.filter((cluster) => matchCluster(cluster, query));
  els.pickerCount.textContent = state.clusters.length ? `${state.clusters.length} 個車站` : "";
  if (!state.clusters.length) {
    els.stopList.innerHTML = `<li class="stop-empty">車站清單載入中…</li>`;
    return;
  }
  if (!visible.length) {
    els.stopList.innerHTML = `<li class="stop-empty">找不到「${esc(query.trim())}」</li>`;
    return;
  }
  els.stopList.innerHTML = visible.map((cluster) => {
    const selected = cluster.id === state.selectedId;
    const alias = cluster.aliases.length ? `其他名稱：${cluster.aliases.join("、")}` : "";
    const meta = [cluster.routes.join(" · "), alias].filter(Boolean).join("　");
    return `
      <li>
        <button type="button" class="stop-option${selected ? " selected" : ""}" data-id="${esc(cluster.id)}" aria-current="${selected ? "true" : "false"}">
          <span>
            <span class="stop-name">${esc(cluster.name)}</span>
            <span class="stop-meta">${esc(meta)}</span>
          </span>
          <span class="tick" aria-hidden="true">${selected ? "✓" : ""}</span>
        </button>
      </li>`;
  }).join("");
}

function openPicker() {
  els.picker.hidden = false;
  document.body.classList.add("picker-open");
  renderPicker();
  els.search.focus();
}

function closePicker() {
  els.picker.hidden = true;
  document.body.classList.remove("picker-open");
  els.stopButton.focus();
}

function selectCluster(id, { persist = true, refresh = true } = {}) {
  const cluster = state.clusters.find((item) => item.id === id);
  if (!cluster) return;
  state.selectedId = cluster.id;
  state.rowsByQuery = new Map();
  state.slotErrors = new Map();
  state.slots = planFor(cluster).slots;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_STOP, cluster.id);
    } catch {
      /* ignore */
    }
  }
  renderRoutes();
  renderPicker();
  if (refresh) refreshEta();
}

async function loadRouteStops() {
  const jobs = [];
  for (const route of KMB_ROUTES) {
    for (const direction of DIRECTIONS) {
      for (const serviceType of SERVICE_TYPES) {
        jobs.push({ co: "KMB", route, direction, serviceType });
      }
    }
  }
  for (const direction of DIRECTIONS) {
    jobs.push({ co: "CTB", route: "580", direction, serviceType: "1" });
  }

  const settled = await mapPool(jobs, 6, async (job) => {
    const url = job.co === "KMB"
      ? kmbRouteStopUrl(job.route, job.direction.path, job.serviceType)
      : ctbRouteStopUrl(job.route, job.direction.path);
    try {
      const json = await fetchJson(url);
      const rows = Array.isArray(json?.data) ? json.data : [];
      return rows.map((row) => ({
        co: job.co,
        route: String(row.route || job.route),
        dir: row.bound || row.dir || job.direction.code,
        serviceType: String(row.service_type || job.serviceType),
        seq: Number(row.seq) || 0,
        stop: String(row.stop || ""),
      })).filter((row) => row.stop && (row.dir === "O" || row.dir === "I"));
    } catch (error) {
      if (error.status !== 422) console.error(error);
      return [];
    }
  });
  return settled.flat();
}

async function loadStopMeta(bindings) {
  const wanted = new Map();
  for (const binding of bindings) {
    wanted.set(`${binding.co}:${binding.stop}`, binding);
  }
  const cache = readMetaCache();
  const missing = [...wanted.values()].filter((binding) => !cache[`${binding.co}:${binding.stop}`]);
  const fetched = await mapPool(missing, 6, async (binding) => {
    const key = `${binding.co}:${binding.stop}`;
    try {
      const url = binding.co === "KMB" ? kmbStopUrl(binding.stop) : ctbStopUrl(binding.stop);
      const json = await fetchJson(url);
      const data = json?.data;
      if (!data || typeof data !== "object") throw new Error("stop");
      return {
        key,
        value: {
          nameTc: data.name_tc || data.name_en || binding.stop,
          nameEn: data.name_en || "",
          lat: Number(data.lat),
          lon: Number(data.long),
        },
      };
    } catch (error) {
      console.error(error);
      return { key, value: { nameTc: binding.stop, nameEn: "", lat: NaN, lon: NaN } };
    }
  });
  const items = { ...cache };
  for (const item of fetched) {
    if (item?.key) items[item.key] = item.value;
  }
  if (fetched.length) writeMetaCache(items);
  return items;
}

async function loadDestinations() {
  const dest = {
    "299X": { O: "西貢", I: "沙田市中心" },
    "99": { O: "西貢", I: "恆安" },
    "580": { O: "沙田市中心", I: "西沙灣" },
  };
  const jobs = [];
  for (const route of KMB_ROUTES) {
    for (const direction of DIRECTIONS) {
      jobs.push(fetchJson(kmbRouteUrl(route, direction.path, "1")).then((json) => {
        const data = json?.data;
        if (data?.dest_tc) dest[route][data.bound || direction.code] = normalizeDest(data.dest_tc);
      }).catch(() => {}));
    }
  }
  jobs.push(fetchJson(ctbRouteUrl("580")).then((json) => {
    const data = Array.isArray(json?.data) ? json.data[0] : json?.data;
    if (!data) return;
    if (data.dest_tc) dest["580"].O = normalizeDest(data.dest_tc);
    if (data.orig_tc) dest["580"].I = normalizeDest(data.orig_tc);
  }).catch(() => {}));
  await Promise.all(jobs);
  return dest;
}

function polesFrom(bindings, meta) {
  const byStop = new Map();
  for (const binding of bindings) {
    const info = meta[`${binding.co}:${binding.stop}`] || {
      nameTc: binding.stop,
      nameEn: "",
      lat: NaN,
      lon: NaN,
    };
    let pole = byStop.get(binding.stop);
    if (!pole) {
      pole = {
        co: binding.co,
        stop: binding.stop,
        nameTc: info.nameTc,
        nameEn: info.nameEn,
        lat: info.lat,
        lon: info.lon,
        bindings: [],
      };
      byStop.set(binding.stop, pole);
    }
    const duplicate = pole.bindings.some((item) => (
      item.route === binding.route && item.dir === binding.dir && item.serviceType === binding.serviceType
    ));
    if (!duplicate) {
      pole.bindings.push({
        route: binding.route,
        dir: binding.dir,
        serviceType: binding.serviceType,
        seq: binding.seq,
      });
    }
  }
  return [...byStop.values()];
}

async function loadIndex() {
  state.loadingIndex = true;
  state.indexError = "";
  setStatus("");
  renderRoutes();
  try {
    const [bindings, destinations] = await Promise.all([loadRouteStops(), loadDestinations()]);
    if (!bindings.length) throw new Error("empty");
    destOverrides = destinations;
    const meta = await loadStopMeta(bindings);
    state.clusters = buildClusters(polesFrom(bindings, meta));
    const saved = localStorage.getItem(STORAGE_STOP);
    const cluster = chooseCluster(state.clusters, saved);
    state.loadingIndex = false;
    if (cluster) selectCluster(cluster.id, { persist: saved !== cluster.id, refresh: true });
    else renderRoutes();
    renderPicker();
  } catch (error) {
    console.error(error);
    state.loadingIndex = false;
    state.indexError = "暫時讀不到車站資料。請檢查網絡後再試。";
    setStatus("");
    renderRoutes();
  }
}

async function refreshEta() {
  const cluster = selectedCluster();
  if (!cluster) return;
  const plan = planFor(cluster);
  state.slots = plan.slots;
  const token = state.etaToken + 1;
  state.etaToken = token;
  state.loadingEta = true;
  els.updated.textContent = "更新中…";
  renderRoutes();
  const nextRows = new Map();
  const nextErrors = new Map();
  await Promise.all(plan.queries.map(async (query) => {
    try {
      const json = await fetchJson(query.url);
      nextRows.set(query.key, Array.isArray(json?.data) ? json.data : []);
    } catch (error) {
      console.error(error);
      nextRows.set(query.key, []);
      nextErrors.set(query.key, true);
    }
  }));
  if (token !== state.etaToken) return;
  state.rowsByQuery = nextRows;
  state.slotErrors = new Map();
  for (const slot of state.slots) {
    if (slot.queryKeys.every((key) => nextErrors.get(key))) {
      state.slotErrors.set(`${slot.route}|${slot.dir}`, true);
    }
  }
  state.loadingEta = false;
  state.lastUpdated = new Date();
  const failedAll = state.slots.length > 0 && state.slots.every((slot) => state.slotErrors.get(`${slot.route}|${slot.dir}`));
  setStatus(failedAll ? "暫時未能取得班次。請稍後再試。" : "");
  renderRoutes(state.lastUpdated);
}

function bindUi() {
  els.stopButton.addEventListener("click", openPicker);
  els.pickerClose.addEventListener("click", closePicker);
  els.search.addEventListener("input", renderPicker);
  els.stopList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-id]");
    if (!button) return;
    selectCluster(button.dataset.id);
    closePicker();
  });
  els.refresh.addEventListener("click", () => {
    if (!state.loadingIndex) refreshEta();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.picker.hidden) closePicker();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || state.loadingIndex) return;
    const age = state.lastUpdated ? Date.now() - state.lastUpdated.getTime() : Infinity;
    if (age > 30_000) refreshEta();
  });
}

function registerSw() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

function main() {
  renderClock();
  setInterval(() => {
    const previous = els.clock.textContent;
    renderClock();
    if (els.clock.textContent !== previous && state.rowsByQuery.size) renderRoutes();
  }, 1000);
  bindUi();
  registerSw();
  loadIndex();
}

main();
