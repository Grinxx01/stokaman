import { NextFunction, Request, Response, Router } from "express";
import { supabase } from "../lib/supabase";
import { Transaction } from "../types";

const router = Router();

interface CheckoutBody {
  items?: Array<{ product_id?: string; qty?: number }>;
}

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as CheckoutBody;
    const items = (body.items ?? [])
      .filter((item) => item.product_id && (item.qty ?? 0) > 0)
      .map((item) => ({ product_id: String(item.product_id), qty: Math.floor(Number(item.qty)) }));
    if (items.length === 0) {
      res.status(400).json({ error: "Keranjang masih kosong" });
      return;
    }
    const { data, error } = await supabase.rpc("checkout", { p_items: JSON.stringify(items) });
    if (error) throw error;
    const transactionId = data as string;
    const { data: transaction } = await supabase
      .from("transactions")
      .select("*, transaction_items(*, products(name))")
      .eq("id", transactionId)
      .single();
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
