import { rarityColor } from "../src/components/CardTile";
import { colors } from "../src/theme";

// The expected values are written out as literals rather than read back out of
// RARITY_COLORS, so that an accidental palette edit fails the test instead of
// silently redefining what "correct" means.
describe("rarityColor", () => {
  it.each([
    ["daycard", "#9aa0a6"],
    ["glow", "#5bc0de"],
    ["pulse", "#f5a623"],
    ["mythic", "#b06ef0"],
    ["heavenmade", "#d9a520"],
  ])("maps the %s rarity to its accent colour", (rarity, expected) => {
    expect(rarityColor(rarity)).toBe(expected);
  });

  it("falls back to light grey for an unknown rarity", () => {
    expect(rarityColor("sparkle")).toBe(colors.lightGrey);
  });

  it("falls back to light grey for a null rarity", () => {
    expect(rarityColor(null)).toBe(colors.lightGrey);
  });

  it("falls back to light grey for an empty rarity", () => {
    expect(rarityColor("")).toBe(colors.lightGrey);
  });
});
