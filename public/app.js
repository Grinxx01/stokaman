const state = {
  products: [],
  cart: new Map(),
  html5QrCode: null,
  scanning: false,
  stopping: false,
  facingMode: "environment", // Default: kamera belakang handphone
  userExplicitCamera: null,
  scanTarget: "kasir",
  editingId: null,
  availableCameras: []
};

let currentOnDecode = null;

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => "Rp " + Number(n).toLocaleString("id-ID");

function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2800);
}

function playBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch {}
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

/* ==========================================================================
   SCANNER CAMERA (OPTIMIZED FOR SMARTPHONE REAR CAMERA)
   ========================================================================== */

function updateCameraModeLabel() {
  const label = $("#camera-mode-label");
  if (label) {
    label.textContent = state.facingMode === "environment" ? "Kamera Belakang" : "Kamera Depan";
  }
}

function formatCameraErrorMessage(err) {
  const msg = (err?.message || String(err)).toLowerCase();
  if (msg.includes("notallowederror") || msg.includes("permission") || msg.includes("denied")) {
    return "Izin akses kamera ditolak. Silakan izinkan akses kamera di pengaturan browser Anda (klik ikon gembok pada bilah alamat).";
  }
  if (msg.includes("notfounderror") || msg.includes("devicesnotfounderror")) {
    return "Tidak ada perangkat kamera yang terdeteksi di perangkat ini.";
  }
  if (msg.includes("notreadableerror") || msg.includes("trackstarterror")) {
    return "Kamera sedang digunakan oleh aplikasi lain. Tutup aplikasi yang menggunakan kamera dan coba lagi.";
  }
  if (msg.includes("overconstrainederror")) {
    return "Kamera yang diminta tidak tersedia. Sistem akan mencoba kamera alternatif.";
  }
  return err?.message || "Gagal mengaktifkan kamera. Pastikan browser memiliki izin akses video.";
}

function showScannerError(title, detail) {
  const statusEl = $("#scanner-status");
  if (statusEl) statusEl.classList.add("hidden");

  const errorBox = $("#scanner-error");
  if (errorBox) {
    errorBox.style.display = "flex";
    errorBox.innerHTML = `
      <strong>${title}</strong>
      <p>${detail}</p>
      <button type="button" id="scanner-retry-btn" class="mini-btn" style="margin-top:6px;background:#ffffff;color:#000000;font-weight:700;">
        Coba Lagi
      </button>
    `;
    $("#scanner-retry-btn")?.addEventListener("click", () => {
      if (currentOnDecode) startScanner(currentOnDecode);
    });
  } else {
    toast(`${title}: ${detail}`, true);
  }
}

async function updateCameraList() {
  const cameraSelect = $("#camera-select");
  if (!cameraSelect || typeof Html5Qrcode === "undefined") return;

  try {
    const devices = await Html5Qrcode.getCameras();
    if (!devices || devices.length === 0) {
      cameraSelect.style.display = "none";
      return;
    }

    state.availableCameras = devices;
    cameraSelect.innerHTML = devices
      .map((c, idx) => {
        const rawLabel = c.label || `Kamera ${idx + 1}`;
        let cleanLabel = rawLabel;
        if (/back|rear|belakang|environment/i.test(rawLabel)) {
          cleanLabel = `📷 Belakang: ${rawLabel.replace(/facing back/i, "").trim()}`;
        } else if (/front|user|depan|selfie/i.test(rawLabel)) {
          cleanLabel = `🤳 Depan: ${rawLabel.replace(/facing front/i, "").trim()}`;
        }
        return `<option value="${c.id}">${cleanLabel}</option>`;
      })
      .join("");

    if (state.userExplicitCamera) {
      cameraSelect.value = state.userExplicitCamera;
    }
    cameraSelect.style.display = devices.length > 1 ? "block" : "none";
  } catch (err) {
    console.warn("Gagal memperbarui daftar kamera:", err);
  }
}

