const state = {
  products: [],
  cart: new Map(),
  html5QrCode: null,
  scanning: false,
  scanTarget: "kasir",
  editingId: null
};

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => "Rp " + Number(n).toLocaleString("id-ID");

function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (res.status === 204) return null;
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Terjadi kesalahan");
  return body.data;
}

function expiryStatus(expiry) {
  if (!expiry) return { cls: "none", label: "Tidak diatur" };
  const today = new Date();
  const exp = new Date(expiry + "T00:00:00");
  const days = Math.floor((exp - today) / 86400000);
  if (days < 0) return { cls: "expired", label: "Kadaluarsa" };
  if (days <= 7) return { cls: "soon", label: `Sisa ${days} hari` };
  return { cls: "ok", label: "Aman" };
}

function openModal(id) {
  $("#" + id).classList.add("open");
}

function closeModal(id) {
  $("#" + id).classList.remove("open");
}

async function startScanner(onDecode) {
  if (state.scanning) return;
  const formats = [
    "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"
  ];
  state.html5QrCode = new Html5Qrcode("reader", { formatsToSupport: formats });
  state.scanning = true;
  try {
    await state.html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 260, height: 160 } },
      (text) => {
        stopScanner();
        onDecode(text);
      }
    );
  } catch (err) {
    state.scanning = false;
    toast("Kamera tidak dapat diakses: " + err.message, true);
  }
}

async function stopScanner() {
  if (!state.scanning || !state.html5QrCode) return;
  try {
    await state.html5QrCode.stop();
  } catch {}
  state.html5QrCode.clear();
  state.html5QrCode = null;
  state.scanning = false;
}

async function handleBarcode(barcode) {
  try {
    const product = await api(`/api/products/lookup/${encodeURIComponent(barcode)}`);
    const existing = product.id !== undefined;
    if (state.scanTarget === "kasir" && existing) {
      addToCart(product);
      return;
    }
    fillForm(product, existing);
    openModal("form-modal");
  } catch (err) {
    toast(err.message, true);
  }
}

function fillForm(product, exists) {
  state.editingId = exists ? product.id : null;
  $("#form-title").textContent = exists ? "Ubah Barang" : "Tambah Barang";
  $("#f-barcode").value = product.barcode;
  $("#f-name").value = product.name ?? "";
  $("#f-category").value = product.category ?? "";
  $("#f-price").value = exists ? product.price : "";
  $("#f-stock").value = exists ? product.stock : "";
  $("#f-expiry").value = product.expiry_date ?? "";
  const hint = $("#expiry-hint");
  if (!exists && product.suggested_expiry_date) {
    hint.textContent = `Saran kadaluarsa otomatis: ${product.suggested_expiry_date}`;
  } else {
    hint.textContent = "";
  }
}

async function refreshProducts() {
  try {
    state.products = await api("/api/products");
    renderKasirProducts();
    renderStok();
  } catch (err) {
    toast(err.message, true);
  }
}

function renderKasirProducts() {
  const query = $("#kasir-search").value.toLowerCase();
  const filtered = state.products.filter((p) =>
    p.name.toLowerCase().includes(query) || p.barcode.includes(query)
  );
  $("#kasir-products").innerHTML = filtered
    .filter((p) => p.stock > 0)
    .map((p) => `
      <div class="product-tile" data-barcode="${p.barcode}">
        <div class="p-name">${esc(p.name)}</div>
        <div class="p-price">${fmt(p.price)}</div>
        <div class="p-stock">Stok: ${p.stock}</div>
      </div>
    `)
    .join("") || `<p class="empty">Tidak ada produk.</p>`;
}

