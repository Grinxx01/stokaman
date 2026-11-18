create extension if not exists "pgcrypto";

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  barcode text not null unique,
  name text not null,
  category text,
  price numeric(12, 2) not null default 0 check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  expiry_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  total numeric(12, 2) not null default 0 check (total >= 0),
  created_at timestamptz not null default now()
);

create table if not exists transaction_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions (id) on delete cascade,
  product_id uuid not null references products (id),
  qty integer not null check (qty > 0),
  price numeric(12, 2) not null check (price >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_products_barcode on products (barcode);
create index if not exists idx_products_expiry_date on products (expiry_date);
create index if not exists idx_transaction_items_transaction_id on transaction_items (transaction_id);
create index if not exists idx_transaction_items_product_id on transaction_items (product_id);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at
  before update on products
  for each row
  execute function set_updated_at();

create or replace function checkout(p_items jsonb)
returns uuid
language plpgsql
as $$
declare
  v_transaction_id uuid;
  v_items jsonb := p_items;
  v_item jsonb;
  v_product record;
  v_total numeric(12, 2) := 0;
begin
  -- Jika p_items ter-serialisasi sebagai string ganda
  if jsonb_typeof(v_items) = 'string' then
    v_items := (v_items #>> '{}')::jsonb;
  end if;

  if v_items is null or jsonb_typeof(v_items) != 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'Keranjang tidak boleh kosong';
  end if;

  insert into transactions (total) values (0) returning id into v_transaction_id;

  for v_item in select * from jsonb_array_elements(v_items) loop
    select id, name, price, stock
      into v_product
      from products
      where id = (v_item ->> 'product_id')::uuid
      for update;

    if v_product.id is null then
      raise exception 'Produk dengan id % tidak ditemukan', v_item ->> 'product_id';
    end if;

    if v_product.stock < (v_item ->> 'qty')::integer then
      raise exception 'Stok % tidak mencukupi (sisa %)', v_product.name, v_product.stock;
    end if;

    update products
      set stock = stock - (v_item ->> 'qty')::integer
      where id = v_product.id;

    insert into transaction_items (transaction_id, product_id, qty, price)
      values (v_transaction_id, v_product.id, (v_item ->> 'qty')::integer, v_product.price);

    v_total := v_total + v_product.price * (v_item ->> 'qty')::integer;
  end loop;

  update transactions set total = v_total where id = v_transaction_id;
  return v_transaction_id;
end;
$$;
