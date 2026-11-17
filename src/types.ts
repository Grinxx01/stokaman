export interface Product {
  id: string;
  barcode: string;
  name: string;
  category: string | null;
  price: number;
  stock: number;
  expiry_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductInsert {
  barcode: string;
  name: string;
  category?: string | null;
  price: number;
  stock: number;
  expiry_date?: string | null;
}

export interface LookupResult {
  barcode: string;
  name: string;
  category: string | null;
  suggested_expiry_date: string | null;
  found_in_database: boolean;
}

export interface TransactionItem {
  product_id: string;
  name: string;
  qty: number;
  price: number;
}

export interface Transaction {
  id: string;
  total: number;
  created_at: string;
  items: TransactionItem[];
}
