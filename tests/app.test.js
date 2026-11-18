const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadApp({ cameras = [], facingMode = "environment" } = {}) {
  const elements = new Map();
  const el = (selector) => {
    if (!elements.has(selector)) {
      elements.set(selector, {
        style: {},
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        options: [],
        selectedIndex: 0,
        value: "",
        textContent: "",
        innerHTML: "",
        clientWidth: 640,
        addEventListener() {},
        focus() {},
        click() {},
        appendChild() {},
        removeChild() {}
      });
    }
    return elements.get(selector);
  };

  class FakeHtml5Qrcode {
    static async getCameras() { return cameras; }
    constructor() { this.isScanning = false; }
    async start() { this.isScanning = true; }
    async stop() { this.isScanning = false; }
    clear() {}
    getRunningTrackSettings() { return { facingMode }; }
  }

  const sandbox = {
    document: {
      querySelector: el,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => ({ set textContent(v) { this.innerHTML = String(v); } })
    },
    window: { isSecureContext: true, Html5QrcodeSupportedFormats: new Proxy({}, { get: (_, key) => key }) },
    location: { hostname: "localhost" },
    Html5Qrcode: FakeHtml5Qrcode,
    Html5QrcodeSupportedFormats: new Proxy({}, { get: (_, key) => key }),
    setTimeout,
    clearTimeout,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("public/app.js", "utf8"), sandbox);
  return { sandbox, el, state: vm.runInContext("state", sandbox) };
}

test("empty camera list clears stale choices", async () => {
  const { sandbox, el, state } = loadApp({ cameras: [] });
  state.availableCameras = [{ id: "old" }];
  el("#camera-select").innerHTML = "<option>old</option>";

  await sandbox.updateCameraList();

  assert.equal(state.availableCameras.length, 0);
  assert.equal(el("#camera-select").innerHTML, "");
});

test("camera label follows the camera the browser opened", async () => {
  const { sandbox, el, state } = loadApp({ cameras: [], facingMode: "user" });

  await sandbox.startScanner(() => {});

  assert.equal(state.facingMode, "user");
  assert.equal(el("#camera-mode-label").textContent, "Kamera Depan");
});

test("concurrent stops share one promise", async () => {
  const { sandbox } = loadApp();

  const first = sandbox.stopScanner();
  const second = sandbox.stopScanner();

  assert.equal(first, second);
  await first;
});
