/**
 * Pure helpers for Rachel Bus ETA.
 *
 * Stop picker model:
 * - Group poles that share a Chinese place name (strip KMB stop codes,
 *   Citybus road suffixes, and 總站) so both curbs and both operators
 *   become one choice. 輋下 (SK302) / 輋下 (SK219) / 輋下, 西沙路 → 輋下.
 * - Also join a differently named pole within COMPANION_RADIUS_METERS.
 *   Citybus calls the Sha Tin-bound curb at 輋下「官坑」(~30m away); the
 *   reference dashboard shows that direction under 輋下. Distinct villages
 *   further apart (泥涌 vs 西澳, ~180m) stay separate.
 */

export const ROUTE_ORDER = ["299X", "99", "580"];

export const COMPANY_OF = {
  "299X": "KMB",
  "99": "KMB",
  "580": "CTB",
};

export const COMPANY_LABEL = {
  KMB: "九巴",
  CTB: "城巴",
};

export const FALLBACK_DEST = {
  "299X": { O: "西貢", I: "沙田市中心" },
  "99": { O: "西貢", I: "恆安" },
  "580": { O: "沙田市中心", I: "西沙灣" },
};

export const COMPANION_RADIUS_METERS = 40;
export const ETA_LIMIT = 3;

export const KMB_BASE = "https://data.etabus.gov.hk/v1/transport/kmb";
export const CTB_BASE = "https://rt.data.gov.hk/v2/transport/citybus";

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

export function kmbRouteStopUrl(route, direction, serviceType) {
  return `${KMB_BASE}/route-stop/${encodeURIComponent(route)}/${direction}/${serviceType}`;
}

export function kmbStopUrl(stopId) {
  return `${KMB_BASE}/stop/${encodeURIComponent(stopId)}`;
}

export function kmbEtaUrl(stopId, route, serviceType) {
  return `${KMB_BASE}/eta/${encodeURIComponent(stopId)}/${encodeURIComponent(route)}/${serviceType}`;
}

export function kmbRouteUrl(route, direction, serviceType) {
  return `${KMB_BASE}/route/${encodeURIComponent(route)}/${direction}/${serviceType}`;
}

export function ctbRouteStopUrl(route, direction) {
  return `${CTB_BASE}/route-stop/CTB/${encodeURIComponent(route)}/${direction}`;
}

export function ctbStopUrl(stopId) {
  return `${CTB_BASE}/stop/${encodeURIComponent(stopId)}`;
}

export function ctbEtaUrl(stopId, route) {
  return `${CTB_BASE}/eta/CTB/${encodeURIComponent(stopId)}/${encodeURIComponent(route)}`;
}

export function ctbRouteUrl(route) {
  return `${CTB_BASE}/route/CTB/${encodeURIComponent(route)}`;
}

export function normalizeDest(name) {
  return String(name || "").trim().replace(/巿/g, "市");
}

export function friendlyName(name) {
  let s = String(name || "").normalize("NFKC").trim().replace(/巿/g, "市");
  s = s.replace(/\s*\([A-Za-z]{1,4}\d{2,4}\)\s*$/u, "");
  s = s.replace(/\s+/g, "");
  s = s.split(/[，,]/)[0];
  return s;
}

export function normalizePlaceName(name) {
  return friendlyName(name).replace(/巴士總站$/u, "").replace(/總站$/u, "");
}

