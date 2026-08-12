import { rarityColor } from "../src/components/CardTile";

// The expected values are written out as literals rather than read back out of
// RARITY_COLORS or the theme, so that an accidental palette edit fails the test
// instead of silently redefining what "correct" means.
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
    expect(rarityColor("sparkle")).toBe("#e6e6e6");
  });

  it("falls back to light grey for a null rarity", () => {
    expect(rarityColor(null)).toBe("#e6e6e6");
  });

  it("falls back to light grey for an empty rarity", () => {
    expect(rarityColor("")).toBe("#e6e6e6");
  });
});