async function startScanner(onDecode) {
  currentOnDecode = onDecode;

  const statusEl = $("#scanner-status");
  const errorBox = $("#scanner-error");
  updateCameraModeLabel();

  if (errorBox) errorBox.style.display = "none";
  if (statusEl) {
    statusEl.classList.remove("hidden");
    statusEl.innerHTML = `<div class="spinner"></div><span>Mengaktifkan ${state.facingMode === "environment" ? "kamera belakang" : "kamera depan"}...</span>`;
  }

  // 1. Validasi Keamanan Browser (HTTPS / Localhost)
  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    showScannerError(
      "Akses Kamera Diblokir Browser",
      "Kamera handphone membutuhkan koneksi aman (HTTPS atau http://localhost). Jika membuka via IP lokal (misal: http://192.168.x.x), browser Android/iOS memblokir akses kamera demi privasi."
    );
    return;
  }

  // 2. Validasi Ketersediaan Library Html5Qrcode
  if (typeof Html5Qrcode === "undefined") {
    showScannerError(
      "Modul Scanner Belum Siap",
      "Pustaka scanner belum selesai dimuat. Pastikan perangkat Anda terhubung ke internet untuk memuat modul pemindai."
    );
    return;
  }

  // Hentikan scanner aktif sebelumnya
  await stopScanner();

  try {
    // 3. Konfigurasi Format Barcode yang Didukung
    let formatsToSupport = undefined;
    if (window.Html5QrcodeSupportedFormats) {
      formatsToSupport = [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.QR_CODE
      ];
    }

    state.html5QrCode = new Html5Qrcode("reader", {
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true // Menggunakan akselerasi hardware BarcodeDetector di smartphone
      },
      formatsToSupport: formatsToSupport
    });
    state.scanning = true;

    // 4. Tentukan Konfigurasi Kamera (Utamakan Kamera Belakang Handphone)
    let cameraConfig;
    if (state.userExplicitCamera) {
      cameraConfig = state.userExplicitCamera;
    } else if (state.facingMode === "environment") {
      // Direct instruction to mobile browser to pick rear camera
      cameraConfig = { facingMode: "environment" };
    } else {
      cameraConfig = { facingMode: "user" };
    }

    const qrConfig = {
      fps: 20, // Lebih responsif untuk kamera handphone
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        // Area pemindaian horizontal persegi panjang ideal untuk barcode 1D garis
        const width = Math.min(Math.floor(viewfinderWidth * 0.88), 340);
        const height = Math.min(Math.floor(width * 0.52), 180);
        return { width, height };
      },
      aspectRatio: 1.333333
    };

    const handleSuccess = async (decodedText) => {
      playBeep();
      await stopScanner();
      closeModal("scan-modal");
      if (currentOnDecode) {
        currentOnDecode(decodedText);
      }
    };

    // 5. Jalankan Kamera
    try {
      await state.html5QrCode.start(cameraConfig, qrConfig, handleSuccess, () => {});
    } catch (startErr) {
      console.warn("Gagal start dengan kamera pilihan (" + JSON.stringify(cameraConfig) + "):", startErr);

      // Jika kamera belakang gagal (misal di laptop yang hanya punya webcam depan):
      if (state.facingMode === "environment" && !state.userExplicitCamera) {
        console.log("Mencoba fallback otomatis ke kamera depan/webcam...");
        state.facingMode = "user";
        updateCameraModeLabel();
        await state.html5QrCode.start(
          { facingMode: "user" },
          qrConfig,
          handleSuccess,
          () => {}
        );
      } else {
        throw startErr;
      }
    }

    if (statusEl) statusEl.classList.add("hidden");

    // 6. Perbarui daftar kamera setelah stream aktif agar label nama kamera terbaca
    await updateCameraList();
  } catch (err) {
    state.scanning = false;
    showScannerError("Kamera Tidak Dapat Diakses", formatCameraErrorMessage(err));
  }
}

