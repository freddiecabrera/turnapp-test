export const colors = {
  black: "#0a0a0a",
  white: "#ffffff",
  grey: "#8a8a8a",
  lightGrey: "#e6e6e6",
  bg: "#ffffff",
  gold: "#d9a520",
  marble: "#141414",
  locked: "#d4d4d4",
};

// Font families are registered in app/_layout.tsx via expo-font.
export const fonts = {
  bold: "TurnNuevo-Bold",
  regular: "TurnNuevo-Regular",
  script: "BiroScriptPlus",
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
};

/**
 * The proportions of a turn card.
 *
 * Every image in `apps/api/static/cards` is exported at 575 × 1198, and so is
 * `assets/images/card-back.png` — a ratio of 0.48. A turn card is much taller
 * than the 0.7 of a physical trading card: header bar, art, name, rarity pips,
 * universe, type badge and the card's story, stacked.
 *
 * Here rather than beside any one component because four surfaces draw a card
 * and they have to agree. Held in a box of the wrong shape by `cover`, the
 * card's whole bottom third is cropped away mid-sentence — which is what every
 * one of them did until this became a single number.
 */
export const CARD_ASPECT = 575 / 1198;
