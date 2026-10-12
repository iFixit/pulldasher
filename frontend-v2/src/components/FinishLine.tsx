import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Flag, Settings as SettingsIcon, X } from "lucide-react";
import type { DerivedPull } from "../../../shared/model/status";
import { githubUrl } from "../../../shared/format";
import { askedOf, askForInputHint, rowNote, rowWord } from "../model/actions";
import { STAGE_WORDS } from "../model/stage";
import {
  finishLineCase,
  finishDue,
  finishGroups,
  finishRecord,
  finishStats,
  parseFinishRecord,
  prCount,
  FINISH_LINE_KEY,
  type FinishLineCase,
  type FinishStat,
} from "../model/finishLine";
import { useSettings } from "../settings";
import { readStorage, writeStorage } from "../storage";
import { FactLink, QuietButton, RepoRef } from "./bits";
import { Icon } from "./Icon";
import { modalOpen } from "../hooks";
import { GroupHeader } from "./Lane";
import { CiGlyph } from "./pips";

/**
 * Finish line: when your own open PRs pass a limit (model/finishLine.ts), a
 * header badge counts down how many to merge or close, and opens a list of
 * them. Only you see it. Turned on in Settings, the list also pops up by
 * itself, and comes back only when that gets worse (finishDue). Esc or the
 * close button puts it away; finishLineHoldToClose makes you hold a button
 * down instead. Getting under the limits closes it too. `#finish=1` in the
 * URL forces it, any time, for a preview. The finishLineMode setting picks:
 * pop up (auto), the badge alone (manual), or off.
 */

// whether a mouse button or finger is down, or a native drag is under way:
// it never pops up mid-drag (a Roadmap bar or row, say)
let pressing = false;
let dragging = false;
const pointerBusy = () => pressing || dragging;
if (typeof document !== "undefined") {
  // the main button only: a right-click's context menu swallows its
  // pointerup and would leave this stuck on
  // a new press also means no drag is running, whatever became of the last
  document.addEventListener(
    "pointerdown",
    (e) => {
      pressing = e.button === 0;
      dragging = false;
    },
    true
  );
  // a touch that turns into a scroll, or a press that turns into a native
  // drag, ends with pointercancel; the drag is tracked on its own
  for (const end of ["pointerup", "pointercancel", "contextmenu"] as const)
    document.addEventListener(end, () => (pressing = false), true);
  document.addEventListener("dragstart", () => (dragging = true), true);
  // dragend goes to the dragged node, which may have left the page by then
  // (a Roadmap plan moved to another lane), so the drop counts as the end too
  for (const end of ["dragend", "drop"] as const)
    document.addEventListener(end, () => (dragging = false), true);
  window.addEventListener("blur", () => (pressing = dragging = false));
}

const hasPreviewFlag = () =>
  new URLSearchParams(location.hash.slice(1)).get("finish") === "1";