async function stopScanner() {
  if (state.stopping) return;
  state.stopping = true;

  try {
    if (state.html5QrCode) {
      if (state.html5QrCode.isScanning) {
        await state.html5QrCode.stop();
      }
      try {
        state.html5QrCode.clear();
      } catch {}
    }
  } catch (err) {
    console.warn("Stop scanner error:", err);
  } finally {
    state.html5QrCode = null;
    state.scanning = false;
    state.stopping = false;
    const statusEl = $("#scanner-status");
    if (statusEl) statusEl.classList.add("hidden");
  }
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

  const available = filtered.filter((p) => p.stock > 0);
  if (available.length === 0) {
    $("#kasir-products").innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
        <p>Tidak ada produk ditemukan.</p>
      </div>`;
    return;
  }

  $("#kasir-products").innerHTML = available
    .map((p) => `
      <div class="product-tile" data-barcode="${p.barcode}">
        <div class="p-header">
          <span class="p-cat">${esc(p.category || "Umum")}</span>
          <span class="p-stock ${p.stock <= 5 ? "low" : ""}">Stok: ${p.stock}</span>
        </div>
        <div class="p-name">${esc(p.name)}</div>
        <div class="p-footer">
          <span class="p-price">${fmt(p.price)}</span>
          <span class="p-add-hint">+ Tambah</span>
        </div>
      </div>
    `)
    .join("");
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
      if (status.cls === "expired") {
        alerts.push(`
          <div class="alert expired">
            <span class="alert-tag">KADALUARSA</span>
            <span class="alert-msg"><strong>${esc(p.name)}</strong> telah melewati batas (${p.expiry_date})</span>
          </div>
        `);
      } else if (status.cls === "soon") {
        alerts.push(`
          <div class="alert soon">
            <span class="alert-tag">PERINGATAN</span>
            <span class="alert-msg"><strong>${esc(p.name)}</strong> mendekati masa kadaluarsa (${p.expiry_date})</span>
          </div>
        `);
      }
    }
    if (p.stock <= 5) {
      alerts.push(`
        <div class="alert soon">
          <span class="alert-tag">STOK RENDAH</span>
          <span class="alert-msg">Sisa stok <strong>${esc(p.name)}</strong> tersisa ${p.stock} unit</span>
        </div>
      `);
    }
  }
  $("#stok-alerts").innerHTML = alerts.slice(0, 6).join("");

  if (filtered.length === 0) {
    $("#stok-body").innerHTML = `
      <tr>
        <td colspan="7" class="table-empty">
          Belum ada produk. Klik <strong>+ Tambah Barang</strong> untuk mulai mencatat.
        </td>
      </tr>`;
    return;
  }

  $("#stok-body").innerHTML = filtered
    .map((p) => {
      const status = expiryStatus(p.expiry_date);
      return `
      <tr>
        <td><code class="barcode-badge">${p.barcode}</code></td>
        <td>
          <div class="cell-product">
            <span class="cell-name">${esc(p.name)}</span>
            ${p.category ? `<span class="cell-category">${esc(p.category)}</span>` : ""}
          </div>
        </td>
        <td class="cell-mono">${fmt(p.price)}</td>
        <td class="cell-mono">
          <span class="stock-badge ${p.stock <= 5 ? "low" : ""}">${p.stock}</span>
        </td>
        <td class="cell-date">${p.expiry_date ?? "—"}</td>
        <td><span class="badge ${status.cls}">${status.label}</span></td>
        <td>
          <div class="actions">
            <button class="mini-btn" data-restock="${p.id}" data-amount="10" title="Tambah 10 stok">+10 Stok</button>
            <button class="mini-btn danger" data-delete="${p.id}" title="Hapus produk">Hapus</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
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
    toast("Stok tidak mencukupi", true);
    return;
  }
  current.qty += 1;
  state.cart.set(product.id, current);
  renderCart();
}

function renderCart() {
  const items = [...state.cart.values()];
  if (items.length === 0) {
    $("#cart").innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty-icon">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
        </div>
        <p class="empty-title">Keranjang masih kosong</p>
        <p class="empty-desc">Scan barcode atau klik produk dari katalog</p>
      </div>`;
  } else {
    $("#cart").innerHTML = items
      .map(({ product, qty }) => `
        <div class="cart-item">
          <div class="cart-item-info">
            <span class="name">${esc(product.name)}</span>
            <span class="unit-price">${fmt(product.price)} / unit</span>
          </div>
          <div class="cart-stepper">
            <button class="qty-btn" data-cart-minus="${product.id}" aria-label="Kurangi jumlah">−</button>
            <span class="qty-count">${qty}</span>
            <button class="qty-btn" data-cart-plus="${product.id}" aria-label="Tambah jumlah">+</button>
          </div>
          <span class="cart-item-subtotal">${fmt(product.price * qty)}</span>
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
    toast("Transaksi berhasil dicatat");
  } catch (err) {
    toast(err.message, true);
  }
}

