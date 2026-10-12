// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { derive, type DerivedPull } from "../../../shared/model/status";
import type { PullData } from "../../../shared/types";
import { DEFAULT_SETTINGS, setSettings } from "../settings";
import { FinishLine } from "./FinishLine";

// React's act() warns unless the environment says it's a test
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let n = 0;
/** One of my open PRs, run through the real derive; `ready` waives CR and
 * QA so it can merge now, otherwise it needs CR: my own to stamp (self-review),
 * or `asked`'s, whom I requested a review from an hour ago. */
const pull = (
  ageDays = 1,
  { ready = false, asked = [] as string[], hints = [] as string[] } = {}
): DerivedPull => {
  n += 1;
  const at = new Date(Date.now() - ageDays * 86400_000 - 60_000).toISOString();
  const data: PullData = {
    repo: "iFixit/ifixit",
    number: n,
    state: "open",
    title: `PR ${n}`,
    body: "",
    draft: false,
    created_at: at,
    updated_at: at,
    closed_at: null,
    merged_at: null,
    mergeable: true,
    difficulty: null,
    additions: 10,
    deletions: 5,
    changed_files: 2,
    milestone: { title: null, due_on: null },
    head: { ref: "branch", sha: "abc", repo: { owner: { login: "iFixit" } } },
    base: { ref: "master" },
    user: { login: "me" },
    status: {
      cr_req: ready ? 0 : 1,
      qa_req: ready ? 0 : 1,
      allCR: [],
      allQA: [],
      dev_block: [],
      deploy_block: [],
      commit_statuses: [],
    },
    labels: [],
    participants: [],
    requested_reviewers: asked,
    review_requests: asked.map((login) => ({
      login,
      at: Date.now() / 1000 - 3600,
      self: false,
    })),
    input_hints: hints,
  };
  return derive(data, undefined);
};
const many = (count: number) => Array.from({ length: count }, () => pull());

let root: Root | null = null;
const host = document.createElement("div");
document.body.append(host);
// most of these watch it pop up, and close it the old way, by holding
beforeEach(() =>
  setSettings({ finishLineMode: "auto", finishLineHoldToClose: true })
);
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  localStorage.clear();
  vi.useRealTimers();
});

function render(pulls: DerivedPull[]) {
  const r = (root ??= createRoot(host));
  act(() =>
    r.render(
      <FinishLine pulls={pulls} me="me" extraBots={new Set()} initialized />
    )
  );
}

/** the stats row's buttons, by their words */
const stats = () =>
  [...document.querySelectorAll<HTMLButtonElement>("#finish-stats button")].map(
    (b) => b.textContent
  );
const stat = (text: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>("#finish-stats button"),
  ].find((b) => b.textContent === text);
const listed = () =>
  document.querySelectorAll('[role="dialog"] section li').length;
const dialog = () => document.querySelector('[role="dialog"]');
const countdown = () => document.getElementById("finish-title")?.textContent;
const badge = () =>
  document.querySelector<HTMLButtonElement>(
    '[aria-label^="Finish"][aria-label$="open PRs"]'
  );
const esc = () =>
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })
    );
  });
const headers = () =>
  [...document.querySelectorAll('[role="dialog"] h3')].map(
    (h) => h.textContent
  );

