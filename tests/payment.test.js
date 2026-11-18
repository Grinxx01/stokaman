const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadApp() {
  const elements = new Map();
  const el = (selector) => {
    if (!elements.has(selector)) {
      elements.set(selector, {
        style: {},
        dataset: {},
        classList: {
          classes: new Set(),
          add(c) { this.classes.add(c); },
          remove(c) { this.classes.delete(c); },
          toggle(c, v) { if (v) this.classes.add(c); else this.classes.delete(c); },
          contains(c) { return this.classes.has(c); }
        },
        options: [],
        selectedIndex: 0,
        value: "",
        textContent: "",
        innerHTML: "",
        disabled: false,
        addEventListener() {},
        focus() {},
        select() {},
        click() {}
      });
    }
    return elements.get(selector);
  };

  class FakeHtml5Qrcode {
    static async getCameras() { return []; }
    constructor() { this.isScanning = false; }
    async start() { this.isScanning = true; }
    async stop() { this.isScanning = false; }
    clear() {}
  }

  const sandbox = {
    document: {
      querySelector: el,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => ({ set textContent(v) { this.innerHTML = String(v); } })
    },
    window: { isSecureContext: true },
    location: { hostname: "localhost" },
    Html5Qrcode: FakeHtml5Qrcode,
    setTimeout,
    clearTimeout,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("public/app.js", "utf8"), sandbox);
  return { sandbox, el, state: vm.runInContext("state", sandbox) };
}

test("cart total calculation and cash change calculation", () => {
  const { sandbox, el, state } = loadApp();

  state.cart.set("item-1", {
    product: { id: "item-1", name: "Susu UHT", price: 6500, stock: 10 },
    qty: 2
  });
  state.cart.set("item-2", {
    product: { id: "item-2", name: "Roti Cokelat", price: 12000, stock: 5 },
    qty: 1
  });

  const total = sandbox.getCartTotal();
  assert.equal(total, 25000); // (6500 * 2) + 12000 = 25000

  // Uang pas
  el("#cash-input").value = "25000";
  sandbox.updateCashChange(total);
  assert.equal(el("#cash-change").textContent, "Rp 0");
  assert.equal(el("#btn-confirm-payment").disabled, false);

  // Uang lebih (kembalian 25.000 dari 50.000)
  el("#cash-input").value = "50000";
  sandbox.updateCashChange(total);
  assert.equal(el("#cash-change").textContent, "Rp 25.000");
  assert.equal(el("#btn-confirm-payment").disabled, false);

  // Uang kurang (20.000 dari 25.000)
  el("#cash-input").value = "20000";
  sandbox.updateCashChange(total);
  assert.match(el("#cash-change").textContent, /Kurang/);
  assert.equal(el("#btn-confirm-payment").disabled, true);
});