async function loadHistory() {
  try {
    const transactions = await api("/api/transactions");
    if (!transactions || transactions.length === 0) {
      $("#riwayat").innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <p>Belum ada riwayat transaksi penjualan.</p>
        </div>`;
      return;
    }

    $("#riwayat").innerHTML = transactions
      .map((t) => {
        const items = t.transaction_items ?? [];
        const dateObj = new Date(t.created_at);
        const dateStr = dateObj.toLocaleDateString("id-ID", {
          day: "numeric",
          month: "short",
          year: "numeric"
        });
        const timeStr = dateObj.toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit"
        });

        return `
        <div class="history-item">
          <div class="h-head">
            <div class="h-meta">
              <span class="h-tag">TRX-${t.id ? String(t.id).padStart(4, "0") : "REC"}</span>
              <span class="h-time">${dateStr} • ${timeStr}</span>
            </div>
            <strong class="h-total">${fmt(t.total)}</strong>
          </div>
          <div class="h-items">
            ${items
              .map((i) => `
                <span class="h-chip">
                  <span class="h-chip-name">${esc(i.products?.name ?? "Produk")}</span>
                  <span class="h-chip-qty">×${i.qty}</span>
                </span>
              `)
              .join("")}
          </div>
        </div>`;
      })
      .join("");
  } catch (err) {
    toast(err.message, true);
  }
}

// Navigation Tabs
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $("#tab-" + tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "riwayat") {
      loadHistory();
    } else if (tab.dataset.tab === "kasir") {
      setTimeout(() => $("#kasir-barcode")?.focus(), 80);
    }
  });
});

// Barcode & Modals
$("#kasir-scan-btn").addEventListener("click", () => {
  state.scanTarget = "kasir";
  state.userExplicitCamera = null;
  state.facingMode = "environment"; // Prioritaskan kamera belakang
  $("#scan-title").textContent = "Scan Barcode Kasir";
  openModal("scan-modal");
  setTimeout(() => {
    startScanner((barcode) => {
      handleBarcode(barcode);
    });
  }, 100);
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
  state.userExplicitCamera = null;
  state.facingMode = "environment"; // Prioritaskan kamera belakang
  $("#scan-title").textContent = "Scan Barcode Produk";
  openModal("scan-modal");
  setTimeout(() => {
    startScanner(async (barcode) => {
      try {
        const product = await api(`/api/products/lookup/${encodeURIComponent(barcode)}`);
        fillForm(product, product.id !== undefined);
        openModal("form-modal");
      } catch (err) {
        toast(err.message, true);
      }
    });
  }, 100);
});

// Toggle / Flip Camera (Kamera Belakang <-> Kamera Depan)
$("#camera-flip-btn")?.addEventListener("click", async () => {
  const select = $("#camera-select");
  if (state.availableCameras.length > 1 && select && select.options.length > 1) {
    const nextIdx = (select.selectedIndex + 1) % select.options.length;
    select.selectedIndex = nextIdx;
    state.userExplicitCamera = select.value;
    const selectedText = select.options[nextIdx].text.toLowerCase();
    state.facingMode = /front|depan|user|selfie/i.test(selectedText) ? "user" : "environment";
  } else {
    state.facingMode = state.facingMode === "environment" ? "user" : "environment";
    state.userExplicitCamera = null;
  }

  updateCameraModeLabel();
  if (state.scanning && currentOnDecode) {
    await startScanner(currentOnDecode);
  }
});

// Camera Selection Dropdown Change
$("#camera-select")?.addEventListener("change", async (e) => {
  state.userExplicitCamera = e.target.value;
  const selectedText = e.target.options[e.target.selectedIndex]?.text?.toLowerCase() || "";
  state.facingMode = /front|depan|user|selfie/i.test(selectedText) ? "user" : "environment";
  updateCameraModeLabel();
  if (state.scanning && currentOnDecode) {
    await startScanner(currentOnDecode);
  }
});

// Scan From Image File Alternative
$("#scan-file-btn")?.addEventListener("click", () => {
  $("#scan-file-input")?.click();
});

$("#scan-file-input")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    let formatsToSupport = undefined;
    if (window.Html5QrcodeSupportedFormats) {
      formatsToSupport = [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.QR_CODE
      ];
    }
    const scanner = state.html5QrCode || new Html5Qrcode("reader", { formatsToSupport });
    toast("Menganalisis gambar...");
    const decodedText = await scanner.scanFile(file, true);
    playBeep();
    await stopScanner();
    closeModal("scan-modal");
    if (currentOnDecode) currentOnDecode(decodedText);
  } catch (err) {
    toast("Gagal membaca barcode dari gambar: " + (err?.message || err), true);
  } finally {
    e.target.value = "";
  }
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
    toast("Produk berhasil disimpan");
  } catch (err) {
    toast(err.message, true);
  }
});

// Event Delegation for Dynamic Elements
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
        toast("Stok tidak mencukupi", true);
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
      toast("Stok berhasil ditambahkan +10");
    } catch (err) {
      toast(err.message, true);
    }
  }

  const del = e.target.closest("[data-delete]");
  if (del && confirm("Hapus produk ini dari daftar stok?")) {
    try {
      await api(`/api/products/${del.dataset.delete}`, { method: "DELETE" });
      await refreshProducts();
      toast("Produk berhasil dihapus");
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

// Modal Overlay Close & Esc Key
document.querySelectorAll(".modal").forEach((modal) => {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.classList.remove("open");
      if (modal.id === "scan-modal") stopScanner();
    }
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal.open").forEach((modal) => {
      modal.classList.remove("open");
      if (modal.id === "scan-modal") stopScanner();
    });
  }
});

// Initial boot
refreshProducts();
