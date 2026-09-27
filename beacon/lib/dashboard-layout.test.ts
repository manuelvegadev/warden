import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultLayout, MAX_COLUMNS, MAX_MODULES, normalizeLayout } from "./dashboard-layout.ts";

const sum = (xs: { size: number }[]) => Math.round(xs.reduce((n, x) => n + x.size, 0));

test("the preset: the key figures across the top, the console beside status, backups and activity", () => {
  const l = defaultLayout();
  assert.deepEqual(l.kpis, ["cpu", "memory", "tps", "players", "uptime", "network"]);
  assert.deepEqual(
    l.columns.map((c) => c.modules.map((m) => m.kind)),
    [["console"], ["status", "backups", "activity"]],
  );
  assert.equal(sum(l.columns), 100);
  for (const c of l.columns) assert.equal(sum(c.modules), 100);
});

test("the preset normalises to itself", () => {
  const l = defaultLayout();
  assert.deepEqual(normalizeLayout(JSON.parse(JSON.stringify(l))), l);
});

test("anything that is not a layout is refused", () => {
  for (const bad of [null, 1, "x", [], {}, { columns: "x" }, { columns: [] }]) {
    assert.equal(normalizeLayout(bad), null, JSON.stringify(bad));
  }
});

test("sizes that do not add up are renormalised to 100", () => {
  const l = normalizeLayout({
    columns: [
      {
        id: "a",
        size: 10,
        modules: [
          { id: "1", kind: "status", size: 1 },
          { id: "2", kind: "console", size: 3 },
        ],
      },
      { id: "b", size: 30, modules: [{ id: "3", kind: "host", size: -5 }] },
    ],
  });
  assert.ok(l);
  assert.equal(sum(l.columns), 100);
  assert.deepEqual(
    l.columns[0].modules.map((m) => m.size),
    [25, 75],
  );
  assert.equal(l.columns[1].modules[0].size, 100, "a non-positive size takes an equal share");
});

test("columns and modules beyond the limits are dropped", () => {
  const col = (i: number) => ({
    id: `c${i}`,
    size: 1,
    modules: Array.from({ length: 9 }, (_, j) => ({ id: `m${i}-${j}`, kind: "status", size: 1 })),
  });
  const l = normalizeLayout({ columns: Array.from({ length: 7 }, (_, i) => col(i)) });
  assert.ok(l);
  assert.equal(l.columns.length, MAX_COLUMNS);
  for (const c of l.columns) assert.equal(c.modules.length, MAX_MODULES);
});

test("a second Live view is dropped", () => {
  const l = normalizeLayout({
    columns: [
      {
        id: "a",
        size: 50,
        modules: [
          { id: "1", kind: "liveview", size: 50 },
          { id: "2", kind: "liveview", size: 50 },
        ],
      },
      { id: "b", size: 50, modules: [{ id: "3", kind: "liveview", size: 100 }] },
    ],
  });
  assert.ok(l);
  assert.equal(l.columns.flatMap((c) => c.modules).filter((m) => m.kind === "liveview").length, 1);
});

test("a kind this Beacon does not know is kept and marked, not dropped", () => {
  const l = normalizeLayout({
    columns: [{ id: "a", size: 100, modules: [{ id: "1", kind: "future-thing", size: 100 }] }],
  });
  assert.ok(l);
  assert.deepEqual(l.columns[0].modules[0], { id: "1", kind: "future-thing", size: 100, unavailable: true });
});

test("an unknown kind keeps its settings when they are a plain object", () => {
  const l = normalizeLayout({
    columns: [
      {
        id: "a",
        size: 100,
        modules: [{ id: "1", kind: "future-thing", size: 100, settings: { future: true } }],
      },
    ],
  });
  assert.ok(l);
  assert.deepEqual(l.columns[0].modules[0], {
    id: "1",
    kind: "future-thing",
    size: 100,
    unavailable: true,
    settings: { future: true },
  });
});

test("an unknown kind with settings that are not a plain object drops them", () => {
  for (const bad of [null, "x", 1, ["array"]]) {
    const l = normalizeLayout({
      columns: [{ id: "a", size: 100, modules: [{ id: "1", kind: "future-thing", size: 100, settings: bad }] }],
    });
    assert.ok(l);
    assert.equal(l.columns[0].modules[0].settings, undefined, JSON.stringify(bad));
  }
});

test("missing and duplicate ids are replaced by unique ones", () => {
  const l = normalizeLayout({
    columns: [
      {
        size: 50,
        modules: [
          { kind: "status", size: 50 },
          { id: "x", kind: "host", size: 50 },
        ],
      },
      { id: "x", size: 50, modules: [{ id: "x", kind: "console", size: 100 }] },
    ],
  });
  assert.ok(l);
  const ids = [...l.columns.map((c) => c.id), ...l.columns.flatMap((c) => c.modules.map((m) => m.id))];
  assert.equal(new Set(ids).size, ids.length);
});

test("metrics settings are checked, and bad ones fall back to the defaults", () => {
  const l = normalizeLayout({
    columns: [
      {
        id: "a",
        size: 100,
        modules: [
          { id: "1", kind: "metrics", size: 50, settings: { charts: ["cpu", "gpu"], range: "1h" } },
          { id: "2", kind: "metrics", size: 50, settings: { charts: [], range: "1y" } },
        ],
      },
    ],
  });
  assert.ok(l);
  assert.deepEqual(l.columns[0].modules[0].settings, { charts: ["cpu"], range: "1h" });
  assert.deepEqual(l.columns[0].modules[1].settings, { charts: ["cpu", "memory"], range: "1h" });
});

test("a layout stored before the KPI strip existed gets the default strip; a hidden one stays hidden", () => {
  const columns = [{ id: "c1", size: 100, modules: [{ id: "m1", kind: "status", size: 100 }] }];
  assert.deepEqual(normalizeLayout({ columns })?.kpis, defaultLayout().kpis);
  assert.deepEqual(normalizeLayout({ columns, kpis: [] })?.kpis, []);
});
