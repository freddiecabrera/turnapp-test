// Default Expo Metro config.
//
// The mobile app is intentionally NOT an npm workspace and keeps its own
// complete node_modules, so Metro's default nearest-first resolution already
// loads this app's React 19 (not the repo-root React used by the admin app).
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

module.exports = config;
