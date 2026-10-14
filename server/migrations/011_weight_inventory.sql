ALTER TABLE products ADD COLUMN sale_mode TEXT NOT NULL DEFAULT 'pack' CHECK(sale_mode IN ('pack','weight'));
ALTER TABLE products ADD COLUMN stock_grams INTEGER CHECK(stock_grams BETWEEN 0 AND 1000000000);
ALTER TABLE products ADD COLUMN bulk_min_grams INTEGER CHECK(bulk_min_grams BETWEEN 50 AND 100000000);
ALTER TABLE products ADD COLUMN preset_id TEXT NOT NULL DEFAULT '';
ALTER TABLE order_items ADD COLUMN sale_mode TEXT NOT NULL DEFAULT 'pack';
ALTER TABLE order_items ADD COLUMN line_total_paise INTEGER;
UPDATE order_items SET line_total_paise=quantity*unit_price_paise;
