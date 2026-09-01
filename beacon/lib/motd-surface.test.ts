import assert from "node:assert/strict";
import { test } from "node:test";
import { locate, offsetIn, readAll } from "./motd-surface.ts";

/**
 * These three walk a deliberately small slice of the DOM — nodeType, nodeName, nodeValue,
 * childNodes and dataset.pad — so the fixtures below are that slice rather than a whole jsdom.
 * The real surface is exercised in the browser; this pins the traversal itself.
 */
(globalThis as { Node?: unknown }).Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };

type Fake = {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: Fake[];
  dataset?: { pad?: string };
};

const text = (value: string): Fake => ({ nodeType: 3, nodeName: "#text", nodeValue: value, childNodes: [] });
const el = (nodeName: string, children: Fake[] = [], dataset: { pad?: string } = {}): Fake => ({
  nodeType: 1,
  nodeName,
  nodeValue: null,
  childNodes: children,
  dataset,
});
const span = (value: string) => el("SPAN", [text(value)]);
const br = (pad = false) => el("BR", [], pad ? { pad: "1" } : {});
const root = (...children: Fake[]) => el("DIV", children);

// The helpers are typed against the DOM; the fixtures satisfy the parts they touch.
const as = (n: Fake) => n as unknown as HTMLElement;
const asNode = (n: Fake) => n as unknown as Node;

test("readAll joins spans, and a newline is a character like any other", () => {
  assert.equal(readAll(as(root(span("Main"), span("cra")))), "Maincra");
  assert.equal(readAll(as(root(span("one"), text("\n"), span("two")))), "one\ntwo");
});

test("a br the browser inserted is a newline; the trailing pad is not", () => {
  assert.equal(readAll(as(root(span("one"), br(), span("two")))), "one\ntwo");
  assert.equal(readAll(as(root(span("one"), text("\n"), br(true)))), "one\n");
});

test("a block boundary the browser introduced reads as a newline", () => {
  assert.equal(readAll(as(root(span("one"), el("DIV", [span("two")])))), "one\ntwo");
});

test("every offset survives the round trip that carries the caret across a repaint", () => {
  for (const fixture of [
    root(span("Maincra"), span(" survival")),
    root(span("one"), text("\n"), span("two")),
    root(span("a"), span("b"), span("c")),
  ]) {
    const node = as(fixture);
    const content = readAll(node);
    for (let i = 0; i <= content.length; i++) {
      const [hit, off] = locate(node, i);
      assert.equal(offsetIn(node, hit, off), i, `offset ${i} of ${JSON.stringify(content)}`);
    }
  }
});

test("an offset past the end lands somewhere valid instead of throwing", () => {
  const node = as(root(span("abc")));
  const [hit, off] = locate(node, 99);
  assert.ok(hit);
  assert.ok(off >= 0);
});

test("an empty surface still has a position at zero", () => {
  const node = as(root());
  assert.equal(readAll(node), "");
  assert.deepEqual(locate(node, 0), [node, 0]);
});

test("offsetIn accepts an element position, which is what a Range reports", () => {
  const fixture = root(span("ab"), span("cd"));
  const node = as(fixture);
  assert.equal(offsetIn(node, asNode(fixture), 0), 0, "before the first child");
  assert.equal(offsetIn(node, asNode(fixture), 1), 2, "between the two spans");
  assert.equal(offsetIn(node, asNode(fixture), 2), 4, "after the last child");
});
