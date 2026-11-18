import { NextFunction, Request, Response, Router } from "express";
import { supabase } from "../lib/supabase";
import { Transaction } from "../types";

const router = Router();

interface CheckoutItem {
  product_id?: string;
  qty?: number;
}

interface CheckoutBody {
  items?: CheckoutItem[];
  payment_method?: string;
  amount_paid?: number;
}

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as CheckoutBody;
    const rawItems = body.items ?? [];
    const items = rawItems
      .filter((item) => item.product_id && (item.qty ?? 0) > 0)
      .map((item) => ({
        product_id: String(item.product_id).trim(),
        qty: Math.floor(Number(item.qty))
      }));

    if (items.length === 0) {
      res.status(400).json({ error: "Keranjang masih kosong" });
      return;
    }

    let transactionId: string | null = null;

    // 1. Coba panggil RPC 'checkout' jika tersedia di database Supabase
    try {
      const { data, error } = await supabase.rpc("checkout", { p_items: items });
      if (!error && data) {
        transactionId = String(data);
      } else if (error) {
        console.warn("RPC checkout tidak tersedia atau gagal, menggunakan fallback database:", error.message);
      }
    } catch (rpcErr) {
      console.warn("RPC checkout exception, menggunakan fallback database:", rpcErr);
    }

    // 2. Fallback: Eksekusi transaksi langsung melalui tabel Supabase jika RPC tidak ada/gagal
    if (!transactionId) {
      const productIds = items.map((i) => i.product_id);
      const { data: dbProducts, error: pError } = await supabase
        .from("products")
        .select("id, name, price, stock")
        .in("id", productIds);

      if (pError || !dbProducts) {
        throw new Error(pError?.message || "Gagal mengambil data produk dari database");
      }

      const productMap = new Map(dbProducts.map((p) => [p.id, p]));

      // Validasi keberadaan produk dan kecukupan stok
      let calculatedTotal = 0;
      for (const item of items) {
        const prod = productMap.get(item.product_id);
        if (!prod) {
          res.status(400).json({ error: `Produk dengan ID ${item.product_id} tidak ditemukan` });
          return;
        }
        if (prod.stock < item.qty) {
          res.status(400).json({
            error: `Stok ${prod.name} tidak mencukupi (tersedia: ${prod.stock}, diminta: ${item.qty})`
          });
          return;
        }
        calculatedTotal += Number(prod.price) * item.qty;
      }

      // Buat data transaksi baru
      const { data: tx, error: txError } = await supabase
        .from("transactions")
        .insert({ total: calculatedTotal })
        .select("id")
        .single();

      if (txError || !tx) {
        throw new Error(txError?.message || "Gagal membuat transaksi baru di database");
      }

      transactionId = tx.id;

      // Masukkan item-item transaksi
      const txItems = items.map((item) => {
        const prod = productMap.get(item.product_id)!;
        return {
          transaction_id: transactionId,
          product_id: item.product_id,
          qty: item.qty,
          price: prod.price
        };
      });

      const { error: itemsError } = await supabase.from("transaction_items").insert(txItems);
      if (itemsError) {
        throw new Error(itemsError.message || "Gagal menyimpan rincian item transaksi");
      }

      // Kurangi stok masing-masing produk
      for (const item of items) {
        const prod = productMap.get(item.product_id)!;
        const newStock = Math.max(0, prod.stock - item.qty);
        await supabase
          .from("products")
          .update({ stock: newStock, updated_at: new Date().toISOString() })
          .eq("id", item.product_id);
      }
    }

    // 3. Ambil data transaksi lengkap beserta relasi produk
    const { data: transaction, error: fetchError } = await supabase
      .from("transactions")
      .select("*, transaction_items(*, products(name))")
      .eq("id", transactionId)
      .single();

    if (fetchError || !transaction) {
      res.status(201).json({
        data: {
          id: transactionId,
          created_at: new Date().toISOString(),
          transaction_items: items
        }
      });
      return;
    }

    res.status(201).json({ data: transaction });
  } catch (err) {
    next(err);
  }
});

router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabase
      .from("transactions")
      .select("*, transaction_items(*, products(name))")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ data: data as unknown as Transaction[] });
  } catch (err) {
    next(err);
  }
});

router.get("/items/:productId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabase
      .from("transaction_items")
      .select("qty, price, created_at")
      .eq("product_id", req.params.productId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    const totalQty = (data ?? []).reduce((sum, item) => sum + item.qty, 0);
    res.json({ data: { history: data, total_sold: totalQty } });
  } catch (err) {
    next(err);
  }
});

export default router;