/** Renders the header badge in place, and the cell over the page. */
export function FinishLine({
  pulls,
  me,
  extraBots,
  initialized,
}: {
  pulls: DerivedPull[];
  me: string;
  extraBots: ReadonlySet<string>;
  initialized: boolean;
}) {
  const settings = useSettings();
  // read on the first render: the app rewrites the hash right after and
  // drops the unknown param
  const [preview, setPreview] = useState(hasPreviewFlag);
  // which list is open, not a copy of it: the list below is read live, so a
  // merge or a new PR shows up while it's open
  const [shown, setShown] = useState<"real" | "preview" | null>(null);
  // the last showing, kept here too so blocked storage still holds it for
  // this page load; another tab's showing arrives by the storage event
  const record = useRef(parseFinishRecord(readStorage(FINISH_LINE_KEY)));

  // where you stand whatever the mode, for the preview: with it off, a
  // preview still shows your real numbers
  const real = useMemo(
    () =>
      // no case until we know who you are: an empty `me` (a failed whoami)
      // would read as "under the limits" and wipe the last showing
      initialized && me
        ? finishLineCase(pulls, me, extraBots, {
            maxOpen: settings.finishLineMaxOpen,
            maxDays: settings.finishLineMaxDays,
            countDrafts: settings.finishLineCountDrafts,
          })
        : null,
    [initialized, pulls, me, extraBots, settings]
  );
  const found = settings.finishLineMode === "off" ? null : real;

  // under the limits again: zero what the last showing counted, so going
  // over later is worse than it (a fresh offense), but keep when it showed,
  // so it still comes back at most every 4 hours
  useEffect(() => {
    const last = record.current;
    if (
      !initialized ||
      !me ||
      found ||
      settings.finishLineMode === "off" ||
      !last
    )
      return;
    if (!last.count && !last.over.length) return;
    record.current = { at: last.at, count: 0, over: [] };
    writeStorage(FINISH_LINE_KEY, JSON.stringify(record.current));
  }, [initialized, me, found, settings.finishLineMode]);

  // the latest case, for closing: the button's hold started seconds ago, and
  // what you saw last is what the next showing compares against
  const latest = useRef(found);
  latest.current = found;

  // open PRs on the whole board, so a row leaving the list only slides
  // out as merged when it really closed (not when the rule switched)
  const openIds = useMemo(
    () => new Set(pulls.filter((p) => p.data.state === "open").map(pullId)),
    [pulls]
  );

  const remember = (c: FinishLineCase<DerivedPull>) => {
    record.current = finishRecord(c, Date.now());
    writeStorage(FINISH_LINE_KEY, JSON.stringify(record.current));
  };
  const show = (c: FinishLineCase<DerivedPull>) => {
    remember(c);
    setShown("real");
  };

  useEffect(() => {
    const onHash = () => {
      if (hasPreviewFlag()) setPreview(true);
    };
    // Settings' "Preview it": an event, since setting the same hash
    // twice fires nothing
    const onPreview = () => setPreview(true);
    window.addEventListener("pd2:preview-finish-line", onPreview);
    const onStorage = (e: StorageEvent) => {
      if (e.key === FINISH_LINE_KEY)
        record.current = parseFinishRecord(e.newValue);
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("pd2:preview-finish-line", onPreview);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // the preview never writes the record, so it can't stand in for a real one
  useEffect(() => {
    if (!initialized || !preview) return;
    setPreview(false);
    setShown("preview");
  }, [initialized, preview]);

  // checked on load, on every data change, and when the tab comes back; a
  // hidden tab or a focused field waits for the next one, so it never lands
  // mid-typing or out of sight
  useEffect(() => {
    if (!found || shown || settings.finishLineMode !== "auto") return;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      // another dialog is up (Settings), or a drag is under way: it
      // would land on top of it, and swallow the Esc that cancels a drag
      if (modalOpen() || pointerBusy()) return;
      if (document.activeElement?.matches("input, textarea, select")) return;
      // read the record fresh: a second visible window may have shown it
      // a moment ago, before its storage event reached this one
      record.current =
        parseFinishRecord(readStorage(FINISH_LINE_KEY)) ?? record.current;
      if (!finishDue(found, record.current, Date.now())) return;
      show(found);
    };
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [found, shown, settings.finishLineMode]);

  // you got under the limits while it was up: it says so, then lets you go
  const freed = shown === "real" && !found;
  useEffect(() => {
    if (!freed) return;
    const t = window.setTimeout(() => setShown(null), FREED_MS);
    return () => clearTimeout(t);
  }, [freed]);

  return (
    <>
      {found && (
        // the action, said as a number and a verb: "2 to finish"
        <button
          type="button"
          aria-label={finishLabel(found.toGo)}
          title={finishLabel(found.toGo)}
          onClick={() => show(found)}
          className="pressable inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[13px] font-medium whitespace-nowrap text-ink-2 hover:text-brand"
        >
          <Icon icon={Flag} size={14} className="text-ink-3" />
          <span>
            <span className="tabular-nums">{found.toGo}</span> to finish
          </span>
        </button>
      )}
      {shown &&
        createPortal(
          <FinishModal
            found={
              found ??
              (shown === "preview"
                ? real ?? sampleCase(pulls, me, extraBots, settings)
                : FREE)
            }
            me={me}
            maxOpen={settings.finishLineMaxOpen}
            maxDays={settings.finishLineMaxDays}
            hold={settings.finishLineHoldToClose}
            openIds={openIds}
            onDone={() => {
              // what you saw last is what the next showing compares
              // against, so PRs opened while it was up don't re-drop it
              if (shown === "real" && latest.current) remember(latest.current);
              setShown(null);
            }}
          />,
          document.body
        )}
    </>
  );
}

/** How long "All finished" shows before it closes on its own. */
const FREED_MS = 2500;

/** The badge's full words, for its hover and screen readers. */
const finishLabel = (n: number) => `Finish ${n} of your open PRs`;

/** Merged or closed your way under the limits while it was up. */
const FREE: FinishLineCase<DerivedPull> = {
  pulls: [],
  ready: 0,
  count: 0,
  over: [],
  toGo: 0,
};

/** The preview when you're under the limits: your PRs as it counts them (any
 * open one trips a limit of 0), or the board's oldest when you have none,
 * so there's something to look at. Nothing to finish: toGo is 0. */
function sampleCase(
  pulls: DerivedPull[],
  me: string,
  extraBots: ReadonlySet<string>,
  settings: { finishLineMaxDays: number; finishLineCountDrafts: boolean }
): FinishLineCase<DerivedPull> {
  const mine = finishLineCase(pulls, me, extraBots, {
    maxOpen: 0,
    maxDays: settings.finishLineMaxDays,
    countDrafts: settings.finishLineCountDrafts,
  });
  if (mine) return { ...mine, toGo: 0 };
  return {
    pulls: pulls
      .filter((p) => p.data.state === "open")
      .sort((a, b) => b.ageDays - a.ageDays)
      .slice(0, 6),
    ready: 0,
    count: 0,
    over: [],
    toGo: 0,
  };
}

/** How long "Hold to close" has to be held down. */
const HOLD_MS = 2000;
/** How long the full ring shows before it closes. */
const OPEN_MS = 700;
/** How long a merged or closed row takes to leave the list. */
const LEAVE_MS = 450;

const iconButton =
  "pressable inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 hover:bg-muted hover:text-ink";

/** The modal over the board: a centered card on a desktop, a sheet up from
 * the bottom on a phone. Its top is the action and its numbers ("Finish 2
 * PRs", then the stats that say why); the list scrolls under it. Esc or the
 * close button puts it away; with `hold` on, neither does, and the way out
 * besides getting under the limits is holding the button at the bottom down
 * for a couple of seconds, by pointer, finger, Enter or Space. The cog opens
 * Settings at this feature's own settings. */
function FinishModal({
  found,
  me,
  maxOpen,
  maxDays,
  hold,
  openIds,
  onDone,
}: {
  found: FinishLineCase<DerivedPull>;
  me: string;
  maxOpen: number;
  maxDays: number;
  hold: boolean;
  openIds: ReadonlySet<string>;
  onDone: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const free = found === FREE;
  const stats = finishStats(found, { maxOpen, maxDays });
  // a stat jumps to the first PR it counts, in the list's order
  const goTo = (stat: FinishStat) => {
    const ids = new Set(found.pulls.filter(stat.counts).map(pullId));
    const row = [
      ...(rootRef.current?.querySelectorAll<HTMLElement>("li[data-pull]") ??
        []),
    ].find((li) => ids.has(li.dataset.pull ?? ""));
    row?.scrollIntoView?.({ block: "nearest" });
    row?.querySelector<HTMLElement>("a[href]")?.focus({ preventScroll: true });
  };
  // the key handler is set up once; it reads these fresh
  const latest = useRef({ hold, onDone });
  latest.current = { hold, onDone };

  // "You're at the finish line" unmounts the focused button: keep focus in
  // the dialog
  useEffect(() => {
    if (free) rootRef.current?.focus({ preventScroll: true });
  }, [free]);

  useEffect(() => {
    const root = rootRef.current;
    // focus goes back where it was (the header flag, say) when it closes
    const before = document.activeElement as HTMLElement | null;
    // focus starts on the hold button, so holding Enter or Space works
    // right away; with no hold, on the dialog itself, so a stray Enter
    // can't close it before it's read
    const start = root?.querySelector<HTMLElement>("[data-hold]");
    (start ?? root)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      // Esc closes it (unless you asked to hold), and must not reach a
      // dialog behind this one (Settings) either: listening in the
      // capture phase runs first
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!latest.current.hold) latest.current.onDone();
      }
      if (e.key !== "Tab" || !root) return;
      // only what Tab can reach: not a row sliding out, nor anything
      // hidden or not rendered, or the wrap below never sees the real last
      const focusables = [
        ...root.querySelectorAll<HTMLElement>("a[href], button"),
      ].filter(
        (e) =>
          !e.closest('[hidden], [aria-hidden="true"]') &&
          (e.checkVisibility?.() ?? true)
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!root.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      before?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="finish-title"
      aria-describedby={
        free ? "finish-done" : stats.length ? "finish-stats" : undefined
      }
      className="fixed inset-0 z-[200] flex flex-col items-center justify-end bg-black/30 pt-8 outline-none sm:justify-start sm:px-4 sm:pt-[8vh] sm:pb-8"
    >
      <section className="flex max-h-full w-full flex-col gap-5 rounded-t-2xl border border-line bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-ink shadow-2xl sm:max-h-[80vh] sm:max-w-[40rem] sm:rounded-2xl sm:p-6">
        <div className={`flex gap-3 ${free ? "items-center" : "items-start"}`}>
          {free && <FinishMark />}
          <div className="min-w-0 flex-1">
            {/* the action with its real number, ticking down live as
                      you merge or close */}
            <h2
              id="finish-title"
              className="m-0 text-xl leading-tight font-semibold tabular-nums"
              aria-live="polite"
            >
              {free
                ? "All finished"
                : found.toGo
                ? `Finish ${prCount(found.toGo)}`
                : "Nothing to finish"}
            </h2>
            {free && (
              <p id="finish-done" className="m-0 mt-1 text-sm text-ink-2">
                None of your open PRs are past your limits.
              </p>
            )}
            {/* why, in numbers you can act on: each one jumps to its PRs */}
            {!free && stats.length > 0 && (
              <p
                id="finish-stats"
                className="m-0 mt-1.5 text-sm text-ink-2 tabular-nums"
              >
                {stats.map((stat, i) => (
                  <span key={stat.key}>
                    {i > 0 && <span aria-hidden> · </span>}
                    <FactLink onClick={() => goTo(stat)}>{stat.text}</FactLink>
                  </span>
                ))}
              </p>
            )}
          </div>
          <div className="-mt-1 -mr-1 flex shrink-0 gap-0.5 self-start">
            <button
              type="button"
              aria-label="Finish line settings"
              title="Finish line settings"
              className={iconButton}
              onClick={() => {
                // close first, so Settings isn't under it
                onDone();
                window.dispatchEvent(
                  new CustomEvent("pd2:open-settings", {
                    detail: "finish-line",
                  })
                );
              }}
            >
              <Icon icon={SettingsIcon} size={16} />
            </button>
            {!hold && (
              <button
                type="button"
                aria-label="Close"
                title="Close (Esc)"
                data-close
                className={iconButton}
                onClick={onDone}
              >
                <Icon icon={X} size={16} />
              </button>
            )}
          </div>
        </div>
        {!free && (
          <>
            {/* the board's own sticky group headers, pinned to the top
                      of this list on the card's color instead of under the
                      app header on the canvas */}
            <div className="-mx-1 min-h-0 overflow-y-auto px-1 [--canvas:var(--surface)] [--header-h:0px]">
              <FinishList
                pulls={found.pulls}
                me={me}
                maxDays={maxDays}
                openIds={openIds}
              />
            </div>
            <p className="m-0 -mt-2 text-xs text-ink-3">Only you see this.</p>
            {hold && <HoldToClose onDone={onDone} />}
          </>
        )}
      </section>
    </div>
  );
}

/** The hold button: hold it down for HOLD_MS, by pointer, finger, Enter or
 * Space. The ring fills as you hold; letting go early springs it back, and a
 * quick click says to hold it. At the end it closes. */
function HoldToClose({ onDone }: { onDone: () => void }) {
  const [holding, setHolding] = useState(false);
  const [opened, setOpened] = useState(false);
  // a click too short to be a hold: the label teaches the gesture
  const [tapped, setTapped] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const tapTimer = useRef<number | undefined>(undefined);
  const since = useRef(0);
  // when a key was last let go: Firefox clicks a button on Space's keyup,
  // and that click must not pass for assistive tech's lone click
  const keyUpAt = useRef(0);
  const start = () => {
    if (timer.current !== undefined || opened) return;
    since.current = Date.now();
    setHolding(true);
    setTapped(false);
    timer.current = window.setTimeout(() => {
      setOpened(true);
      timer.current = window.setTimeout(onDone, OPEN_MS);
    }, HOLD_MS);
  };
  const stop = () => {
    if (opened || timer.current === undefined) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
    if (Date.now() - since.current < 500) {
      setTapped(true);
      clearTimeout(tapTimer.current);
      tapTimer.current = window.setTimeout(() => setTapped(false), 2000);
    }
  };
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(tapTimer.current);
    },
    []
  );
  const isPress = (key: string) => key === "Enter" || key === " ";
  // the ring fills while held, and snaps back when let go
  const sweep = holding ? `${HOLD_MS}ms linear` : "150ms ease-out";
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start();
      }}
      // screen readers, voice control and switch access send a lone click
      // with no pointer or key behind it (detail 0): they can't hold, so
      // that click closes it. A mouse click (detail 1+) or a held key
      // never gets here as detail 0.
      onClick={(e) => {
        if (e.detail !== 0 || holding || opened) return;
        if (Date.now() - keyUpAt.current < 1000) return;
        onDone();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if (!isPress(e.key)) return;
        e.preventDefault();
        if (!e.repeat) start();
      }}
      onKeyUp={(e) => {
        if (!isPress(e.key)) return;
        e.preventDefault();
        keyUpAt.current = Date.now();
        stop();
      }}
      onBlur={stop}
      onContextMenu={(e) => e.preventDefault()}
      data-hold
      className="pressable flex min-h-14 w-full shrink-0 touch-none items-center justify-center gap-3 rounded-xl border border-line px-4 py-2 select-none [-webkit-touch-callout:none] hover:border-brand hover:bg-secondary"
    >
      <span className="relative grid size-10 shrink-0 place-items-center">
        <svg
          aria-hidden
          viewBox="0 0 48 48"
          className="absolute inset-0"
          fill="none"
          strokeLinecap="round"
        >
          {/* the ring: a quiet track, filling with brand as you hold */}
          <circle
            cx="24"
            cy="24"
            r="22"
            className="stroke-line"
            strokeWidth={2}
          />
          <circle
            cx="24"
            cy="24"
            r="22"
            pathLength={1}
            strokeDasharray="1"
            className={opened ? "stroke-ok" : "stroke-brand"}
            strokeWidth={2}
            transform="rotate(-90 24 24)"
            style={{
              strokeDashoffset: holding || opened ? 0 : 1,
              transition: `stroke-dashoffset ${sweep}`,
            }}
          />
        </svg>
        <span
          className={`${opened ? "text-ok" : "text-ink-2"} ${
            holding || opened ? "" : "finish-flag-wiggle"
          }`}
          style={{ transformOrigin: "30% 90%" }}
        >
          <Icon icon={Flag} size={18} />
        </span>
      </span>
      <span className="text-[15px] font-semibold text-ink" aria-live="polite">
        {opened
          ? "Closing"
          : holding
          ? "Keep holding…"
          : tapped
          ? "Hold it down"
          : "Hold to close"}
      </span>
    </button>
  );
}

