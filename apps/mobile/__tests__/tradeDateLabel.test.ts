import { copy, fill } from "../src/copy";
import { tradeDateLabel } from "../src/trade";
import { trade } from "../test/trading";

/**
 * The date on a board row, which reads relatively for the first week.
 *
 * The case worth writing a suite for is `yesterday`. "Days ago" computed as
 * elapsed milliseconds over 86,400,000 is the obvious implementation and it is
 * wrong in the one place people notice: a trade sent at 11pm is yesterday's
 * from midnight, not from 11pm tomorrow. So these fix the clock and move the
 * timestamp around it, rather than the other way round.
 *
 * Everything here is built in local time on purpose — the boundary the label
 * turns on is the device's midnight, and a fixture written in UTC would drift
 * across it depending on where the suite runs.
 */

/** Local midnight, `days` back, plus an optional time of day. */
function daysBack(days: number, hours = 12): Date {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  d.setHours(hours, 0, 0, 0);
  return d;
}

/** A fixed "now": mid-afternoon, mid-month, so no case straddles a boundary. */
const NOW = new Date(2026, 7, 12, 15, 30, 0);

const labelFor = (createdAt: Date | string) =>
  tradeDateLabel(trade({ createdAt: typeof createdAt === "string" ? createdAt : createdAt.toISOString() }));

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterAll(() => {
  jest.useRealTimers();
});

describe("the first week reads relatively", () => {
  it("calls a trade from earlier today `today`", () => {
    expect(labelFor(daysBack(0, 9))).toBe(copy.board.date.today);
  });

  it("still calls a trade from one minute ago `today`", () => {
    expect(labelFor(new Date(NOW.getTime() - 60_000))).toBe(copy.board.date.today);
  });

  it("calls last night `yesterday` rather than today", () => {
    // 11pm yesterday, read at 3:30pm today: sixteen hours elapsed, which an
    // elapsed-time division would round to zero days and call `today`.
    expect(labelFor(daysBack(1, 23))).toBe(copy.board.date.yesterday);
  });

  it("counts days for the rest of the week", () => {
    expect(labelFor(daysBack(2))).toBe(fill(copy.board.date.daysAgo, { count: 2 }));
    expect(labelFor(daysBack(6))).toBe(fill(copy.board.date.daysAgo, { count: 6 }));
  });
});

describe("past a week it is a date again", () => {
  // `47d ago` is not a date anybody pictures, so the label stops counting. The
  // exact string is the device's, so these assert on what it is NOT — a
  // relative phrase — rather than pinning a format this file does not own.
  const relativePhrases = [
    copy.board.date.today,
    copy.board.date.yesterday,
    fill(copy.board.date.daysAgo, { count: 7 }),
    fill(copy.board.date.daysAgo, { count: 40 }),
  ];

  it.each([7, 8, 40, 400])("falls back to the device's date at %i days", (days) => {
    const label = labelFor(daysBack(days));

    expect(label).not.toBe("");
    expect(relativePhrases).not.toContain(label);
  });
});

describe("timestamps the label cannot trust", () => {
  it("draws nothing at all for one it cannot parse", () => {
    // Both call sites test for the empty string and render no date, so an
    // unreadable timestamp costs a gap rather than the words "Invalid Date".
    expect(labelFor("not a date")).toBe("");
  });

  it("does not count backwards from a timestamp in the future", () => {
    // A device clock a few minutes behind the server produces exactly this,
    // and `-0d ago` would be the visible result of testing days loosely.
    const label = labelFor(new Date(NOW.getTime() + 5 * 60_000));

    expect(label).not.toContain("-");
    expect(label).not.toBe(fill(copy.board.date.daysAgo, { count: -0 }));
  });
});