function renderStok() {
  const query = $("#stok-search").value.toLowerCase();
  const filtered = state.products.filter((p) =>
    p.name.toLowerCase().includes(query) || p.barcode.includes(query)
  );

  const alerts = [];
  for (const p of filtered) {
    if (p.expiry_date) {
      const status = expiryStatus(p.expiry_date);
      if (status.cls === "expired") alerts.push(`<div class="alert expired">${esc(p.name)} sudah kadaluarsa (${p.expiry_date})</div>`);
      else if (status.cls === "soon") alerts.push(`<div class="alert soon">${esc(p.name)} mendekati kadaluarsa (${p.expiry_date})</div>`);
    }
    if (p.stock <= 5) alerts.push(`<div class="alert soon">Stok ${esc(p.name)} tinggal ${p.stock}</div>`);
  }
  $("#stok-alerts").innerHTML = alerts.slice(0, 8).join("");

  $("#stok-body").innerHTML = filtered
    .map((p) => {
      const status = expiryStatus(p.expiry_date);
      return `
      <tr>
        <td>${p.barcode}</td>
        <td>${esc(p.name)}</td>
        <td>${fmt(p.price)}</td>
        <td>${p.stock}</td>
        <td>${p.expiry_date ?? "-"}</td>
        <td><span class="badge ${status.cls}">${status.label}</span></td>
        <td>
          <div class="actions">
            <button class="mini-btn" data-restock="${p.id}" data-amount="10">+10</button>
            <button class="mini-btn danger" data-delete="${p.id}">Hapus</button>
          </div>
        </td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="7" style="text-align:center;color:var(--muted)">Belum ada produk. Klik Tambah Barang untuk mulai.</td></tr>`;
}

function esc(text) {
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

function addToCart(product) {
  if (product.stock <= 0) {
    toast("Stok habis", true);
    return;
  }
  const current = state.cart.get(product.id) ?? { product, qty: 0 };
  if (current.qty + 1 > product.stock) {
    toast("Stok tidak cukup", true);
    return;
  }
  current.qty += 1;
  state.cart.set(product.id, current);
  renderCart();
}

function renderCart() {
  const items = [...state.cart.values()];
  if (items.length === 0) {
    $("#cart").innerHTML = `<p class="empty">Keranjang masih kosong. Scan barang untuk mulai.</p>`;
  } else {
    $("#cart").innerHTML = items
      .map(({ product, qty }) => `
        <div class="cart-item">
          <span class="name">${esc(product.name)}</span>
          <button class="qty-btn" data-cart-minus="${product.id}">-</button>
          <span>${qty}</span>
          <button class="qty-btn" data-cart-plus="${product.id}">+</button>
          <span style="min-width:80px;text-align:right">${fmt(product.price * qty)}</span>
        </div>
      `)
      .join("");
  }
  const total = items.reduce((sum, { product, qty }) => sum + product.price * qty, 0);
  $("#cart-total").textContent = fmt(total);
  $("#checkout-btn").disabled = items.length === 0;
}

async function checkout() {
  const items = [...state.cart.values()].map(({ product, qty }) => ({
    product_id: product.id,
    qty
  }));
  try {
    await api("/api/transactions", {
      method: "POST",
      body: JSON.stringify({ items })
    });
    state.cart.clear();
    renderCart();
    await refreshProducts();
    toast("Transaksi berhasil");
  } catch (err) {
    toast(err.message, true);
  }
}

async function loadHistory() {
  try {
    const transactions = await api("/api/transactions");
    $("#riwayat").innerHTML = transactions
      .map((t) => {
        const items = t.transaction_items ?? [];
        return `
        <div class="history-item">
          <div class="h-head">
            <span>${new Date(t.created_at).toLocaleString("id-ID")}</span>
            <span>${fmt(t.total)}</span>
          </div>
          <div class="h-items">${items.map((i) => `${i.products?.name ?? "-"} x${i.qty}`).join(", ")}</div>
        </div>`;
      })
      .join("") || `<p class="empty">Belum ada transaksi.</p>`;
  } catch (err) {
    toast(err.message, true);
  }
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $("#tab-" + tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "riwayat") loadHistory();
  });
});

