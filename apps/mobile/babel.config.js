module.exports = function (api) {
  api.cache(true);
  // babel-preset-expo (SDK 54) automatically configures the Reanimated /
  // Worklets babel plugin, so no manual plugin entry is needed.
  return {
    presets: ["babel-preset-expo"],
  };
};