const pullId = (p: DerivedPull) => `${p.data.repo}#${p.data.number}`;

/** The PRs that just left `pulls` (merged or closed), kept for LEAVE_MS so
 * their rows can slide out instead of vanishing. */
function useLeaving(
  pulls: DerivedPull[],
  openIds: ReadonlySet<string>
): DerivedPull[] {
  const last = useRef(new Map<string, DerivedPull>());
  const [leaving, setLeaving] = useState<DerivedPull[]>([]);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const now = new Map(pulls.map((p) => [pullId(p), p]));
    // gone from the list and closed on the board; one that only stopped
    // counting (the rule switched, or it went draft) just leaves
    const gone = [...last.current]
      .filter(([id]) => !now.has(id) && !openIds.has(id))
      .map(([, p]) => p);
    last.current = now;
    if (!gone.length) return;
    setLeaving((l) => [...l, ...gone]);
    timers.current.push(
      window.setTimeout(
        () => setLeaving((l) => l.filter((p) => !gone.includes(p))),
        LEAVE_MS
      )
    );
    // keyed on pulls alone: openIds changes with every board update, and
    // it's only read to tell a close from a rule switch
  }, [pulls]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  // one that came back (reopened) is just a row again
  return leaving.filter((p) => !pulls.some((q) => pullId(q) === pullId(p)));
}