$("#kasir-scan-btn").addEventListener("click", () => {
  state.scanTarget = "kasir";
  $("#scan-title").textContent = "Scan Barcode";
  openModal("scan-modal");
  startScanner((barcode) => {
    closeModal("scan-modal");
    handleBarcode(barcode);
  });
});

$("#stok-add-btn").addEventListener("click", () => {
  state.scanTarget = "stok";
  state.editingId = null;
  $("#form-title").textContent = "Tambah Barang";
  $("#product-form").reset();
  $("#expiry-hint").textContent = "";
  openModal("form-modal");
});

$("#form-scan-btn").addEventListener("click", () => {
  closeModal("form-modal");
  state.scanTarget = "stok";
  $("#scan-title").textContent = "Scan Barcode";
  openModal("scan-modal");
  startScanner(async (barcode) => {
    closeModal("scan-modal");
    try {
      const product = await api(`/api/products/lookup/${encodeURIComponent(barcode)}`);
      fillForm(product, product.id !== undefined);
      openModal("form-modal");
    } catch (err) {
      toast(err.message, true);
    }
  });
});

$("#kasir-barcode").addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const barcode = e.target.value.trim();
  if (!barcode) return;
  e.target.value = "";
  await handleBarcode(barcode);
});

$("#kasir-search").addEventListener("input", renderKasirProducts);
$("#stok-search").addEventListener("input", renderStok);

$("#checkout-btn").addEventListener("click", checkout);

$("#product-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    barcode: $("#f-barcode").value.trim(),
    name: $("#f-name").value.trim(),
    category: $("#f-category").value.trim() || null,
    price: Number($("#f-price").value),
    stock: Number($("#f-stock").value),
    expiry_date: $("#f-expiry").value || null
  };
  try {
    if (state.editingId) {
      await api(`/api/products/${state.editingId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
    } else {
      await api("/api/products", {
        method: "POST",
        body: JSON.stringify(payload)
      });
    }
    closeModal("form-modal");
    await refreshProducts();
    toast("Barang tersimpan");
  } catch (err) {
    toast(err.message, true);
  }
});

document.addEventListener("click", async (e) => {
  const tile = e.target.closest(".product-tile");
  if (tile) {
    const product = state.products.find((p) => p.barcode === tile.dataset.barcode);
    if (product) addToCart(product);
  }

  const minus = e.target.closest("[data-cart-minus]");
  const plus = e.target.closest("[data-cart-plus]");
  if (minus || plus) {
    const id = (minus ?? plus).dataset.cartMinus ?? (minus ?? plus).dataset.cartPlus;
    const entry = state.cart.get(id);
    if (!entry) return;
    if (minus) {
      entry.qty -= 1;
      if (entry.qty <= 0) state.cart.delete(id);
    } else {
      if (entry.qty + 1 > entry.product.stock) {
        toast("Stok tidak cukup", true);
        return;
      }
      entry.qty += 1;
    }
    renderCart();
  }

  const restock = e.target.closest("[data-restock]");
  if (restock) {
    try {
      await api(`/api/products/${restock.dataset.restock}/restock`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(restock.dataset.amount) })
      });
      await refreshProducts();
      toast("Stok ditambahkan");
    } catch (err) {
      toast(err.message, true);
    }
  }

  const del = e.target.closest("[data-delete]");
  if (del && confirm("Hapus produk ini?")) {
    try {
      await api(`/api/products/${del.dataset.delete}`, { method: "DELETE" });
      await refreshProducts();
      toast("Produk dihapus");
    } catch (err) {
      toast(err.message, true);
    }
  }

  const close = e.target.closest("[data-close]");
  if (close) {
    closeModal(close.dataset.close);
    if (close.dataset.close === "scan-modal") stopScanner();
  }
});

document.querySelectorAll(".modal").forEach((modal) => {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.classList.remove("open");
      if (modal.id === "scan-modal") stopScanner();
    }
  });
});

refreshProducts();
