import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClusters,
  chooseCluster,
  friendlyName,
  formatEta,
  hongKongClock,
  matchCluster,
  normalizePlaceName,
  planEtaQueries,
  presentEtas,
  rowsForSlot,
  stopHeading,
} from "../js/logic.js";

function pole(partial) {
  return {
    co: "KMB",
    nameEn: "",
    lat: 0,
    lon: 0,
    bindings: [],
    ...partial,
  };
}

const poles = [
  pole({
    co: "KMB",
    stop: "SK302",
    nameTc: "輋下 (SK302)",
    nameEn: "CHE HA",
    lat: 22.428921,
    lon: 114.260874,
    bindings: [
      { route: "299X", dir: "O", serviceType: "1", seq: 12 },
      { route: "99", dir: "O", serviceType: "1", seq: 9 },
    ],
  }),
  pole({
    co: "KMB",
    stop: "SK219",
    nameTc: "輋下 (SK219)",
    nameEn: "CHE HA",
    lat: 22.427976,
    lon: 114.261308,
    bindings: [
      { route: "299X", dir: "I", serviceType: "1", seq: 14 },
      { route: "299X", dir: "I", serviceType: "2", seq: 15 },
      { route: "99", dir: "I", serviceType: "1", seq: 15 },
    ],
  }),
  pole({
    co: "CTB",
    stop: "003829",
    nameTc: "輋下, 西沙路",
    nameEn: "Che Ha, Sai Sha Road",
    lat: 22.428951,
    lon: 114.260784,
    bindings: [{ route: "580", dir: "I", serviceType: "1", seq: 8 }],
  }),
  pole({
    co: "CTB",
    stop: "003833",
    nameTc: "官坑, 西沙路",
    nameEn: "Kwun Hang, Sai Sha Road",
    lat: 22.428665,
    lon: 114.260886,
    bindings: [{ route: "580", dir: "O", serviceType: "1", seq: 3 }],
  }),
  pole({
    co: "KMB",
    stop: "SK301",
    nameTc: "泥涌 (SK301)",
    nameEn: "NAI CHUNG",
    lat: 22.430622,
    lon: 114.256823,
    bindings: [{ route: "299X", dir: "O", serviceType: "1", seq: 11 }],
  }),
  pole({
    co: "CTB",
    stop: "003834",
    nameTc: "西澳, 西沙路",
    nameEn: "Sai O, Sai Sha Road",
    lat: 22.430592,
    lon: 114.254997,
    bindings: [{ route: "580", dir: "O", serviceType: "1", seq: 4 }],
  }),
  pole({
    co: "KMB",
    stop: "ST911",
    nameTc: "沙田市中心總站 (ST911)",
    nameEn: "SHATIN CENTRAL BUS TERMINUS",
    lat: 22.382373,
    lon: 114.188294,
    bindings: [
      { route: "299X", dir: "O", serviceType: "1", seq: 1 },
      { route: "299X", dir: "I", serviceType: "1", seq: 24 },
    ],
  }),
  pole({
    co: "CTB",
    stop: "002046",
    nameTc: "沙田市中心",
    nameEn: "Shatin Central",
    lat: 22.381835,
    lon: 114.187789,
    bindings: [
      { route: "580", dir: "O", serviceType: "1", seq: 8 },
      { route: "580", dir: "I", serviceType: "1", seq: 1 },
    ],
  }),
  pole({
    co: "KMB",
    stop: "MA922",
    nameTc: "恆安巴士總站 (MA922)",
    nameEn: "HENG ON BUS TERMINUS",
    lat: 22.418177,
    lon: 114.228621,
    bindings: [{ route: "99", dir: "I", serviceType: "1", seq: 25 }],
  }),
  pole({
    co: "KMB",
    stop: "MA920",
    nameTc: "恆安巴士總站 (MA920)",
    nameEn: "HENG ON BUS TERMINUS",
    lat: 22.417949,
    lon: 114.228322,
    bindings: [{ route: "99", dir: "I", serviceType: "1", seq: 24 }],
  }),
  pole({
    co: "KMB",
    stop: "ST148",
    nameTc: "石門轉車站 - 濱景花園 (ST148)",
    nameEn: "SHEK MUN BBI - RAVANA GARDEN",
    lat: 22.391566,
    lon: 114.206129,
    bindings: [{ route: "299X", dir: "O", serviceType: "1", seq: 5 }],
  }),
  pole({
    co: "KMB",
    stop: "ST500",
    nameTc: "石門轉車站-新界鄉議局大樓",
    nameEn: "SHEK MUN BBI - HEUNG YEE KUK BUILDING",
    lat: 22.391394,
    lon: 114.206407,
    bindings: [{ route: "299X", dir: "I", serviceType: "1", seq: 20 }],
  }),
  pole({
    co: "KMB",
    stop: "SK905",
    nameTc: "西貢總站 (SK905)",
    nameEn: "SAI KUNG",
    lat: 22.382091,
    lon: 114.273817,
    bindings: [{ route: "299X", dir: "O", serviceType: "1", seq: 25 }],
  }),
];