/** Slack-ready text chasing the reviews you asked for: each title, its
 * link, and who was asked. Only PRs with a request: a self-reviewed PR waits
 * on nobody, so there's no one to nudge about it. */
function nudgeText(rows: { pull: DerivedPull }[]): string {
  return [
    "A few of my PRs are waiting on a review I asked for:",
    ...rows.map(
      ({ pull: p }) =>
        `• ${p.data.title} ${githubUrl(p.data.repo, p.data.number)} (${askedOf(
          p
        ).join(", ")})`
    ),
  ].join("\n");
}

/** Copies nudgeText, and says whether it worked. */
function CopyNudge({ rows }: { rows: { pull: DerivedPull }[] }) {
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const done = (result: "copied" | "failed") => {
    setCopied(result);
    window.setTimeout(() => setCopied(null), 3000);
  };
  return (
    <QuietButton
      onClick={() => {
        if (!navigator.clipboard) return done("failed");
        navigator.clipboard.writeText(nudgeText(rows)).then(
          () => done("copied"),
          () => done("failed")
        );
      }}
    >
      {copied === "copied"
        ? "Copied"
        : copied === "failed"
        ? "Couldn’t copy"
        : "Copy a nudge"}
    </QuietButton>
  );
}

/** Your PRs, the way My work groups them, with the ready ones on top: the
 * quickest way out first, each group under the board's own header with a
 * word on what to do, oldest first. Someone else's PRs (the preview's
 * fallback) list flat, since their groups would be a reviewer's. */
