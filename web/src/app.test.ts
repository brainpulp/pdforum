// DOM-level verification of the read-only UI against the mock data layer.
// Executes the real views + threading in jsdom (a real DOM implementation) —
// the closest in-sandbox substitute for browser verification.

import { describe, it, expect, beforeEach } from "vitest";
import { MockRepo } from "./repo/mock.ts";
import { buildMessageTree } from "./tree.ts";
import { renderThreadList } from "./views/threadList.ts";
import { renderThreadView } from "./views/threadView.ts";
import { renderSignIn } from "./views/signin.ts";
import type { Session } from "./auth.ts";

const SESSION: Session = { email: "member@example.org" };

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById("app")!;
  localStorage.clear();
});

describe("thread tree", () => {
  it("indents replies under the message they reply to", async () => {
    const detail = await new MockRepo().getThread("thread-a");
    const tree = buildMessageTree(detail!.messages);
    const depthById = new Map(tree.map((n) => [n.message.id, n.depth]));
    // a1 root → a2/a3 reply to a1 → a4 replies to a3.
    expect(depthById.get("a1")).toBe(0);
    expect(depthById.get("a2")).toBe(1);
    expect(depthById.get("a3")).toBe(1);
    expect(depthById.get("a4")).toBe(2);
    // Chronological order within the walk: a1, a2, a3, a4.
    expect(tree.map((n) => n.message.id)).toEqual(["a1", "a2", "a3", "a4"]);
  });
});

describe("sign-in view", () => {
  it("renders the invite-only form with the mock-mode badge", () => {
    renderSignIn(root);
    expect(root.querySelector("#signin-form")).not.toBeNull();
    expect(root.querySelector('input[type="email"]')).not.toBeNull();
    expect(root.textContent).toContain("Invite-only");
    expect(root.textContent).toContain("mock data mode");
  });
});

describe("thread list view", () => {
  it("lists threads newest-first with the read-only banner", async () => {
    await renderThreadList(root, SESSION);
    expect(root.querySelector(".mirror-banner")?.textContent).toContain(
      "Read-only mirror",
    );
    const subjects = [...root.querySelectorAll(".thread-subject")].map(
      (el) => el.textContent,
    );
    // thread-b (Jun 18) is more recent than thread-a (Jun 15).
    expect(subjects).toEqual([
      "Notes from last meeting",
      "Proposal: weekly reading group",
    ]);
    expect(root.textContent).toContain("member@example.org");
  });
});

describe("thread detail view", () => {
  it("renders every message with increasing indentation for replies", async () => {
    await renderThreadView(root, SESSION, "thread-a");
    const messages = [...root.querySelectorAll(".message")];
    expect(messages).toHaveLength(4);
    expect(root.querySelector(".thread-title")?.textContent).toContain(
      "Proposal: weekly reading group",
    );
    const margins = messages.map((el) =>
      parseFloat((el as HTMLElement).style.marginLeft),
    );
    // a1=0, a2=1.5, a3=1.5, a4=3 (rem).
    expect(margins).toEqual([0, 1.5, 1.5, 3]);
    expect(root.textContent).toContain("Ada Lovelace");
    expect(root.textContent).toContain("Wednesdays are fine by me");
  });

  it("shows a not-found message for an unknown thread", async () => {
    await renderThreadView(root, SESSION, "does-not-exist");
    expect(root.textContent).toContain("Thread not found");
  });
});
