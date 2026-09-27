import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addableKinds,
  addColumn,
  addModule,
  applyOrder,
  moveModule,
  removeColumn,
  removeModule,
} from "./dashboard-edit.ts";
import { type DashboardLayout, MAX_MODULES } from "./dashboard-layout.ts";

/** Two columns, five modules (m1–m5): the layout every case below starts from. */
const base = (): DashboardLayout => ({
  version: 1,
  kpis: [],
  columns: [
    {
      id: "c1",
      size: 40,
      modules: [
        { id: "m1", kind: "wardend", size: 22 },
        { id: "m2", kind: "host", size: 22 },
        { id: "m3", kind: "metrics", size: 56, settings: { charts: ["cpu", "memory"], range: "1h" } },
      ],
    },
    {
      id: "c2",
      size: 60,
      modules: [
        { id: "m4", kind: "status", size: 25 },
        { id: "m5", kind: "console", size: 75 },
      ],
    },
  ],
});

const kinds = (l: DashboardLayout) => l.columns.map((c) => c.modules.map((m) => m.kind));
const total = (xs: { size: number }[]) => Math.round(xs.reduce((n, x) => n + x.size, 0));

test("an added module joins the end of its column with an equal share and its default settings", () => {
  const l = addModule(base(), "c2", "metrics");
  const col = l.columns[1];
  assert.deepEqual(
    col.modules.map((m) => m.kind),
    ["status", "console", "metrics"],
  );
  assert.equal(total(col.modules), 100);
  assert.deepEqual(col.modules[2].settings, { charts: ["cpu", "memory"], range: "1h" });
});

test("a second Live view cannot be added, and is not offered", () => {
  const once = addModule(base(), "c1", "liveview");
  assert.equal(addModule(once, "c2", "liveview"), once);
  assert.ok(!addableKinds(once).some((k) => k.kind === "liveview"));
});

test("a removed module gives its share back to its column", () => {
  const l = removeModule(base(), "m4");
  assert.deepEqual(kinds(l)[1], ["console"]);
  assert.equal(l.columns[1].modules[0].size, 100);
});

test("columns: up to four, only empty ones removed, at least one kept", () => {
  let l = base();
  l = addColumn(addColumn(addColumn(l)));
  assert.equal(l.columns.length, 4);
  assert.equal(total(l.columns), 100);
  const empty = l.columns[3].id;
  assert.equal(removeColumn(l, l.columns[0].id), l, "a column with modules stays");
  assert.equal(removeColumn(l, empty).columns.length, 3);
});

test("up and down move within the column, then across at its ends", () => {
  const l = base();
  assert.deepEqual(kinds(moveModule(l, "m2", -1))[0], ["host", "wardend", "metrics"]);
  const across = moveModule(l, "m3", 1);
  assert.deepEqual(kinds(across)[0], ["wardend", "host"]);
  assert.deepEqual(kinds(across)[1], ["metrics", "status", "console"]);
});

test("a drag result reorders and moves modules between columns", () => {
  const l = applyOrder(base(), { c1: ["m3", "m1"], c2: ["m2", "m4", "m5"] });
  assert.deepEqual(kinds(l), [
    ["metrics", "wardend"],
    ["host", "status", "console"],
  ]);
  for (const c of l.columns) assert.equal(total(c.modules), 100);
});

/** A column already holding `MAX_MODULES`, for the over-capacity cases below. */
const fullColumn = (id: string): DashboardLayout["columns"][number] => ({
  id,
  size: 60,
  modules: Array.from({ length: MAX_MODULES }, (_, i) => ({ id: `f${i}`, kind: "status", size: 100 / MAX_MODULES })),
});

test("a module cannot move across into a column already at the module limit", () => {
  const l: DashboardLayout = {
    version: 1,
    kpis: [],
    columns: [{ id: "c1", size: 40, modules: [{ id: "m1", kind: "wardend", size: 100 }] }, fullColumn("c2")],
  };
  assert.equal(moveModule(l, "m1", 1), l);
});

test("applyOrder skips an id that does not exist in the layout", () => {
  const l = applyOrder(base(), { c1: ["bogus", "m3", "m1", "m2"], c2: ["m4", "m5"] });
  assert.deepEqual(kinds(l)[0], ["metrics", "wardend", "host"]);
});

test("applyOrder keeps only the first occurrence of an id listed twice", () => {
  const l = applyOrder(base(), { c1: ["m2", "m1", "m2", "m3"], c2: ["m4", "m5"] });
  assert.deepEqual(kinds(l)[0], ["host", "wardend", "metrics"]);
});

test("applyOrder puts a module missing from `order` back at the end of its original column", () => {
  const l = applyOrder(base(), { c1: ["m3", "m1"], c2: ["m4", "m5"] });
  assert.deepEqual(kinds(l)[0], ["metrics", "wardend", "host"]);
});

test("applyOrder refuses a result that would put a column over MAX_MODULES", () => {
  const l: DashboardLayout = {
    version: 1,
    kpis: [],
    columns: [{ id: "c1", size: 40, modules: [{ id: "m1", kind: "wardend", size: 100 }] }, fullColumn("c2")],
  };
  const order = { c1: [], c2: ["m1", ...l.columns[1].modules.map((m) => m.id)] };
  assert.equal(applyOrder(l, order), l);
});

test("applyOrder returns the same layout when nothing actually moves", () => {
  const l = base();
  const order = { c1: ["m1", "m2", "m3"], c2: ["m4", "m5"] };
  assert.equal(applyOrder(l, order), l);
});