function FinishList({
  pulls,
  me,
  maxDays,
  openIds,
}: {
  pulls: DerivedPull[];
  me: string;
  maxDays: number;
  openIds: ReadonlySet<string>;
}) {
  const leaving = useLeaving(pulls, openIds);
  const gone = new Set(leaving.map(pullId));
  const all = [...pulls, ...leaving];
  const mine = all.every((p) => p.data.user.login === me);
  const groups = mine
    ? finishGroups(all, me)
    : { ready: [], move: [], waiting: all.map((pull) => ({ pull })) };
  const live = (rows: { pull: DerivedPull }[]) =>
    rows.filter((r) => !gone.has(pullId(r.pull)));
  // the PRs waiting on people you asked, wherever they sit (a request gone
  // quiet past 4 hours is Your move); the copy button rides on the first
  // section holding one
  const asked = (rows: { pull: DerivedPull }[]) =>
    live(rows).filter((r) => askedOf(r.pull).length);
  const nudgeRows = asked([...groups.move, ...groups.waiting]);
  const sections = [
    {
      key: "ready" as const,
      title: STAGE_WORDS.ready,
      sub: "Merge these first",
      rows: groups.ready,
      ready: true,
    },
    {
      key: "move" as const,
      title: "Your move",
      sub: "Do the next step on each",
      rows: groups.move,
    },
    {
      key: "waiting" as const,
      title: "Waiting on others",
      sub: "Nudge whoever you asked, or close what you don’t need",
      rows: groups.waiting,
    },
  ].filter((g) => g.rows.length);
  const nudgeOn = sections.find((g) => !g.ready && asked(g.rows).length)?.title;
  return (
    <div className="flex flex-col gap-6">
      {sections.map((g) => (
        <section key={g.key} aria-label={mine ? g.title : undefined}>
          {mine && (
            <GroupHeader
              level={3}
              title={g.title}
              sub={g.sub}
              count={live(g.rows).length}
              headerExtra={
                g.title === nudgeOn ? <CopyNudge rows={nudgeRows} /> : undefined
              }
            />
          )}
          <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {g.rows.map(({ pull }) => (
              <FinishRow
                key={pullId(pull)}
                pull={pull}
                me={me}
                maxDays={maxDays}
                ready={Boolean(g.ready)}
                mine={mine}
                leaving={gone.has(pullId(pull))}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** One PR: the title to GitHub and its age, then the move and what it's
 * waiting on. */
function FinishRow({
  pull: p,
  me,
  maxDays,
  ready,
  mine,
  leaving,
}: {
  pull: DerivedPull;
  me: string;
  maxDays: number;
  ready: boolean;
  mine: boolean;
  /** merged or closed: it slides out */
  leaving?: boolean;
}) {
  const word = mine && !ready ? rowWord(p, me) : null;
  const context = mine ? rowNote(p, me).context : null;
  // a do row names the move, then the detail; a wait row's detail already
  // says who it waits on ("waiting on bob to re-stamp"), so the word only
  // stands in when there's no detail
  const move = word?.kind === "do" ? word.word : null;
  const detail = context ?? (word?.kind === "wait" ? word.word : null);
  const hint = mine && !ready ? askForInputHint(p) : null;
  const old = p.ageDays > maxDays;
  return (
    <li
      data-pull={leaving ? undefined : pullId(p)}
      className={`flex flex-col gap-1.5 py-3 ${
        leaving ? "finish-row-leave" : ""
      }`}
      aria-hidden={leaving || undefined}
    >
      <span className="flex items-baseline gap-4">
        <a
          href={githubUrl(p.data.repo, p.data.number)}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 text-sm leading-snug font-medium text-ink hover:underline"
        >
          {p.data.title} <span aria-hidden>↗</span>
        </a>
        {/* quiet even past the limit: the stat above already says how many
                are, and amber on every row would stop meaning "look here" */}
        <span
          className="shrink-0 text-xs text-ink-3 tabular-nums"
          title={`Open ${p.ageDays} days${
            old ? `, past the ${maxDays}-day limit` : ""
          }`}
        >
          {p.ageDays ? `${p.ageDays} days` : "today"}
        </span>
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
        <RepoRef repo={p.data.repo} number={p.data.number} />
        {move && (
          <span className="rounded-md bg-brand/10 px-1.5 py-0.5 font-medium whitespace-nowrap text-brand-700">
            {move}
          </span>
        )}
        {!ready && (
          <>
            <CiGlyph pull={p} />
            {/* the glyph is aria-hidden; say what it shows */}
            {p.ci === "failing" && <span className="sr-only">CI failing</span>}
            {p.ci === "pending" && <span className="sr-only">CI running</span>}
          </>
        )}
        {detail && <span className="min-w-0">{detail}</span>}
      </span>
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </li>
  );
}

/** A robot cheering at a checkered finish flag, drawn in the board's own
 * line weights and color tokens so it themes with everything else. */
function FinishMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 96 96"
      className="size-20 shrink-0 rounded-xl bg-secondary"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* the finish line on the ground */}
      <path
        d="M8 86 H88"
        className="stroke-ink-3"
        strokeWidth={2}
        strokeDasharray="4 4"
      />
      {/* the flag: a pole and a checkered cloth */}
      <path d="M72 86 V12" className="stroke-ink-3" strokeWidth={2.5} />
      <rect
        x="72"
        y="12"
        width="18"
        height="14"
        className="fill-surface stroke-ink-2"
        strokeWidth={1.5}
      />
      <path
        d="M72 12 h6 v4.67 h-6 Z M84 12 h6 v4.67 h-6 Z M78 16.67 h6 v4.67 h-6 Z M72 21.33 h6 v4.67 h-6 Z M84 21.33 h6 v4.67 h-6 Z"
        className="fill-ink-2"
      />
      {/* an upright antenna with a lit tip */}
      <path d="M36 24 V16" className="stroke-ink-3" strokeWidth={2} />
      <circle cx="36" cy="13" r="3" className="fill-brand" />
      {/* head, and a happy face on its screen */}
      <rect
        x="16"
        y="24"
        width="40"
        height="30"
        rx="10"
        className="fill-surface stroke-ink-2"
        strokeWidth={2}
      />
      <path
        d="M26 38 Q29 34 32 38 M40 38 Q43 34 46 38"
        className="stroke-ink-2"
        strokeWidth={2}
      />
      <path d="M28 44 Q36 51 44 44" className="stroke-ink-2" strokeWidth={2} />
      {/* body, one arm up at the flag, one down */}
      <rect
        x="23"
        y="58"
        width="26"
        height="22"
        rx="6"
        className="fill-surface stroke-ink-2"
        strokeWidth={2}
      />
      <path
        d="M49 63 Q60 58 68 46 M23 63 Q17 67 15 73"
        className="stroke-ink-2"
        strokeWidth={2}
      />
      <circle
        cx="69"
        cy="44"
        r="2.5"
        className="fill-surface stroke-ink-2"
        strokeWidth={2}
      />
    </svg>
  );
}
