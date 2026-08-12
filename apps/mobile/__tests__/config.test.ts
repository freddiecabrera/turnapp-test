// `API_URL` is computed at module load time, so every case here has to install
// its mocks *before* `src/config` is first required. `jest.resetModules()` plus
// a dynamic `require` gives each case a clean module registry — and that seam,
// not a widened export surface, is what makes the precedence chain assertable:
// `API_URL` is `resolveApiUrl()`, so re-loading the module under each set of
// mocks reaches the same branches without the app shipping helpers it does not
// otherwise need.

/**
 * Which of the three fields config.ts falls through in turn carries the host.
 * `expoConfig` is a dev build talking to a local Metro; the other two are how
 * Expo Go reports the same thing, and which one is populated depends on the
 * client version — so a phone in Expo Go is exactly the case tiers 2 and 3 are
 * there for, and exactly the one a single-tier mock cannot reach.
 */
type HostSource = "expoConfig" | "expoGoConfig" | "manifest2";

type LoadOptions = {
  /** Value for EXPO_PUBLIC_API_URL; omit to leave the override unset. */
  apiUrlOverride?: string;
  /** Expo dev-server host, e.g. "10.0.0.75:8081". */
  hostUri?: string;
  /** Where `hostUri` is reported; defaults to the dev-build field. */
  hostSource?: HostSource;
  platform?: "ios" | "android";
};

// Only the chosen tier is populated, so the lower ones have to be reached by
// the `??` chain rather than by a field that happens to be set anyway.
function mockConstants(hostUri: string | undefined, hostSource: HostSource) {
  if (!hostUri) return { expoConfig: null };
  switch (hostSource) {
    case "expoConfig":
      return { expoConfig: { hostUri } };
    case "expoGoConfig":
      return { expoConfig: null, expoGoConfig: { debuggerHost: hostUri } };
    case "manifest2":
      return {
        expoConfig: null,
        manifest2: { extra: { expoGo: { debuggerHost: hostUri } } },
      };
  }
}

function loadConfig(options: LoadOptions = {}) {
  const { apiUrlOverride, hostUri, hostSource = "expoConfig", platform = "ios" } = options;

  jest.resetModules();

  if (apiUrlOverride === undefined) {
    delete process.env.EXPO_PUBLIC_API_URL;
  } else {
    process.env.EXPO_PUBLIC_API_URL = apiUrlOverride;
  }

  // config.ts only reads the three host fields and `Platform.OS`, so narrow
  // module mocks are enough and keep each case hermetic.
  jest.doMock("expo-constants", () => ({
    __esModule: true,
    default: mockConstants(hostUri, hostSource),
  }));
  jest.doMock("react-native", () => ({ Platform: { OS: platform } }));

  return require("../src/config") as typeof import("../src/config");
}

afterEach(() => {
  delete process.env.EXPO_PUBLIC_API_URL;
  jest.resetModules();
});

describe("API_URL", () => {
  it("prefers the EXPO_PUBLIC_API_URL override over everything else", () => {
    const { API_URL } = loadConfig({
      apiUrlOverride: "https://api.turn.app",
      // Both lower-precedence sources are available and must be ignored.
      hostUri: "10.0.0.75:8081",
      platform: "android",
    });

    expect(API_URL).toBe("https://api.turn.app");
  });

  // Also pins that the dev server's own port is dropped before 4000 is added.
  it.each<[string, HostSource]>([
    ["a dev build reports it as expoConfig.hostUri", "expoConfig"],
    ["Expo Go reports it as expoGoConfig.debuggerHost", "expoGoConfig"],
    ["Expo Go reports it under manifest2", "manifest2"],
  ])("falls back to the Expo dev-server host on port 4000 when %s", (_case, hostSource) => {
    const { API_URL } = loadConfig({ hostUri: "10.0.0.75:8081", hostSource });

    expect(API_URL).toBe("http://10.0.0.75:4000");
  });

  it("falls back to localhost:4000 on iOS when there is no dev host", () => {
    const { API_URL } = loadConfig({ platform: "ios" });

    expect(API_URL).toBe("http://localhost:4000");
  });

  it("falls back to 10.0.2.2:4000 on Android when there is no dev host", () => {
    const { API_URL } = loadConfig({ platform: "android" });

    expect(API_URL).toBe("http://10.0.2.2:4000");
  });
});

describe("resolveImageUrl", () => {
  it("passes null through", () => {
    const { resolveImageUrl } = loadConfig({ platform: "ios" });

    expect(resolveImageUrl(null)).toBeNull();
  });

  it("passes an absolute URL through untouched", () => {
    const { resolveImageUrl } = loadConfig({ platform: "ios" });

    expect(resolveImageUrl("https://cdn.turn.app/card.png")).toBe(
      "https://cdn.turn.app/card.png"
    );
  });

  it("joins a relative path that already has a leading slash", () => {
    const { resolveImageUrl } = loadConfig({ platform: "ios" });

    expect(resolveImageUrl("/static/cards/ace.png")).toBe(
      "http://localhost:4000/static/cards/ace.png"
    );
  });

  it("inserts the missing slash for a relative path without one", () => {
    const { resolveImageUrl } = loadConfig({ platform: "ios" });

    expect(resolveImageUrl("static/cards/ace.png")).toBe(
      "http://localhost:4000/static/cards/ace.png"
    );
  });
});