export function haversineMeters(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const h = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function commonPrefix(values) {
  if (!values.length) return "";
  let prefix = values[0];
  for (const value of values.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < value.length && prefix[i] === value[i]) i += 1;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix;
}

export function clusterDisplayName(poles) {
  const counts = new Map();
  const keys = new Set();
  for (const pole of poles) {
    const friendly = friendlyName(pole.nameTc);
    if (!friendly) continue;
    counts.set(friendly, (counts.get(friendly) || 0) + 1);
    keys.add(normalizePlaceName(pole.nameTc));
  }
  const names = [...counts.keys()];
  if (!names.length) return "未命名車站";
  if (keys.size <= 1) {
    return names
      .slice()
      .sort((a, b) => a.length - b.length || a.localeCompare(b, "zh-Hant-HK"))[0];
  }
  const prefix = commonPrefix(names).replace(/[-－–—·・\s]+$/u, "");
  if ([...prefix].length >= 3) return prefix;
  const max = Math.max(...counts.values());
  const top = names.filter((name) => counts.get(name) === max);
  if (top.length === 1) return top[0];
  return top.slice().sort((a, b) => a.localeCompare(b, "zh-Hant-HK")).join(" · ");
}

export function clusterIdFromPoles(poles) {
  const keys = new Set();
  for (const pole of poles) {
    const key = normalizePlaceName(pole.nameTc);
    if (key) keys.add(key);
  }
  if (!keys.size) return poles.map((pole) => pole.stop).sort().join("|");
  return [...keys].sort((a, b) => a.localeCompare(b, "zh-Hant-HK")).join("|");
}

export function destinationLongitudes(poles) {
  const groups = new Map();
  for (const pole of poles) {
    for (const binding of pole.bindings) {
      const key = `${binding.route}|${binding.dir}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({
        seq: Number(binding.seq) || 0,
        lon: Number(pole.lon),
        svc: String(binding.serviceType || ""),
      });
    }
  }
  const out = {};
  for (const [key, list] of groups) {
    const primary = list.filter((item) => item.svc === "1");
    const use = (primary.length ? primary : list)
      .filter((item) => Number.isFinite(item.lon))
      .sort((a, b) => b.seq - a.seq);
    if (use.length) out[key] = use[0].lon;
  }
  return out;
}

export function buildClusters(poles, radiusMeters = COMPANION_RADIUS_METERS) {
  const parent = poles.map((_, index) => index);
  const find = (index) => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < poles.length; i += 1) {
    for (let j = i + 1; j < poles.length; j += 1) {
      const a = poles[i];
      const b = poles[j];
      const samePlace = normalizePlaceName(a.nameTc) && normalizePlaceName(a.nameTc) === normalizePlaceName(b.nameTc);
      const near = haversineMeters(Number(a.lat), Number(a.lon), Number(b.lat), Number(b.lon)) <= radiusMeters;
      if (samePlace || near) union(i, j);
    }
  }

  const grouped = new Map();
  poles.forEach((pole, index) => {
    const root = find(index);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(pole);
  });

  const destLon = destinationLongitudes(poles);
  const clusters = [];
  for (const members of grouped.values()) {
    const name = clusterDisplayName(members);
    const id = clusterIdFromPoles(members);
    const aliases = [];
    const searchParts = new Set([name, id]);
    const routes = new Set();
    const bindings = [];
    for (const pole of members) {
      const friendly = friendlyName(pole.nameTc);
      let alias = friendly;
      if (alias.startsWith(name)) {
        alias = alias.slice(name.length).replace(/^[-－–—·・\s]+/u, "");
      }
      if (alias === "總站" || alias === "巴士總站") alias = "";
      if (alias && alias !== name && !name.includes(alias) && !aliases.includes(alias)) {
        aliases.push(alias);
      }
      searchParts.add(pole.nameTc || "");
      searchParts.add(friendly);
      searchParts.add(normalizePlaceName(pole.nameTc));
      searchParts.add(pole.nameEn || "");
      searchParts.add(pole.stop || "");
      for (const binding of pole.bindings) {
        routes.add(binding.route);
        searchParts.add(binding.route);
        bindings.push({
          co: pole.co,
          stop: pole.stop,
          route: binding.route,
          dir: binding.dir,
          serviceType: String(binding.serviceType || "1"),
          seq: Number(binding.seq) || 0,
        });
      }
    }
    aliases.sort((a, b) => a.localeCompare(b, "zh-Hant-HK"));
    const routeList = ROUTE_ORDER.filter((route) => routes.has(route));
    clusters.push({
      id,
      name,
      aliases,
      routes: routeList,
      search: [...searchParts].join(" ").toLowerCase(),
      bindings,
      destLon,
    });
  }

  clusters.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant-HK") || a.id.localeCompare(b.id));
  return clusters;
}

export function chooseCluster(clusters, savedId) {
  if (!clusters.length) return null;
  if (savedId) {
    const saved = clusters.find((cluster) => cluster.id === savedId);
    if (saved) return saved;
  }
  const cheHa = clusters.find((cluster) => cluster.name === "輋下" || cluster.id.split("|").includes("輋下"));
  return cheHa || clusters[0];
}

export function matchCluster(cluster, query) {
  const q = String(query || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!q) return true;
  return cluster.search.replace(/\s+/g, "").includes(q);
}

function orderDirs(cluster, route, dirs) {
  return dirs.slice().sort((a, b) => {
    const lonA = cluster.destLon?.[`${route}|${a}`];
    const lonB = cluster.destLon?.[`${route}|${b}`];
    if (!Number.isFinite(lonA) || !Number.isFinite(lonB) || Math.abs(lonA - lonB) < 0.002) {
      if (a === b) return 0;
      return a === "O" ? -1 : 1;
    }
    return lonB - lonA;
  });
}

export function planEtaQueries(cluster) {
  const slots = [];
  const queries = new Map();
  for (const route of ROUTE_ORDER) {
    const dirs = ["O", "I"].filter((dir) => cluster.bindings.some((binding) => binding.route === route && binding.dir === dir));
    for (const dir of orderDirs(cluster, route, dirs)) {
      const matches = cluster.bindings
        .filter((binding) => binding.route === route && binding.dir === dir)
        .slice()
        .sort((a, b) => a.seq - b.seq || a.stop.localeCompare(b.stop));
      if (!matches.length) continue;
      const chosenStop = matches[0].stop;
      const co = matches[0].co || COMPANY_OF[route];
      const serviceTypes = [...new Set(matches.filter((binding) => binding.stop === chosenStop).map((binding) => String(binding.serviceType || "1")))];
      const chosenServices = serviceTypes.includes("1") ? ["1"] : serviceTypes;
      const queryKeys = [];
      for (const serviceType of chosenServices) {
        const key = co === "CTB" ? `CTB|${chosenStop}|${route}` : `KMB|${chosenStop}|${route}|${serviceType}`;
        queryKeys.push(key);
        if (!queries.has(key)) {
          queries.set(key, {
            key,
            co,
            stop: chosenStop,
            route,
            serviceType,
            url: co === "CTB" ? ctbEtaUrl(chosenStop, route) : kmbEtaUrl(chosenStop, route, serviceType),
          });
        }
      }
      slots.push({
        route,
        dir,
        co,
        stop: chosenStop,
        queryKeys,
        fallbackDest: FALLBACK_DEST[route]?.[dir] || "",
      });
    }
  }
  return { slots, queries: [...queries.values()] };
}

export function formatEta(isoOrMs, nowMs) {
  const time = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(time)) return null;
  const diff = time - nowMs;
  if (diff < -60_000) return null;
  if (diff < 60_000) return { label: "即將", soon: true };
  const minutes = Math.floor(diff / 60_000);
  return { label: `${minutes} 分鐘`, soon: false };
}

export function presentEtas(rows, nowMs) {
  const timed = [];
  const remarkOnly = [];
  let dest = "";
  for (const row of rows || []) {
    const remark = String(row?.rmk_tc || "").trim();
    if (!dest && row?.dest_tc) dest = normalizeDest(row.dest_tc);
    if (row?.eta) {
      const time = Date.parse(row.eta);
      if (!Number.isFinite(time) || time < nowMs - 60_000) continue;
      timed.push({
        time,
        remark,
        etaSeq: Number(row.eta_seq) || 0,
      });
    } else if (remark) {
      remarkOnly.push(remark);
    }
  }
  timed.sort((a, b) => a.time - b.time || a.etaSeq - b.etaSeq);
  const kept = [];
  for (const item of timed) {
    if (kept.some((existing) => Math.abs(existing.time - item.time) < 45_000)) continue;
    const formatted = formatEta(item.time, nowMs);
    if (!formatted) continue;
    kept.push({ ...item, ...formatted });
    if (kept.length >= ETA_LIMIT) break;
  }
  const times = kept.map((item) => ({
    label: item.label,
    soon: item.soon,
    rmk: item.remark,
  }));
  if (!times.length) {
    const notes = [...new Set(remarkOnly)];
    return {
      dest,
      times: [],
      emptyText: notes.length ? notes.join("、") : "暫無班次",
    };
  }
  return { dest, times, emptyText: "" };
}

export function rowsForSlot(slot, rowsByQuery) {
  const rows = [];
  for (const key of slot.queryKeys) {
    for (const row of rowsByQuery.get(key) || []) {
      const dir = row?.dir || row?.bound;
      if (dir && dir !== slot.dir) continue;
      if (row?.route && String(row.route) !== String(slot.route)) continue;
      rows.push(row);
    }
  }
  return rows;
}

export function hongKongClock(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const weekdayToken = get("weekday");
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayToken);
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return {
    date: `${get("year")}年${Number(get("month"))}月${Number(get("day"))}日`,
    weekday: WEEKDAYS[weekdayIndex] || "",
    clock: `${hour.padStart(2, "0")}:${get("minute").padStart(2, "0")}`,
  };
}

export function stopHeading(cluster, slots) {
  const bothWays = ROUTE_ORDER.some((route) => {
    const dirs = new Set((slots || []).filter((slot) => slot.route === route).map((slot) => slot.dir));
    return dirs.has("O") && dirs.has("I");
  });
  return bothWays ? `${cluster.name} · 來回` : cluster.name;
}

export function companyLabel(co) {
  return COMPANY_LABEL[co] || "";
}