describe("FinishLine while it is up", () => {
  it("follows new PRs and merges live", () => {
    const first = many(8);
    render(first);
    expect(stats()).toEqual(["8 open PRs, aim for 7"]);
    expect(listed()).toBe(8);

    // a new PR arrives over the socket
    render([...first, pull()]);
    expect(stats()).toEqual(["9 open PRs, aim for 7"]);
    expect(listed()).toBe(9);

    expect(countdown()).toBe("Finish 2 PRs");

    // merges bring you under the limits: it says so, then lets you go
    vi.useFakeTimers();
    render(first.slice(0, 3));
    expect(stats()).toEqual([]);
    expect(countdown()).toBe("All finished");
    expect(dialog()?.textContent).toContain(
      "None of your open PRs are past your limits."
    );
    expect(listed()).toBe(0);
    act(() => vi.advanceTimersByTime(2500));
    expect(dialog()).toBeNull();
  });

  it("lifts ready PRs to the top and counts them in the stats", () => {
    const ready = pull(2, { ready: true });
    render([...many(7), ready]);
    // the rest are mine to stamp under self-review
    expect(headers()).toEqual(["Ready to merge", "Your move"]);
    expect(
      document.querySelector('[role="dialog"] li a')?.textContent
    ).toContain(ready.data.title);
    expect(countdown()).toBe("Finish 1 PR");
    expect(stats()).toEqual(["8 open PRs, aim for 7", "1 PR ready to merge"]);
    expect(dialog()?.textContent).toContain("Only you see this.");
  });

  it("only shows the badge until you turn the popup on", () => {
    setSettings({ finishLineMode: DEFAULT_SETTINGS.finishLineMode });
    render(many(9));
    expect(dialog()).toBeNull();
    expect(badge()).not.toBeNull();
  });

  it("only shows the badge when the popup is off", () => {
    setSettings({ finishLineMode: "manual" });
    render(many(9));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(badge()?.getAttribute("aria-label")).toBe(
      "Finish 2 of your open PRs"
    );
    expect(badge()?.textContent).toBe("2 to finish");
    act(() => badge()?.click());
    expect(countdown()).toBe("Finish 2 PRs");
  });

  it("stays away, badge and all, when it is off", () => {
    setSettings({ finishLineMode: "off" });
    render(many(9));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(badge()).toBeNull();
  });

  it("with the hold setting, closes only when the button is held down", () => {
    vi.useFakeTimers();
    render(many(8));
    const hold = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((b) => b.textContent?.includes("Hold to close"));
    // it has focus from the start, so the keyboard can hold it right away
    expect(document.activeElement).toBe(hold);
    const key = (type: string, k = "Enter") =>
      act(() =>
        hold?.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }))
      );
    // a tap of Enter does nothing but say to hold it; neither does Esc
    key("keydown");
    act(() => vi.advanceTimersByTime(200));
    key("keyup");
    expect(hold?.textContent).toBe("Hold it down");
    act(() => vi.advanceTimersByTime(3000));
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    );
    expect(dialog()).not.toBeNull();
    // holding Space the full two seconds turns the key, then it opens
    key("keydown", " ");
    act(() => vi.advanceTimersByTime(2000));
    act(() => vi.advanceTimersByTime(700));
    expect(dialog()).toBeNull();
  });

  it("slides a merged PR out of the list as the countdown ticks", () => {
    vi.useFakeTimers();
    const nine = many(9);
    render(nine);
    expect(countdown()).toBe("Finish 2 PRs");
    render(nine.slice(1));
    expect(countdown()).toBe("Finish 1 PR");
    // still there for the slide, then gone
    expect(document.querySelectorAll(".finish-row-leave")).toHaveLength(1);
    expect(listed()).toBe(9);
    act(() => vi.advanceTimersByTime(450));
    expect(listed()).toBe(8);
  });

  it("copies a nudge listing only the PRs waiting on people I asked, naming them", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const first = pull(3, { asked: ["bob"] });
    const second = pull(2, { asked: ["cy", "dee"] });
    render([first, second, ...many(6)]);
    expect(headers()).toEqual(["Your move", "Waiting on others"]);
    const copy = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((b) => b.textContent === "Copy a nudge");
    await act(async () => copy?.click());
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(text.split("\n")).toHaveLength(3);
    expect(text).toContain(
      `• ${first.data.title} https://github.com/iFixit/ifixit/pull/${first.data.number} (bob)`
    );
    expect(text).toContain(`(cy, dee)`);
    expect(copy?.textContent).toBe("Copied");
  });

  it("offers no nudge when I asked nobody: a self-review waits on no one", () => {
    render(many(8));
    const copy = [...document.querySelectorAll('[role="dialog"] button')].find(
      (b) => b.textContent === "Copy a nudge"
    );
    expect(copy).toBeUndefined();
  });

  it("hints when a self-reviewed PR touches what usually deserves team input", () => {
    render([pull(1, { hints: ["ci", "migrations"] }), ...many(7)]);
    expect(dialog()?.textContent).toContain(
      "touches CI and migrations · worth asking for review?"
    );
  });

  it("lets a screen reader or voice control close the hold with a lone click", () => {
    render(many(8));
    const hold = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((b) => b.textContent?.includes("Hold to close"));
    // a mouse click carries detail 1 and does nothing
    act(() =>
      hold?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))
    );
    expect(dialog()).not.toBeNull();
    // assistive tech sends a click with no pointer or key behind it
    act(() =>
      hold?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }))
    );
    expect(dialog()).toBeNull();
  });

  it("with the hold setting, keeps Esc from closing it or reaching anything behind it", () => {
    render(many(8));
    let reached = false;
    const behind = (e: KeyboardEvent) => {
      if (!e.defaultPrevented) reached = true;
    };
    document.addEventListener("keydown", behind);
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        })
      );
    });
    document.removeEventListener("keydown", behind);
    expect(reached).toBe(false);
    expect(dialog()).not.toBeNull();
  });

  it("zeroes the last showing once you are under the limits, but keeps its time", () => {
    vi.useFakeTimers();
    const nine = many(9);
    render(nine);
    const shownAt = JSON.parse(
      localStorage.getItem("pd2.finishLine") ?? "null"
    ).at;
    render(nine.slice(0, 3));
    expect(
      JSON.parse(localStorage.getItem("pd2.finishLine") ?? "null")
    ).toEqual({
      at: shownAt,
      count: 0,
      over: [],
    });
  });

  it("going back over within 4 hours waits out the rest of them", () => {
    const nine = many(9);
    render(nine);
    act(() =>
      document
        .querySelector<HTMLButtonElement>("[data-hold]")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }))
    );
    expect(dialog()).toBeNull();
    render(nine.slice(0, 3)); // under: the record zeroes
    render([...nine, pull()]); // over again, minutes later
    expect(dialog()).toBeNull();
  });

  it("board hotkeys stand down while it is open", async () => {
    const { modalOpen } = await import("../hooks");
    render(many(8));
    expect(modalOpen()).toBe(true);
  });

  it("opens the preview every time Settings asks, or the URL says #finish=1", () => {
    render(many(2));
    expect(dialog()).toBeNull();
    act(() => window.dispatchEvent(new Event("pd2:preview-finish-line")));
    expect(dialog()).not.toBeNull();
    act(() =>
      document
        .querySelector<HTMLButtonElement>("[data-hold]")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }))
    );
    expect(dialog()).toBeNull();
    act(() => {
      location.hash = "finish=1";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(dialog()).not.toBeNull();
    location.hash = "";
  });

  it("a quick Space tap is not a lone click, even where the browser clicks on keyup", () => {
    render(many(8));
    const hold = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((b) => b.textContent?.includes("Hold to close"));
    act(() => {
      hold?.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true })
      );
      hold?.dispatchEvent(
        new KeyboardEvent("keyup", { key: " ", bubbles: true })
      );
      // Firefox's keyup click, with no pointer behind it
      hold?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 0 })
      );
    });
    expect(dialog()).not.toBeNull();
  });

  it("keeps the last showing while it doesn’t know who you are", () => {
    localStorage.setItem(
      "pd2.finishLine",
      JSON.stringify({ at: Date.now(), count: 9, over: [] })
    );
    const r = (root ??= createRoot(host));
    act(() =>
      r.render(
        <FinishLine pulls={many(9)} me="" extraBots={new Set()} initialized />
      )
    );
    expect(localStorage.getItem("pd2.finishLine")).not.toBeNull();
    expect(dialog()).toBeNull();
  });

  it("stays down when another window showed it a moment ago", () => {
    // another window wrote the record after this one loaded
    const r = (root ??= createRoot(host));
    act(() =>
      r.render(
        <FinishLine
          pulls={many(8)}
          me="me"
          extraBots={new Set()}
          initialized={false}
        />
      )
    );
    localStorage.setItem(
      "pd2.finishLine",
      JSON.stringify({ at: Date.now(), count: 8, over: [] })
    );
    act(() =>
      r.render(
        <FinishLine pulls={many(8)} me="me" extraBots={new Set()} initialized />
      )
    );
    expect(dialog()).toBeNull();
  });

  it("waits while another dialog is open", () => {
    const other = document.createElement("div");
    other.setAttribute("aria-modal", "true");
    document.body.append(other);
    render(many(9));
    expect(dialog()).toBeNull();
    other.remove();
  });

  it("a drop ends a drag even when the dragged row left the page", () => {
    const row = document.createElement("div");
    document.body.append(row);
    row.dispatchEvent(new Event("dragstart", { bubbles: true }));
    row.remove(); // moved to another lane: its dragend never reaches the page
    document.body.dispatchEvent(new Event("drop", { bubbles: true }));
    render(many(9));
    expect(dialog()).not.toBeNull();
  });

  it("closes on Esc or the close button, and stays away until things get worse", () => {
    setSettings({ finishLineHoldToClose: false });
    const nine = many(9);
    render(nine);
    // focus starts on the dialog itself, so a stray Enter can't close it;
    // there's no hold button
    expect(document.activeElement).toBe(dialog());
    expect(
      document.querySelector("[data-close]")?.getAttribute("aria-label")
    ).toBe("Close");
    expect(document.querySelector("[data-hold]")).toBeNull();
    esc();
    expect(dialog()).toBeNull();
    render([...nine, pull()]); // worse, minutes later: within the 4 hours
    expect(dialog()).toBeNull();
    act(() => badge()?.click());
    expect(dialog()).not.toBeNull();
    act(() =>
      document.querySelector<HTMLButtonElement>("[data-close]")?.click()
    );
    expect(dialog()).toBeNull();
  });

  it("the cog closes it and opens Settings at its own settings", () => {
    setSettings({ finishLineHoldToClose: false });
    const asked: unknown[] = [];
    const listen = (e: Event) => asked.push((e as CustomEvent).detail);
    window.addEventListener("pd2:open-settings", listen);
    render(many(9));
    act(() =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="Finish line settings"]')
        ?.click()
    );
    window.removeEventListener("pd2:open-settings", listen);
    expect(asked).toEqual(["finish-line"]);
    expect(dialog()).toBeNull();
  });
});