test("normalizes KMB codes, road suffixes, and terminus markers", () => {
  assert.equal(friendlyName("輋下 (SK302)"), "輋下");
  assert.equal(friendlyName("輋下, 西沙路"), "輋下");
  assert.equal(normalizePlaceName("沙田巿中心總站 (ST911)"), "沙田市中心");
  assert.equal(normalizePlaceName("恆安巴士總站 (MA922)"), "恆安");
  assert.equal(friendlyName("恆安巴士總站 (MA922)"), "恆安巴士總站");
});

test("groups 輋下 with the Citybus curb named 官坑, and keeps 泥涌 apart from 西澳", () => {
  const clusters = buildClusters(poles);
  const cheHa = clusters.find((cluster) => cluster.name === "輋下");
  assert.ok(cheHa);
  assert.deepEqual(cheHa.aliases, ["官坑"]);
  assert.deepEqual(cheHa.routes, ["299X", "99", "580"]);
  assert.equal(clusters.some((cluster) => cluster.name === "官坑"), false);
  assert.ok(clusters.some((cluster) => cluster.name === "泥涌"));
  assert.ok(clusters.some((cluster) => cluster.name === "西澳"));
  const central = clusters.find((cluster) => cluster.id === "沙田市中心");
  assert.equal(central.name, "沙田市中心");
  assert.deepEqual(central.aliases, []);
  assert.deepEqual(central.routes, ["299X", "580"]);
  const hengOn = clusters.find((cluster) => cluster.name === "恆安巴士總站");
  assert.ok(hengOn);
  const shekMun = clusters.find((cluster) => cluster.name === "石門轉車站");
  assert.ok(shekMun);
  assert.ok(shekMun.aliases.includes("濱景花園"));
  assert.ok(shekMun.aliases.includes("新界鄉議局大樓"));
});

test("default stop is 輋下, and a saved id wins", () => {
  const clusters = buildClusters(poles);
  assert.equal(chooseCluster(clusters, null).name, "輋下");
  const saved = clusters.find((cluster) => cluster.name === "泥涌");
  assert.equal(chooseCluster(clusters, saved.id).name, "泥涌");
  assert.equal(chooseCluster(clusters, "missing").name, "輋下");
});

test("search matches Chinese aliases and English", () => {
  const cheHa = buildClusters(poles).find((cluster) => cluster.name === "輋下");
  assert.equal(matchCluster(cheHa, "官坑"), true);
  assert.equal(matchCluster(cheHa, "che ha"), true);
  assert.equal(matchCluster(cheHa, "西澳"), false);
  assert.equal(matchCluster(cheHa, "580"), true);
});

test("plans one query per direction and prefers service type 1 and the first stop", () => {
  const clusters = buildClusters(poles);
  const cheHa = clusters.find((cluster) => cluster.name === "輋下");
  const plan = planEtaQueries(cheHa);
  const inbound = plan.slots.find((slot) => slot.route === "299X" && slot.dir === "I");
  assert.equal(inbound.stop, "SK219");
  assert.deepEqual(inbound.queryKeys, ["KMB|SK219|299X|1"]);
  const citybusOut = plan.slots.find((slot) => slot.route === "580" && slot.dir === "O");
  assert.equal(citybusOut.stop, "003833");
  assert.equal(plan.slots[0].route, "299X");
  assert.equal(plan.slots.find((slot) => slot.route === "580").dir, "I");
  const hengOn = clusters.find((cluster) => cluster.name === "恆安巴士總站");
  const hengPlan = planEtaQueries(hengOn);
  assert.equal(hengPlan.slots.length, 1);
  assert.equal(hengPlan.slots[0].stop, "MA920");
  assert.equal(stopHeading(cheHa, plan.slots), "輋下 · 來回");
  assert.equal(stopHeading({ name: "泥涌" }, [
    { route: "299X", dir: "O" },
    { route: "99", dir: "O" },
    { route: "580", dir: "I" },
  ]), "泥涌");
});

