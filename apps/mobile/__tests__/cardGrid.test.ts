import {
  GRID_COLUMNS,
  GRID_GAP,
  GRID_PADDING,
  gridCellWidth,
} from "../src/components/CardPicker";

/**
 * The wizard's card grid measures its own cells.
 *
 * It has to, because `flex: 1` is what produced the bug: a `FlatList` with
 * `numColumns={3}` lays a short final row out as a row of that many flexible
 * children, so a collection of seven drew six normal cards and then one card
 * three times the size of its neighbours, and a collection of four drew a
 * full-width one. A card is not supposed to change size according to how many
 * other cards happen to exist.
 *
 * A measured cell trades that for a different failure: the arithmetic here and
 * the padding a screen actually applies can drift apart, and the grid then
 * overflows or leaves a ragged margin. So the property worth pinning is that a
 * full row of cells plus its gutters comes to exactly the window width — which
 * is only true while `GRID_PADDING` and `GRID_GAP` are what the screens use,
 * and both import them from here.
 */

/** Every phone width the app is likely to meet, plus the extremes. */
const WIDTHS = [320, 360, 375, 390, 393, 414, 428, 440, 768, 1024];

describe("a full row exactly fills the window", () => {
  it.each(WIDTHS)("at %ipt", (windowWidth) => {
    const cell = gridCellWidth(windowWidth);
    const gutters = GRID_PADDING * 2 + GRID_GAP * (GRID_COLUMNS - 1);

    expect(cell * GRID_COLUMNS + gutters).toBeCloseTo(windowWidth, 5);
  });
});

describe("the width does not depend on what is in the row", () => {
  it("is one number per window, whatever the collection size", () => {
    // The regression in one line: `gridCellWidth` takes the window and nothing
    // else, so a row holding one card cannot be measured differently from a row
    // holding three. Anything that reintroduces item-count sensitivity has to
    // change this signature to do it.
    expect(gridCellWidth(390)).toBe(gridCellWidth(390));
    expect(gridCellWidth.length).toBe(1);
  });

  it("leaves room for the gaps rather than dividing the window three ways", () => {
    // The naive version — `width / 3` — overflows by exactly the gutters, and
    // does it invisibly on the last column.
    expect(gridCellWidth(390)).toBeLessThan(390 / GRID_COLUMNS);
  });
});

describe("cells stay usable on the narrowest phones", () => {
  it.each(WIDTHS)("draws a card wide enough to recognise at %ipt", (windowWidth) => {
    // Not a layout assertion — a legibility floor. A cell narrower than this
    // renders a card whose name and art are too small to choose between, which
    // is the whole job of these two screens.
    expect(gridCellWidth(windowWidth)).toBeGreaterThan(80);
  });
});