describe("FinishLine stats", () => {
  beforeEach(() => setSettings({ finishLineHoldToClose: false }));

  it("shows only the numbers above zero, old PRs alone when the count is fine", () => {
    render([pull(20), pull(30), pull(1)]);
    expect(countdown()).toBe("Finish 2 PRs");
    expect(stats()).toEqual(["2 PRs older than 14 days"]);
    // the list is the old ones only
    expect(listed()).toBe(2);
  });

  it("leaves waiting on others out of the stats", () => {
    render([pull(2, { asked: ["bob"] }), ...many(7)]);
    expect(headers()).toEqual(["Your move", "Waiting on others"]);
    expect(stats()).toEqual(["8 open PRs, aim for 7"]);
  });

  it("jumps to and focuses the first PR a stat counts", () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const ready = pull(2, { ready: true });
    const old = pull(20, { asked: ["bob"] });
    render([ready, old, ...many(7)]);
    expect(stats()).toEqual([
      "9 open PRs, aim for 7",
      "1 PR older than 14 days",
      "1 PR ready to merge",
    ]);
    const row = (p: DerivedPull) =>
      document.querySelector(
        `[role="dialog"] li[data-pull="${p.data.repo}#${p.data.number}"]`
      );
    // the old PR waits on bob, at the bottom of the list
    act(() => stat("1 PR older than 14 days")?.click());
    expect(scrolled.mock.contexts.at(-1)).toBe(row(old));
    expect(document.activeElement).toBe(row(old)?.querySelector("a"));
    act(() => stat("1 PR ready to merge")?.click());
    expect(document.activeElement).toBe(row(ready)?.querySelector("a"));
    // the open count counts them all: the first row in the list
    act(() => (document.activeElement as HTMLElement).blur());
    act(() => stat("9 open PRs, aim for 7")?.click());
    expect(document.activeElement).toBe(
      document.querySelector('[role="dialog"] li a')
    );
  });
});

