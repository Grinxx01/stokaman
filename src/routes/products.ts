import { NextFunction, Request, Response, Router } from "express";
import { supabase } from "../lib/supabase";
import { lookupBarcode } from "../lib/openfoodfacts";
import { expiryDateFromToday } from "../lib/shelflife";
import { Product, ProductInsert } from "../types";

const router = Router();

router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ data: data as Product[] });
  } catch (err) {
    next(err);
  }
});

router.get("/lookup/:barcode", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const barcode = String(req.params.barcode).trim();
    const { data: existing } = await supabase
      .from("products")
      .select("*")
      .eq("barcode", barcode)
      .maybeSingle();

    if (existing) {
      res.json({ data: existing as Product });
      return;
    }

    const scanned = await lookupBarcode(barcode);
    res.json({
      data: {
        barcode,
        name: scanned?.name ?? `Produk ${barcode}`,
        category: scanned?.category ?? null,
        suggested_expiry_date: scanned?.suggestedExpiryDate ?? expiryDateFromToday(180),
        found_in_database: false
      }
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as Partial<ProductInsert>;
    if (!body.barcode || !body.name) {
      res.status(400).json({ error: "barcode dan name wajib diisi" });
      return;
    }
    const payload: ProductInsert = {
      barcode: String(body.barcode).trim(),
      name: String(body.name).trim(),
      category: body.category ?? null,
      price: Number(body.price) || 0,
      stock: Number(body.stock) || 0,
      expiry_date: body.expiry_date || null
    };
    const { data, error } = await supabase
      .from("products")
      .upsert(payload, { onConflict: "barcode" })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ data: data as Product });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (req.body.name !== undefined) updates.name = String(req.body.name).trim();
    if (req.body.category !== undefined) updates.category = req.body.category;
    if (req.body.price !== undefined) updates.price = Number(req.body.price) || 0;
    if (req.body.stock !== undefined) updates.stock = Number(req.body.stock) || 0;
    if (req.body.expiry_date !== undefined) updates.expiry_date = req.body.expiry_date || null;

    const { data, error } = await supabase
      .from("products")
      .update(updates)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: "Produk tidak ditemukan" });
      return;
    }
    res.json({ data: data as Product });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/restock", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const amount = Number(req.body.amount) || 0;
    if (amount === 0) {
      res.status(400).json({ error: "amount tidak boleh 0" });
      return;
    }
    const { data: product } = await supabase
      .from("products")
      .select("stock")
      .eq("id", req.params.id)
      .single();
    if (!product) {
      res.status(404).json({ error: "Produk tidak ditemukan" });
      return;
    }
    const newStock = Math.max(0, product.stock + amount);
    const { data, error } = await supabase
      .from("products")
      .update({ stock: newStock, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ data: data as Product });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { error } = await supabase.from("products").delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
