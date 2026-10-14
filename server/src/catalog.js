const productColumns = `
  p.id, p.name, f.name AS farmName, p.category, p.unit,
  p.price_paise AS pricePaise, p.bulk_price_paise AS bulkPricePaise,
  CASE WHEN p.sale_mode='weight' THEN p.bulk_min_grams ELSE p.bulk_min END AS bulkMin, CASE WHEN p.sale_mode='weight' THEN p.stock_grams ELSE p.stock END AS stock,p.sale_mode AS saleMode,p.preset_id AS presetId, p.image, p.photo_credit AS photoCredit, p.variety, p.quality_notes AS qualityNotes, p.harvest_date AS harvestDate,
  (SELECT count(*) FROM product_reviews r WHERE r.product_id=p.id AND r.hidden=0 AND r.is_demo=0) AS reviewCount,
  (SELECT ROUND(AVG(r.rating),1) FROM product_reviews r WHERE r.product_id=p.id AND r.hidden=0 AND r.is_demo=0) AS rating,
  COALESCE((SELECT city FROM farm_details WHERE farm_id=p.farm_id),'') AS farmCity
`;

export function listProducts(db) {
  return db.prepare(`
    SELECT ${productColumns} FROM products p
    JOIN farms f ON f.id = p.farm_id
    WHERE p.active = 1 AND p.archived=0 AND NOT EXISTS (SELECT 1 FROM listing_moderation m WHERE m.product_id=p.id AND m.blocked=1) AND NOT EXISTS (SELECT 1 FROM account_profiles ap WHERE ap.farm_id=p.farm_id AND ap.access_status!='approved') ORDER BY p.display_order, p.id
  `).all();
}

export function findProduct(db, id) {
  return db.prepare(`
    SELECT ${productColumns} FROM products p
    JOIN farms f ON f.id = p.farm_id
    WHERE p.id = ? AND p.active = 1 AND p.archived=0 AND NOT EXISTS (SELECT 1 FROM listing_moderation m WHERE m.product_id=p.id AND m.blocked=1) AND NOT EXISTS (SELECT 1 FROM account_profiles ap WHERE ap.farm_id=p.farm_id AND ap.access_status!='approved')
  `).get(id);
}

export function getCatalog(db) {
  const products = listProducts(db);
  return {
    products,
    categories: ["All produce", "Vegetables", "Fruits", "Leafy greens"],
    deliveryPincodes: db.prepare("SELECT pincode FROM delivery_areas WHERE active = 1 ORDER BY pincode")
      .all().map((row) => row.pincode),
  };
}

