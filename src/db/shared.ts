// Shared authorization and read fragments used by the domain queries.
export const profilePhotoAccess = `u.id=? OR EXISTS(SELECT 1 FROM memberships owner
  JOIN memberships caller ON caller.cache_id=owner.cache_id AND caller.user_id=? AND caller.status='active'
  JOIN caches c ON c.id=owner.cache_id AND c.join_secret IS NOT NULL
  WHERE owner.user_id=u.id AND owner.status='active')`

export const cacheRead = `SELECT c.id,c.name,c.join_secret,c.requires_approval,owner.user_id AS owner_id
  FROM caches c JOIN memberships owner ON owner.cache_id=c.id AND owner.role='owner' AND owner.status='active'
  JOIN memberships caller ON caller.cache_id=c.id AND caller.user_id=? AND caller.status='active'
  WHERE c.id=? AND c.join_secret IS NOT NULL`

export const itemRead = `SELECT i.id,i.owner_id,i.title,i.description,i.photo_path,i.is_consumable,i.quantity,
  i.available,i.unavailable_note,i.created_at,u.display_name AS owner_name,u.cat_coat AS owner_cat_coat,
  CASE WHEN i.is_consumable=1 THEN i.quantity-(SELECT COALESCE(SUM(quantity),0) FROM requests WHERE item_id=i.id AND status='pending') ELSE NULL END AS available_quantity
  FROM items i JOIN user u ON u.id=i.owner_id`
export const itemAccess = `(? IS NULL AND i.owner_id=?) OR EXISTS(
  SELECT 1 FROM item_caches a JOIN caches c ON c.id=a.cache_id AND c.join_secret IS NOT NULL
  JOIN memberships caller ON caller.cache_id=c.id AND caller.user_id=? AND caller.status='active'
  JOIN memberships owner ON owner.cache_id=c.id AND owner.user_id=i.owner_id AND owner.status='active'
  WHERE a.item_id=i.id AND a.cache_id=?)`

export const requestContext = `EXISTS(SELECT 1 FROM item_caches a JOIN caches config ON config.id=a.cache_id AND config.join_secret IS NOT NULL
  JOIN memberships requester ON requester.cache_id=a.cache_id AND requester.user_id=r.requester_id AND requester.status='active'
  JOIN memberships owner ON owner.cache_id=a.cache_id AND owner.user_id=i.owner_id AND owner.status='active'
  WHERE a.item_id=r.item_id AND a.cache_id=r.cache_id)`