describe("FinishLine focus and preview", () => {
  beforeEach(() => setSettings({ finishLineHoldToClose: false }));

  const tab = (shiftKey = false) => {
    const e = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.activeElement?.dispatchEvent(e);
    });
    return e;
  };

  it("wraps Tab past a row sliding out, so focus never leaves the list", () => {
    const nine = many(9);
    render(nine);
    // the first PR merges: its row slides out at the end of the list
    render(nine.slice(1));
    const leaving = document.querySelector(".finish-row-leave");
    const links = [
      ...document.querySelectorAll<HTMLElement>('[role="dialog"] a[href]'),
    ];
    expect(links.at(-1)?.closest("li")).toBe(leaving);
    const lastLive = links.at(-2);
    act(() => lastLive?.focus());
    expect(tab().defaultPrevented).toBe(true);
    const first = document.querySelector('[role="dialog"] button');
    expect(document.activeElement).toBe(first);
    // and back the other way
    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(lastLive);
  });

  it("skips anything hidden when wrapping", () => {
    render(many(9));
    const links = [
      ...document.querySelectorAll<HTMLElement>('[role="dialog"] a[href]'),
    ];
    links.at(-1)?.closest("li")?.setAttribute("hidden", "");
    act(() => links.at(-2)?.focus());
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(
      document.querySelector('[role="dialog"] button')
    );
  });

  it("previews your real numbers even with it off", () => {
    setSettings({ finishLineMode: "off" });
    render([pull(20), ...many(8)]);
    expect(badge()).toBeNull();
    act(() => window.dispatchEvent(new Event("pd2:preview-finish-line")));
    expect(countdown()).toBe("Finish 2 PRs");
    expect(stats()).toEqual([
      "9 open PRs, aim for 7",
      "1 PR older than 14 days",
    ]);
  });

  it("previews a sample only when you are under the limits", () => {
    setSettings({ finishLineMode: "off" });
    render(many(2));
    act(() => window.dispatchEvent(new Event("pd2:preview-finish-line")));
    expect(countdown()).toBe("Nothing to finish");
    expect(stats()).toEqual([]);
    expect(listed()).toBe(2);
    // nothing to describe it with, so it points at nothing
    expect(dialog()?.hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("Settings, opened from the cog", () => {
  it("scrolls to and focuses the Finish line settings", async () => {
    const { Settings } = await import("./Settings");
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const r = (root ??= createRoot(host));
    act(() => r.render(<Settings onGoToTeam={() => undefined} />));
    act(() => {
      window.dispatchEvent(
        new CustomEvent("pd2:open-settings", { detail: "finish-line" })
      );
    });
    const section = document.getElementById("finish-line");
    expect(scrolled.mock.contexts[0]).toBe(section);
    expect(section?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.textContent).toBe("Pop up");
  });
});
