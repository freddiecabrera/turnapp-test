// `API_URL` is computed at module load time, so every case here has to install
// its mocks *before* `src/config` is first required. `jest.resetModules()` plus
// a dynamic `require` gives each case a clean module registry.

type LoadOptions = {
  /** Value for EXPO_PUBLIC_API_URL; omit to leave the override unset. */
  apiUrlOverride?: string;
  /** Expo dev-server host, e.g. "10.0.0.75:8081". */
  hostUri?: string;
  platform?: "ios" | "android";
};

function loadConfig(options: LoadOptions = {}) {
  const { apiUrlOverride, hostUri, platform = "ios" } = options;

  jest.resetModules();

  if (apiUrlOverride === undefined) {
    delete process.env.EXPO_PUBLIC_API_URL;
  } else {
    process.env.EXPO_PUBLIC_API_URL = apiUrlOverride;
  }

  // config.ts only reads `Constants.expoConfig?.hostUri` and `Platform.OS`, so
  // narrow module mocks are enough and keep each case hermetic.
  jest.doMock("expo-constants", () => ({
    __esModule: true,
    default: { expoConfig: hostUri ? { hostUri } : null },
  }));
  jest.doMock("react-native", () => ({ Platform: { OS: platform } }));

  return require("../src/config") as typeof import("../src/config");
}

afterEach(() => {
  delete process.env.EXPO_PUBLIC_API_URL;
  jest.resetModules();
});

describe("resolveApiUrl", () => {
  it("prefers the EXPO_PUBLIC_API_URL override over everything else", () => {
    const { resolveApiUrl, API_URL } = loadConfig({
      apiUrlOverride: "https://api.turn.app",
      // Both lower-precedence sources are available and must be ignored.
      hostUri: "10.0.0.75:8081",
      platform: "android",
    });

    expect(resolveApiUrl()).toBe("https://api.turn.app");
    expect(API_URL).toBe("https://api.turn.app");
  });

  it("falls back to the Expo dev-server host on port 4000", () => {
    const { resolveApiUrl, API_URL } = loadConfig({ hostUri: "10.0.0.75:8081" });

    expect(resolveApiUrl()).toBe("http://10.0.0.75:4000");
    expect(API_URL).toBe("http://10.0.0.75:4000");
  });

  it("falls back to localhost:4000 on iOS when there is no dev host", () => {
    const { resolveApiUrl, API_URL } = loadConfig({ platform: "ios" });

    expect(resolveApiUrl()).toBe("http://localhost:4000");
    expect(API_URL).toBe("http://localhost:4000");
  });

  it("falls back to 10.0.2.2:4000 on Android when there is no dev host", () => {
    const { resolveApiUrl, API_URL } = loadConfig({ platform: "android" });

    expect(resolveApiUrl()).toBe("http://10.0.2.2:4000");
    expect(API_URL).toBe("http://10.0.2.2:4000");
  });
});

describe("deriveDevHost", () => {
  it("strips the port off the Expo dev-server hostUri", () => {
    const { deriveDevHost } = loadConfig({ hostUri: "10.0.0.75:8081" });

    expect(deriveDevHost()).toBe("10.0.0.75");
  });

  it("returns null when Expo reports no host", () => {
    const { deriveDevHost } = loadConfig();

    expect(deriveDevHost()).toBeNull();
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