test("formats Hong Kong clock and up to three ETAs", () => {
  const clock = hongKongClock(new Date("2026-10-25T00:26:00.000Z"));
  assert.deepEqual(clock, {
    date: "2026年10月25日",
    weekday: "星期日",
    clock: "08:26",
  });

  const now = Date.parse("2026-10-25T00:26:00.000Z");
  assert.deepEqual(formatEta("2026-10-25T08:26:20+08:00", now), { label: "即將", soon: true });
  assert.deepEqual(formatEta("2026-10-25T08:35:10+08:00", now), { label: "9 分鐘", soon: false });
  assert.equal(formatEta("2026-10-25T08:24:00+08:00", now), null);

  const presented = presentEtas([
    { dir: "O", route: "299X", eta_seq: 1, eta: "2026-10-25T08:26:30+08:00", dest_tc: "西貢", rmk_tc: "" },
    { dir: "O", route: "299X", eta_seq: 2, eta: "2026-10-25T08:26:50+08:00", dest_tc: "西貢", rmk_tc: "原定班次" },
    { dir: "O", route: "299X", eta_seq: 3, eta: "2026-10-25T08:35:00+08:00", dest_tc: "西貢", rmk_tc: "原定班次" },
    { dir: "O", route: "299X", eta_seq: 4, eta: "2026-10-25T08:46:00+08:00", dest_tc: "西貢", rmk_tc: "" },
    { dir: "O", route: "299X", eta_seq: 5, eta: "2026-10-25T09:00:00+08:00", dest_tc: "西貢", rmk_tc: "" },
  ], now);
  assert.equal(presented.dest, "西貢");
  assert.deepEqual(presented.times.map((time) => time.label), ["即將", "9 分鐘", "20 分鐘"]);
  assert.equal(presented.times[1].rmk, "原定班次");

  const slot = { route: "299X", dir: "I", queryKeys: ["q"] };
  const filtered = presentEtas(rowsForSlot(slot, new Map([["q", [
    { dir: "O", route: "299X", eta: "2026-10-25T08:40:00+08:00", dest_tc: "西貢", rmk_tc: "", eta_seq: 1 },
    { dir: "I", route: "299X", eta: null, dest_tc: "沙田巿中心", rmk_tc: "尾班車已過", eta_seq: 1 },
  ]]])), now);
  assert.equal(filtered.dest, "沙田市中心");
  assert.equal(filtered.emptyText, "尾班車已過");

  const none = presentEtas([{ eta: null, rmk_tc: "", dest_tc: "西貢" }], now);
  assert.equal(none.emptyText, "暫無班次");
});

test("lists stops from Sha Tin toward Sai Kung, with branches beside the join", () => {
  const stop = (name, lat, bindings) => pole({
    stop: name,
    nameTc: name,
    lat,
    lon: 114.2,
    bindings,
  });
  const on = (route, dir, seq) => ({ route, dir, serviceType: "1", seq });
  const ordered = buildClusters([
    stop("沙田市中心", 22.30, [on("299X", "O", 1), on("580", "I", 1)]),
    stop("好運中心", 22.31, [on("580", "I", 2)]),
    stop("麗豪酒店", 22.32, [on("299X", "O", 2)]),
    stop("錦駿苑", 22.33, [on("299X", "O", 9), on("580", "I", 5)]),
    stop("恆安", 22.34, [on("99", "O", 1)]),
    stop("樟木頭帝琴灣", 22.35, [on("299X", "O", 10), on("99", "O", 7), on("580", "I", 6), on("299X", "I", 10)]),
    stop("西澳", 22.36, [on("299X", "I", 9)]),
    stop("泥涌", 22.37, [on("299X", "O", 11)]),
    stop("輋下", 22.38, [on("299X", "O", 12), on("580", "I", 8), on("299X", "I", 8)]),
    stop("馬牯纜", 22.39, [on("299X", "O", 13), on("580", "I", 9)]),
    stop("西沙灣", 22.40, [on("580", "I", 11)]),
    stop("大洞", 22.41, [on("299X", "O", 14)]),
    stop("西貢總站", 22.42, [on("299X", "O", 25), on("99", "O", 24), on("299X", "I", 1)]),
  ]).map((cluster) => cluster.name);

  const at = (name) => ordered.indexOf(name);
  const before = (earlier, later) => {
    assert.ok(at(earlier) !== -1 && at(later) !== -1 && at(earlier) < at(later), `${earlier} should come before ${later}: ${ordered.join("、")}`);
  };
  before("沙田市中心", "好運中心");
  before("好運中心", "麗豪酒店");
  before("麗豪酒店", "錦駿苑");
  before("錦駿苑", "恆安");
  before("恆安", "樟木頭帝琴灣");
  before("樟木頭帝琴灣", "西澳");
  before("西澳", "泥涌");
  before("泥涌", "輋下");
  before("馬牯纜", "西沙灣");
  before("西沙灣", "大洞");
  before("大洞", "西貢總站");
  assert.notEqual(ordered[0], "西澳");
});
