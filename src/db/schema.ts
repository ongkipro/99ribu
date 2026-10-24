import { sql } from "drizzle-orm";
import { type AnyPgColumn, bigint, boolean, check, date, foreignKey, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const appSchema = pgSchema("app");

// Matches the installed Better Auth 1.7.10 core schema. Migrations remain Drizzle-owned.
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
export const user = appSchema.table("auth_user", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false), image: text("image"),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  createdAt: instant("created_at").notNull().defaultNow(), updatedAt: instant("updated_at").notNull().defaultNow(),
});
export const session = appSchema.table("auth_session", {
  id: text("id").primaryKey(), expiresAt: instant("expires_at").notNull(), token: text("token").notNull().unique(),
  createdAt: instant("created_at").notNull().defaultNow(), updatedAt: instant("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"), userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (table) => [index("auth_session_user_idx").on(table.userId), index("auth_session_expires_idx").on(table.expiresAt)]);
export const account = appSchema.table("auth_account", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"), refreshToken: text("refresh_token"), idToken: text("id_token"),
  accessTokenExpiresAt: instant("access_token_expires_at"), refreshTokenExpiresAt: instant("refresh_token_expires_at"),
  scope: text("scope"), password: text("password"),
  createdAt: instant("created_at").notNull().defaultNow(), updatedAt: instant("updated_at").notNull().defaultNow(),
}, (table) => [index("auth_account_user_idx").on(table.userId), uniqueIndex("auth_account_provider_identity_idx").on(table.providerId, table.accountId)]);
export const verification = appSchema.table("auth_verification", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(),
  expiresAt: instant("expires_at").notNull(), createdAt: instant("created_at").notNull().defaultNow(), updatedAt: instant("updated_at").notNull().defaultNow(),
}, (table) => [index("auth_verification_identifier_idx").on(table.identifier), index("auth_verification_expires_idx").on(table.expiresAt)]);
export const rateLimit = appSchema.table("auth_rate_limit", {
  id: text("id").primaryKey(), key: text("key").notNull().unique(), count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const twoFactor = appSchema.table("auth_two_factor", {
  id: text("id").primaryKey(), secret: text("secret").notNull(), backupCodes: text("backup_codes").notNull(),
  userId: text("user_id").notNull().unique().references(() => user.id, { onDelete: "cascade" }),
  verified: boolean("verified").notNull().default(false), failedVerificationCount: integer("failed_verification_count").notNull().default(0),
  lockedUntil: instant("locked_until"),
});
export const mfaSession = appSchema.table("mfa_session", {
  sessionId: text("session_id").primaryKey().references(() => session.id, { onDelete: "cascade" }),
  verifiedAt: instant("verified_at").notNull().defaultNow(),
});
export const roleGrant = appSchema.table("role_grant", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().unique().references(() => user.id, { onDelete: "cascade" }),
  roles: text("roles").array().notNull().default(sql`ARRAY['buyer']::text[]`),
  permissions: text("permissions").array().notNull().default(sql`ARRAY[]::text[]`),
  revision: integer("revision").notNull().default(1),
}, (table) => [
  check("role_grant_roles_check", sql`${table.roles} <@ ARRAY['owner','ecommerce_admin','warehouse','customer_service','finance','buyer','affiliate']::text[] AND array_position(${table.roles}, NULL) IS NULL`),
  check("role_grant_revision_check", sql`${table.revision} > 0`),
  check("role_grant_finance_check", sql`NOT (${table.permissions} && ARRAY['finance.summary.read','finance.costs.read','finance.costs.write','finance.reconciliation.read','finance.reconciliation.write','finance.refunds.read','finance.refunds.write']::text[]) OR ${table.roles} && ARRAY['owner','finance']::text[]`),
]);
// DEC-006: shipping origin is kecamatan-level (province/city/district), no street address.
// origin_key is a one-way hash of the supplier warehouse id (catalog dataset key), never the raw id.
export const warehouse = appSchema.table("warehouse", {
  id: uuid("id").primaryKey().defaultRandom(), name: text("name").notNull(), city: text("city").notNull(),
  timezone: text("timezone").notNull().default("Asia/Jakarta"), active: boolean("active").notNull().default(true),
  province: text("province"), district: text("district"), originKey: text("origin_key").unique("warehouse_origin_key_unique"),
}, (table) => [
  check("warehouse_location_check", sql`(${table.province} IS NULL OR char_length(${table.province}) BETWEEN 1 AND 100) AND (${table.district} IS NULL OR char_length(${table.district}) BETWEEN 1 AND 100)`),
  check("warehouse_origin_key_check", sql`${table.originKey} IS NULL OR (${table.originKey} ~ '^[0-9a-f]{32}$' AND ${table.province} IS NOT NULL AND ${table.district} IS NOT NULL)`),
]);
export const warehouseMembership = appSchema.table("warehouse_membership", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouse.id, { onDelete: "restrict" }),
}, (table) => [primaryKey({ columns: [table.userId, table.warehouseId] })]);

export const policyHead = appSchema.table("policy_head", {
  id: uuid("id").primaryKey().defaultRandom(), kind: text("kind").notNull(),
  warehouseId: uuid("warehouse_id").references(() => warehouse.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull().default(0),
}, (table) => [
  uniqueIndex("policy_company_unique").on(table.kind).where(sql`${table.warehouseId} IS NULL`),
  uniqueIndex("policy_warehouse_unique").on(table.kind, table.warehouseId).where(sql`${table.warehouseId} IS NOT NULL`),
  check("policy_scope_check", sql`(${table.kind} IN ('commercial','payment') AND ${table.warehouseId} IS NULL) OR (${table.kind} = 'warehouse_calendar' AND ${table.warehouseId} IS NOT NULL)`),
  check("policy_revision_check", sql`${table.revision} >= 0`),
]);
export const policyVersion = appSchema.table("policy_version", {
  id: uuid("id").primaryKey().defaultRandom(),
  headId: uuid("head_id").notNull().references(() => policyHead.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(), effectiveAt: instant("effective_at").notNull(),
  values: jsonb("values").notNull(), actorId: text("actor_id").notNull(), reason: text("reason").notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("policy_version_unique").on(table.headId, table.revision),
  index("policy_effective_idx").on(table.headId, table.effectiveAt, table.revision),
  check("policy_version_revision_check", sql`${table.revision} > 0`),
  check("policy_version_values_check", sql`jsonb_typeof(${table.values}) = 'object'`),
  check("policy_version_reason_check", sql`char_length(${table.reason}) between 1 and 500`),
]);

// Local harness ownership only; these namespaces do not grant application authority.
export const fixtureNamespace = appSchema.table("local_fixture_namespace", {
  name: text("name").primaryKey(), clock: instant("clock").notNull(),
  revision: integer("revision").notNull().default(1),
}, (table) => [
  check("local_fixture_namespace_name_check", sql`${table.name} ~ '^[a-z][a-z0-9-]{0,23}$'`),
  check("local_fixture_namespace_revision_check", sql`${table.revision} > 0`),
]);
export const fixturePrincipal = appSchema.table("local_fixture_principal", {
  namespace: text("namespace").notNull().references(() => fixtureNamespace.name, { onDelete: "restrict" }),
  fixtureId: text("fixture_id").notNull(),
  userId: text("user_id").notNull().unique().references(() => user.id, { onDelete: "restrict" }),
}, (table) => [primaryKey({ columns: [table.namespace, table.fixtureId] })]);
export const fixtureWarehouse = appSchema.table("local_fixture_warehouse", {
  namespace: text("namespace").notNull().references(() => fixtureNamespace.name, { onDelete: "restrict" }),
  fixtureId: text("fixture_id").notNull(),
  warehouseId: uuid("warehouse_id").notNull().unique().references(() => warehouse.id, { onDelete: "restrict" }),
}, (table) => [primaryKey({ columns: [table.namespace, table.fixtureId] })]);
export const accessProof = appSchema.table("access_proof", {
  digest: text("digest").primaryKey(), sessionId: text("session_id").notNull().references(() => session.id, { onDelete: "cascade" }),
  action: text("action").notNull(), subjectId: text("subject_id").notNull(),
  expiresAt: instant("expires_at").notNull(), consumedAt: instant("consumed_at"),
});
export const accessOperation = appSchema.table("access_operation", {
  id: uuid("id").primaryKey().defaultRandom(), actorId: text("actor_id").notNull(), action: text("action").notNull(),
  key: text("key").notNull(), requestHash: text("request_hash").notNull(), response: jsonb("response").notNull(),
  // S105: retention age. Rows that predate 0037 carry the migration time (a stable default, no table rewrite).
  createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [uniqueIndex("access_operation_identity_idx").on(table.actorId, table.action, table.key), index("access_operation_created_idx").on(table.createdAt)]);
export const auditEvent = appSchema.table("audit_event", {
  id: uuid("id").primaryKey().defaultRandom(), actorId: text("actor_id"), action: text("action").notNull(),
  subjectId: text("subject_id"), outcome: text("outcome").notNull(), reason: text("reason").notNull(),
  details: jsonb("details").notNull().default({}), createdAt: instant("created_at").notNull().defaultNow(),
}, (table) => [index("audit_subject_idx").on(table.subjectId, table.createdAt), check("audit_outcome_check", sql`${table.outcome} IN ('allowed','denied')`)]);
export const localDelivery = appSchema.table("local_delivery", {
  id: uuid("id").primaryKey().defaultRandom(), recipient: text("recipient").notNull(),
  kind: text("kind", { enum: ["verification", "password_reset", "existing_account"] }).notNull(),
  url: text("url").notNull(), createdAt: instant("created_at").notNull().defaultNow(), expiresAt: instant("expires_at").notNull(),
  deliveredAt: instant("delivered_at"),
}, (table) => [index("local_delivery_recipient_idx").on(table.recipient, table.createdAt)]);

export const outboxJob = appSchema.table("outbox_job", {
  id: uuid("id").primaryKey().defaultRandom(), kind: text("kind").notNull(), dedupKey: text("dedup_key").notNull().unique(),
  payload: jsonb("payload").notNull(), status: text("status").notNull().default("pending"),
  runAt: instant("run_at").notNull().defaultNow(), attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"), createdAt: instant("created_at").notNull().defaultNow(), completedAt: instant("completed_at"),
  leaseToken: uuid("lease_token"), leaseUntil: instant("lease_until"), dispatchedAt: instant("dispatched_at"),
  maxAttempts: integer("max_attempts").notNull().default(5), result: jsonb("result"),
}, (table) => [
  index("outbox_due_idx").on(table.runAt, table.createdAt, table.id).where(sql`${table.status} = 'pending'`),
  // S104: claimJob filters one kind and pending|unknown in due order; expireLeases scans processing leases.
  index("outbox_kind_due_idx").on(table.kind, table.runAt, table.createdAt, table.id).where(sql`${table.status} IN ('pending','unknown')`),
  index("outbox_lease_idx").on(table.leaseUntil).where(sql`${table.status} = 'processing'`),
  // S105: completed-job retention scans the oldest completions first.
  index("outbox_completed_idx").on(table.completedAt).where(sql`${table.status} = 'completed'`),
  check("outbox_status_check", sql`${table.status} in ('pending', 'processing', 'unknown', 'completed', 'failed')`),
  check("outbox_attempts_check", sql`${table.attempts} >= 0`),
  check("outbox_max_attempts_check", sql`${table.maxAttempts} between 1 and 10`),
  check("outbox_lease_check", sql`(${table.status} = 'processing' AND ${table.leaseToken} IS NOT NULL AND ${table.leaseUntil} IS NOT NULL) OR (${table.status} <> 'processing' AND ${table.leaseToken} IS NULL AND ${table.leaseUntil} IS NULL)`),
  check("outbox_unknown_check", sql`${table.status} <> 'unknown' OR ${table.dispatchedAt} IS NOT NULL`),
]);

export const category = appSchema.table("category", {
  id: uuid("id").primaryKey().defaultRandom(), name: text("name").notNull(), slug: text("slug").notNull().unique(),
  parentId: uuid("parent_id"), depth: integer("depth").notNull(),
  attributeDefinitions: jsonb("attribute_definitions").notNull().default([]),
}, (t) => [
  foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: "category_parent_fk" }).onDelete("restrict"),
  check("category_depth_check", sql`${t.depth} between 1 and 3 AND ((${t.depth}=1) = (${t.parentId} IS NULL))`),
  check("category_slug_check", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(${t.slug}) <= 100`),
  check("category_definitions_check", sql`jsonb_typeof(${t.attributeDefinitions}) = 'array'`),
]);
export const stockItem = appSchema.table("stock_item", {
  id: uuid("id").primaryKey().defaultRandom(), sku: text("sku").notNull().unique(), name: text("name").notNull(),
}, (t) => [check("stock_item_sku_check", sql`${t.sku} ~ '^[A-Z0-9_-]{1,100}$'`)]);
export const product = appSchema.table("product", {
  id: uuid("id").primaryKey().defaultRandom(), catalogId: text("catalog_id").notNull().unique(),
  slug: text("slug").notNull().unique(), revision: integer("revision").notNull().default(0),
}, (t) => [
  check("product_catalog_id_check", sql`${t.catalogId} ~ '^p_[0-9a-f-]{36}$'`),
  check("product_revision_check", sql`${t.revision} >= 0`),
]);
export const productRevision = appSchema.table("product_revision", {
  productId: uuid("product_id").notNull().references(() => product.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(), name: text("name").notNull(), description: text("description").notNull(),
  categoryId: uuid("category_id").notNull().references(() => category.id, { onDelete: "restrict" }),
  images: jsonb("images").notNull(), facts: jsonb("facts").notNull(),
  actorId: text("actor_id").notNull(), reason: text("reason").notNull(), createdAt: instant("created_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.productId, t.revision] }),
  check("product_revision_number_check", sql`${t.revision} > 0`),
  check("product_revision_arrays_check", sql`jsonb_typeof(${t.images})='array' AND jsonb_typeof(${t.facts})='array'`),
]);
export const offer = appSchema.table("offer", {
  id: uuid("id").primaryKey().defaultRandom(), productId: uuid("product_id").notNull().references(() => product.id, { onDelete: "restrict" }),
  catalogId: text("catalog_id").notNull().unique(), sku: text("sku").notNull().unique(),
}, (t) => [
  uniqueIndex("offer_product_identity_unique").on(t.productId, t.id),
  check("offer_catalog_id_check", sql`${t.catalogId} ~ '^v_[0-9a-f-]{36}$'`),
  check("offer_sku_check", sql`${t.sku} ~ '^[A-Z0-9_-]{1,100}$'`),
]);
export const offerRevision = appSchema.table("offer_revision", {
  productId: uuid("product_id").notNull(), revision: integer("revision").notNull(), offerId: uuid("offer_id").notNull(),
  label: text("label").notNull(), attributes: jsonb("attributes").notNull(), image: jsonb("image"),
  kind: text("kind").notNull(), retired: boolean("retired").notNull().default(false),
  price: integer("price").notNull().default(99000), currency: text("currency").notNull().default("IDR"),
  weightGrams: integer("weight_grams").notNull(), lengthMm: integer("length_mm").notNull(),
  widthMm: integer("width_mm").notNull(), heightMm: integer("height_mm").notNull(),
  defaultWarehouseId: uuid("default_warehouse_id").notNull().references(() => warehouse.id, { onDelete: "restrict" }),
}, (t) => [
  primaryKey({ columns: [t.productId, t.revision, t.offerId] }),
  foreignKey({ columns: [t.productId, t.revision], foreignColumns: [productRevision.productId, productRevision.revision], name: "offer_revision_product_fk" }).onDelete("restrict"),
  foreignKey({ columns: [t.productId, t.offerId], foreignColumns: [offer.productId, offer.id], name: "offer_revision_identity_fk" }).onDelete("restrict"),
  check("offer_fixed_price_check", sql`${t.price}=99000 AND ${t.currency}='IDR'`),
  check("offer_kind_check", sql`${t.kind} IN ('unit','multipack','bundle')`),
  check("offer_physical_check", sql`${t.weightGrams}>0 AND ${t.lengthMm}>0 AND ${t.widthMm}>0 AND ${t.heightMm}>0`),
  check("offer_attributes_check", sql`jsonb_typeof(${t.attributes})='array'`),
]);
export const offerComponent = appSchema.table("offer_component", {
  productId: uuid("product_id").notNull(), revision: integer("revision").notNull(), offerId: uuid("offer_id").notNull(),
  stockItemId: uuid("stock_item_id").notNull().references(() => stockItem.id, { onDelete: "restrict" }),
  name: text("name").notNull(), quantity: integer("quantity").notNull(),
}, (t) => [
  primaryKey({ columns: [t.productId, t.revision, t.offerId, t.stockItemId] }),
  foreignKey({ columns: [t.productId, t.revision, t.offerId], foreignColumns: [offerRevision.productId, offerRevision.revision, offerRevision.offerId], name: "offer_component_revision_fk" }).onDelete("restrict"),
  check("offer_component_quantity_check", sql`${t.quantity} > 0`),
]);

export const inventoryLot = appSchema.table("inventory_lot", {
  id: uuid("id").primaryKey().defaultRandom(), stockItemId: uuid("stock_item_id").notNull().references(() => stockItem.id, { onDelete: "restrict" }),
  code: text("code").notNull(), expiresOn: date("expires_on", { mode: "string" }),
  originWarehouseId: uuid("origin_warehouse_id").notNull().references(() => warehouse.id, { onDelete: "restrict" }),
}, (t) => [
  unique("inventory_lot_code_unique").on(t.stockItemId, t.code),
  unique("inventory_lot_stock_identity_unique").on(t.stockItemId, t.id),
  check("inventory_lot_code_check", sql`char_length(${t.code}) between 1 and 100`),
]);
export const inventoryBalance = appSchema.table("inventory_balance", {
  id: uuid("id").primaryKey().defaultRandom(), warehouseId: uuid("warehouse_id").notNull().references(() => warehouse.id, { onDelete: "restrict" }),
  stockItemId: uuid("stock_item_id").notNull().references(() => stockItem.id, { onDelete: "restrict" }), lotId: uuid("lot_id"),
  onHand: integer("on_hand").notNull().default(0), reserved: integer("reserved").notNull().default(0),
  quarantined: integer("quarantined").notNull().default(0), revision: integer("revision").notNull().default(0),
}, (t) => [
  unique("inventory_balance_scope_unique").on(t.warehouseId, t.stockItemId, t.lotId).nullsNotDistinct(),
  foreignKey({ columns: [t.stockItemId, t.lotId], foreignColumns: [inventoryLot.stockItemId, inventoryLot.id], name: "inventory_balance_lot_fk" }).onDelete("restrict"),
  check("inventory_balance_quantities_check", sql`${t.onHand}>=0 AND ${t.reserved}>=0 AND ${t.quarantined}>=0 AND ${t.reserved}::bigint+${t.quarantined}::bigint<=${t.onHand}::bigint`),
  check("inventory_balance_revision_check", sql`${t.revision}>=0`),
  // S104: storefront/cart availability filters by stock item; the scope unique leads with warehouse.
  index("inventory_balance_stock_item_idx").on(t.stockItemId, t.warehouseId),
]);
export const stockMovement = appSchema.table("stock_movement", {
  id: uuid("id").primaryKey().defaultRandom(), balanceId: uuid("balance_id").notNull().references(() => inventoryBalance.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(), kind: text("kind").notNull(), quantity: integer("quantity").notNull(),
  onHandDelta: integer("on_hand_delta").notNull(), reservedDelta: integer("reserved_delta").notNull(), quarantinedDelta: integer("quarantined_delta").notNull(),
  sourceRef: text("source_ref").notNull(), actorId: text("actor_id"), reason: text("reason").notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (t) => [
  unique("stock_movement_revision_unique").on(t.balanceId, t.revision),
  unique("stock_movement_effect_unique").on(t.balanceId, t.kind, t.sourceRef),
  check("stock_movement_quantity_check", sql`${t.quantity}>0 AND ${t.revision}>0`),
  check("stock_movement_kind_check", sql`${t.kind} IN ('receive','adjust_up','adjust_down','quarantine','release_quarantine','write_off','reserve','release','consume','transfer_out','transfer_in')`),
  check("stock_movement_reason_check", sql`char_length(${t.reason}) between 1 and 500 AND char_length(${t.sourceRef}) between 1 and 200`),
  check("stock_movement_delta_check", sql`
    (${t.kind} IN ('receive','transfer_in') AND ${t.onHandDelta}=${t.quantity} AND ${t.reservedDelta}=0 AND ${t.quarantinedDelta} between 0 and ${t.quantity}) OR
    (${t.kind}='adjust_up' AND ${t.onHandDelta}=${t.quantity} AND ${t.reservedDelta}=0 AND ${t.quarantinedDelta}=0) OR
    (${t.kind}='adjust_down' AND ${t.onHandDelta}=-${t.quantity} AND ${t.reservedDelta}=0 AND ${t.quarantinedDelta}=0) OR
    (${t.kind}='quarantine' AND ${t.onHandDelta}=0 AND ${t.reservedDelta}=0 AND ${t.quarantinedDelta}=${t.quantity}) OR
    (${t.kind}='release_quarantine' AND ${t.onHandDelta}=0 AND ${t.reservedDelta}=0 AND ${t.quarantinedDelta}=-${t.quantity}) OR
    (${t.kind}='write_off' AND ${t.onHandDelta}=-${t.quantity} AND ${t.reservedDelta}=0 AND ${t.quarantinedDelta}=-${t.quantity}) OR
    (${t.kind}='reserve' AND ${t.onHandDelta}=0 AND ${t.reservedDelta}=${t.quantity} AND ${t.quarantinedDelta}=0) OR
    (${t.kind}='release' AND ${t.onHandDelta}=0 AND ${t.reservedDelta}=-${t.quantity} AND ${t.quarantinedDelta}=0) OR
    (${t.kind} IN ('consume','transfer_out') AND ${t.onHandDelta}=-${t.quantity} AND ${t.reservedDelta}=-${t.quantity} AND ${t.quarantinedDelta}=0)`),
]);
export const stockReservation = appSchema.table("stock_reservation", {
  id: uuid("id").primaryKey().defaultRandom(), key: text("key").notNull().unique(), requestHash: text("request_hash").notNull(),
  kind: text("kind").notNull(), status: text("status").notNull().default("preparing"), expiresAt: instant("expires_at"),
  clockNamespace: text("clock_namespace").references(() => fixtureNamespace.name, { onDelete: "restrict" }),
  createdAt: instant("created_at").notNull().defaultNow(), resolvedAt: instant("resolved_at"), resolutionReason: text("resolution_reason"),
}, (t) => [
  index("stock_reservation_expiry_idx").on(t.expiresAt).where(sql`${t.status}='active' AND ${t.expiresAt} IS NOT NULL`),
  check("stock_reservation_hash_check", sql`${t.requestHash} ~ '^[0-9a-f]{64}$'`),
  check("stock_reservation_kind_check", sql`(${t.kind}='checkout' AND ${t.expiresAt} IS NOT NULL AND ${t.expiresAt}>${t.createdAt}) OR (${t.kind} IN ('transfer','replacement') AND ${t.expiresAt} IS NULL)`),
  check("stock_reservation_status_check", sql`${t.status} IN ('preparing','active','released','expired','consumed')`),
  check("stock_reservation_resolution_check", sql`(${t.status} IN ('preparing','active') AND ${t.resolvedAt} IS NULL AND ${t.resolutionReason} IS NULL) OR (${t.status} IN ('released','expired','consumed') AND ${t.resolvedAt} IS NOT NULL AND ${t.resolutionReason} IS NOT NULL AND char_length(${t.resolutionReason}) between 1 and 500)`),
]);
export const stockReservationItem = appSchema.table("stock_reservation_item", {
  reservationId: uuid("reservation_id").notNull().references(() => stockReservation.id, { onDelete: "restrict" }), lineId: text("line_id").notNull(),
  productId: uuid("product_id").notNull(), productRevision: integer("product_revision").notNull(), offerId: uuid("offer_id").notNull(),
  warehouseId: uuid("warehouse_id").notNull().references(() => warehouse.id, { onDelete: "restrict" }), offerQuantity: integer("offer_quantity").notNull(),
}, (t) => [
  primaryKey({ columns: [t.reservationId, t.lineId] }),
  foreignKey({ columns: [t.productId, t.productRevision, t.offerId], foreignColumns: [offerRevision.productId, offerRevision.revision, offerRevision.offerId], name: "stock_reservation_offer_fk" }).onDelete("restrict"),
  check("stock_reservation_item_quantity_check", sql`${t.offerQuantity}>0 AND char_length(${t.lineId}) between 1 and 100`),
]);
export const stockReservationComponent = appSchema.table("stock_reservation_component", {
  reservationId: uuid("reservation_id").notNull().references(() => stockReservation.id, { onDelete: "restrict" }),
  balanceId: uuid("balance_id").notNull().references(() => inventoryBalance.id, { onDelete: "restrict" }), quantity: integer("quantity").notNull(),
}, (t) => [primaryKey({ columns: [t.reservationId, t.balanceId] }), check("stock_reservation_component_quantity_check", sql`${t.quantity}>0`)]);
export const warehouseTransfer = appSchema.table("warehouse_transfer", {
  id: uuid("id").primaryKey().defaultRandom(), fromWarehouseId: uuid("from_warehouse_id").notNull().references(() => warehouse.id, { onDelete: "restrict" }),
  toWarehouseId: uuid("to_warehouse_id").notNull().references(() => warehouse.id, { onDelete: "restrict" }),
  stockItemId: uuid("stock_item_id").notNull().references(() => stockItem.id, { onDelete: "restrict" }), quantity: integer("quantity").notNull(),
  reservationId: uuid("reservation_id").notNull().unique().references(() => stockReservation.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("requested"), revision: integer("revision").notNull().default(1),
  receivedQuantity: integer("received_quantity").notNull().default(0), quarantinedQuantity: integer("quarantined_quantity").notNull().default(0),
  createdAt: instant("created_at").notNull().defaultNow(),
}, (t) => [
  check("warehouse_transfer_quantity_check", sql`${t.quantity}>0 AND ${t.receivedQuantity}>=0 AND ${t.receivedQuantity}<=${t.quantity} AND ${t.quarantinedQuantity}>=0 AND ${t.quarantinedQuantity}<=${t.receivedQuantity}`),
  check("warehouse_transfer_scope_check", sql`${t.fromWarehouseId}<>${t.toWarehouseId} AND ${t.revision}>0`),
  check("warehouse_transfer_status_check", sql`${t.status} IN ('requested','dispatched','received','exception','cancelled')`),
  check("warehouse_transfer_state_check", sql`(${t.status} IN ('requested','cancelled') AND ${t.receivedQuantity}=0) OR ${t.status} IN ('dispatched','exception') OR (${t.status}='received' AND ${t.receivedQuantity}=${t.quantity})`),
]);
export const transferReceipt = appSchema.table("transfer_receipt", {
  id: uuid("id").primaryKey().defaultRandom(), transferId: uuid("transfer_id").notNull().references(() => warehouseTransfer.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(), receivedQuantity: integer("received_quantity").notNull(), quarantinedQuantity: integer("quarantined_quantity").notNull(),
  actorId: text("actor_id").notNull(), reason: text("reason").notNull(), createdAt: instant("created_at").notNull().defaultNow(),
}, (t) => [
  unique("transfer_receipt_revision_unique").on(t.transferId, t.revision),
  check("transfer_receipt_quantity_check", sql`${t.revision}>1 AND ${t.receivedQuantity}>=0 AND ${t.quarantinedQuantity}>=0 AND ${t.quarantinedQuantity}<=${t.receivedQuantity}`),
]);
export const transferReceiptComponent = appSchema.table("transfer_receipt_component", {
  receiptId: uuid("receipt_id").notNull().references(() => transferReceipt.id, { onDelete: "restrict" }),
  sourceBalanceId: uuid("source_balance_id").notNull().references(() => inventoryBalance.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(), quarantinedQuantity: integer("quarantined_quantity").notNull(),
}, (t) => [
  primaryKey({ columns: [t.receiptId, t.sourceBalanceId] }),
  check("transfer_receipt_component_quantity_check", sql`${t.quantity}>0 AND ${t.quarantinedQuantity}>=0 AND ${t.quarantinedQuantity}<=${t.quantity}`),
]);

export const componentCostVersion = appSchema.table("component_cost_version", {
  id: uuid("id").primaryKey().defaultRandom(), stockItemId: uuid("stock_item_id").notNull().references(() => stockItem.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(), unitCost: integer("unit_cost"), effectiveAt: instant("effective_at").notNull(),
  source: text("source").notNull(), reason: text("reason").notNull(), actorId: text("actor_id").notNull(),
  createdAt: instant("created_at").notNull().default(sql`clock_timestamp()`),
}, (t) => [
  unique("component_cost_revision_unique").on(t.stockItemId,t.revision), unique("component_cost_identity_unique").on(t.id,t.stockItemId),
  index("component_cost_effective_idx").on(t.stockItemId,t.effectiveAt,t.revision),
  check("component_cost_value_check",sql`${t.revision}>0 AND (${t.unitCost} IS NULL OR ${t.unitCost}>=0)`),
  check("component_cost_reason_check",sql`char_length(${t.source}) between 1 and 500 AND char_length(${t.reason}) between 1 and 500`),
]);
export const offerCostAssumptionVersion = appSchema.table("offer_cost_assumption_version", {
  id: uuid("id").primaryKey().defaultRandom(), offerId: uuid("offer_id").notNull().references(() => offer.id, { onDelete: "restrict" }),
  revision: integer("revision").notNull(), effectiveAt: instant("effective_at").notNull(),
  packagingIdr: integer("packaging_idr"), providerFeeIdr: integer("provider_fee_idr"), subsidyIdr: integer("subsidy_idr"), returnsReserveIdr: integer("returns_reserve_idr"),
  source: text("source").notNull(), reason: text("reason").notNull(), actorId: text("actor_id").notNull(),
  createdAt: instant("created_at").notNull().default(sql`clock_timestamp()`),
}, (t) => [
  unique("offer_assumption_revision_unique").on(t.offerId,t.revision), unique("offer_assumption_identity_unique").on(t.id,t.offerId),
  index("offer_assumption_effective_idx").on(t.offerId,t.effectiveAt,t.revision),
  check("offer_assumption_value_check",sql`${t.revision}>0 AND (${t.packagingIdr} IS NULL OR ${t.packagingIdr}>=0) AND (${t.providerFeeIdr} IS NULL OR ${t.providerFeeIdr}>=0) AND (${t.subsidyIdr} IS NULL OR ${t.subsidyIdr}>=0) AND (${t.returnsReserveIdr} IS NULL OR ${t.returnsReserveIdr}>=0)`),
  check("offer_assumption_reason_check",sql`char_length(${t.source}) between 1 and 500 AND char_length(${t.reason}) between 1 and 500`),
]);
export const publicationHead = appSchema.table("publication_head", {
  productId: uuid("product_id").primaryKey().references(() => product.id,{onDelete:"restrict"}), revision: integer("revision").notNull().default(0),
}, (t)=>[check("publication_head_revision_check",sql`${t.revision}>=0`)]);
export const publicationVersion = appSchema.table("publication_version", {
  id: uuid("id").primaryKey().defaultRandom(), productId: uuid("product_id").notNull().references(()=>publicationHead.productId,{onDelete:"restrict"}),
  revision: integer("revision").notNull(), productRevision: integer("product_revision").notNull(),
  policyVersionId: uuid("policy_version_id").notNull().references(()=>policyVersion.id,{onDelete:"restrict"}),
  minimumContributionIdr: integer("minimum_contribution_idr").notNull(), commissionBps: integer("commission_bps").notNull(),
  evaluatedAt: instant("evaluated_at").notNull(), exceptionReason: text("exception_reason"), actorId: text("actor_id").notNull(), reason: text("reason").notNull(),
  createdAt: instant("created_at").notNull().default(sql`clock_timestamp()`),
}, (t)=>[
  unique("publication_version_unique").on(t.productId,t.revision), unique("publication_identity_unique").on(t.id,t.productId,t.productRevision),
  foreignKey({columns:[t.productId,t.productRevision],foreignColumns:[productRevision.productId,productRevision.revision],name:"publication_product_revision_fk"}).onDelete("restrict"),
  check("publication_version_value_check",sql`${t.revision}>0 AND ${t.productRevision}>0 AND ${t.minimumContributionIdr} between 0 and 99000 AND ${t.commissionBps} between 0 and 10000`),
  check("publication_reason_check",sql`char_length(${t.reason}) between 1 and 500 AND (${t.exceptionReason} IS NULL OR char_length(${t.exceptionReason}) between 1 and 500)`),
]);
export const publicationOffer = appSchema.table("publication_offer", {
  publicationId: uuid("publication_id").notNull(), productId: uuid("product_id").notNull(), productRevision: integer("product_revision").notNull(), offerId: uuid("offer_id").notNull(),
  assumptionVersionId: uuid("assumption_version_id"), estimatedHpp: bigint("estimated_hpp",{mode:"number"}), estimatedContribution: bigint("estimated_contribution",{mode:"number"}),
  complete: boolean("complete").notNull(),
}, (t)=>[
  primaryKey({columns:[t.publicationId,t.offerId]}),
  foreignKey({columns:[t.publicationId,t.productId,t.productRevision],foreignColumns:[publicationVersion.id,publicationVersion.productId,publicationVersion.productRevision],name:"publication_offer_parent_fk"}).onDelete("restrict"),
  foreignKey({columns:[t.productId,t.productRevision,t.offerId],foreignColumns:[offerRevision.productId,offerRevision.revision,offerRevision.offerId],name:"publication_offer_definition_fk"}).onDelete("restrict"),
  foreignKey({columns:[t.assumptionVersionId,t.offerId],foreignColumns:[offerCostAssumptionVersion.id,offerCostAssumptionVersion.offerId],name:"publication_offer_assumption_fk"}).onDelete("restrict"),
  check("publication_offer_amount_check",sql`(${t.estimatedHpp} IS NULL OR ${t.estimatedHpp} between 0 and 9007199254740991) AND (${t.estimatedContribution} IS NULL OR ${t.estimatedContribution} between -9007199254740991 and 99000)`),
  check("publication_offer_complete_check",sql`(${t.complete} AND ${t.estimatedHpp} IS NOT NULL AND ${t.estimatedContribution} IS NOT NULL) OR (NOT ${t.complete} AND ${t.estimatedContribution} IS NULL)`),
]);
export const publicationComponentCost = appSchema.table("publication_component_cost", {
  publicationId: uuid("publication_id").notNull(), offerId: uuid("offer_id").notNull(),stockItemId: uuid("stock_item_id").notNull().references(()=>stockItem.id,{onDelete:"restrict"}),
  quantity: integer("quantity").notNull(), costVersionId: uuid("cost_version_id"),
}, (t)=>[
  primaryKey({columns:[t.publicationId,t.offerId,t.stockItemId]}),
  foreignKey({columns:[t.publicationId,t.offerId],foreignColumns:[publicationOffer.publicationId,publicationOffer.offerId],name:"publication_component_offer_fk"}).onDelete("restrict"),
  foreignKey({columns:[t.costVersionId,t.stockItemId],foreignColumns:[componentCostVersion.id,componentCostVersion.stockItemId],name:"publication_component_cost_fk"}).onDelete("restrict"),
  check("publication_component_quantity_check",sql`${t.quantity}>0`),
]);
// Withdrawal takes the current publication off sale without touching immutable publication
// history; a later publication (new head revision) is unaffected. Guarded in migration 0029.
export const publicationWithdrawal = appSchema.table("publication_withdrawal", {
  publicationId: uuid("publication_id").primaryKey(), productId: uuid("product_id").notNull(), productRevision: integer("product_revision").notNull(),
  actorId: text("actor_id").notNull(), reason: text("reason").notNull(), createdAt: instant("created_at").notNull().default(sql`clock_timestamp()`),
}, (t)=>[
  foreignKey({columns:[t.publicationId,t.productId,t.productRevision],foreignColumns:[publicationVersion.id,publicationVersion.productId,publicationVersion.productRevision],name:"publication_withdrawal_publication_fk"}).onDelete("restrict"),
  check("publication_withdrawal_reason_check",sql`char_length(${t.reason}) between 1 and 500`),
]);

export const promotion = appSchema.table("promotion",{
  id:uuid("id").primaryKey().defaultRandom(),configurationRevision:integer("configuration_revision").notNull().default(0),
  budgetRevision:integer("budget_revision").notNull().default(0),reservedAmount:bigint("reserved_amount",{mode:"number"}).notNull().default(0),
  committedAmount:bigint("committed_amount",{mode:"number"}).notNull().default(0),createdAt:instant("created_at").notNull().default(sql`clock_timestamp()`),
},(t)=>[
  check("promotion_revisions_check",sql`${t.configurationRevision}>=0 AND ${t.budgetRevision}>=0`),
  check("promotion_money_check",sql`${t.reservedAmount}>=0 AND ${t.committedAmount}>=0 AND ${t.reservedAmount}::numeric+${t.committedAmount}::numeric<=9007199254740991`),
]);
export const promotionVersion = appSchema.table("promotion_version",{
  id:uuid("id").primaryKey().defaultRandom(),promotionId:uuid("promotion_id").notNull().references(()=>promotion.id,{onDelete:"restrict"}),revision:integer("revision").notNull(),
  name:text("name").notNull(),active:boolean("active").notNull(),startsAt:instant("starts_at").notNull(),endsAt:instant("ends_at").notNull(),kind:text("kind").notNull(),
  value:bigint("value",{mode:"number"}).notNull(),maximumPerOrder:bigint("maximum_per_order",{mode:"number"}).notNull(),minimumMerchandise:bigint("minimum_merchandise",{mode:"number"}).notNull(),
  budget:bigint("budget",{mode:"number"}).notNull(),perBuyerLimit:integer("per_buyer_limit").notNull(),paymentMethods:text("payment_methods").array().notNull(),
  regionIds:text("region_ids").array().notNull().default(sql`ARRAY[]::text[]`),serviceIds:text("service_ids").array().notNull().default(sql`ARRAY[]::text[]`),
  stacking:text("stacking").notNull(),priority:integer("priority").notNull().default(0),actorId:text("actor_id").notNull(),reason:text("reason").notNull(),
  createdAt:instant("created_at").notNull().default(sql`clock_timestamp()`),
},(t)=>[
  unique("promotion_version_unique").on(t.promotionId,t.revision),unique("promotion_version_identity_unique").on(t.id,t.promotionId),
  check("promotion_version_metadata_check",sql`${t.revision}>0 AND char_length(${t.name}) between 1 and 200 AND char_length(${t.reason}) between 1 and 500 AND ${t.startsAt}<${t.endsAt}`),
  check("promotion_version_money_check",sql`${t.value} between 0 and 9007199254740991 AND ${t.maximumPerOrder} between 0 and 9007199254740991 AND ${t.minimumMerchandise} between 0 and 9007199254740991 AND ${t.budget} between 0 and 9007199254740991`),
  check("promotion_version_kind_check",sql`(${t.kind}='fixed') OR (${t.kind}='percentage' AND ${t.value}<=10000)`),
  check("promotion_version_active_check",sql`NOT ${t.active} OR (${t.value}>0 AND ${t.maximumPerOrder}>0 AND ${t.budget}>0)`),
  check("promotion_version_rules_check",sql`${t.perBuyerLimit} between 1 and 1000000 AND ${t.priority} between 0 and 10000 AND ${t.stacking} IN ('exclusive','allowed')`),
  check("promotion_version_methods_check",sql`cardinality(${t.paymentMethods}) between 1 and 2 AND ${t.paymentMethods} <@ ARRAY['prepaid','cod']::text[] AND array_position(${t.paymentMethods},NULL) IS NULL`),
  check("promotion_version_targets_check",sql`cardinality(${t.regionIds})<=100 AND cardinality(${t.serviceIds})<=100 AND array_position(${t.regionIds},NULL) IS NULL AND array_position(${t.serviceIds},NULL) IS NULL`),
]);
export const promotionBuyerUsage = appSchema.table("promotion_buyer_usage",{
  promotionId:uuid("promotion_id").notNull().references(()=>promotion.id,{onDelete:"restrict"}),customerKey:text("customer_key").notNull(),
  reservedUses:integer("reserved_uses").notNull().default(0),committedUses:integer("committed_uses").notNull().default(0),revision:integer("revision").notNull().default(0),
},(t)=>[
  primaryKey({columns:[t.promotionId,t.customerKey]}),check("promotion_buyer_key_check",sql`${t.customerKey} ~ '^[0-9a-f]{64}$'`),
  check("promotion_buyer_usage_check",sql`${t.reservedUses}>=0 AND ${t.committedUses}>=0 AND ${t.revision}>=0 AND ${t.reservedUses}::bigint+${t.committedUses}::bigint<=2147483647`),
]);
export const promotionReservation = appSchema.table("promotion_reservation",{
  id:uuid("id").primaryKey().defaultRandom(),key:text("key").notNull().unique(),requestHash:text("request_hash").notNull(),customerKey:text("customer_key").notNull(),
  status:text("status").notNull().default("preparing"),paymentMethod:text("payment_method").notNull(),merchandiseAmount:bigint("merchandise_amount",{mode:"number"}).notNull(),
  shippingAmount:bigint("shipping_amount",{mode:"number"}).notNull(),subsidyAmount:bigint("subsidy_amount",{mode:"number"}).notNull(),
  clockNamespace:text("clock_namespace").references(()=>fixtureNamespace.name,{onDelete:"restrict"}),expiresAt:instant("expires_at").notNull(),
  createdAt:instant("created_at").notNull(),resolvedAt:instant("resolved_at"),resolutionReason:text("resolution_reason"),
},(t)=>[
  index("promotion_reservation_expiry_idx").on(t.expiresAt).where(sql`${t.status}='active'`),
  check("promotion_reservation_identity_check",sql`${t.requestHash} ~ '^[0-9a-f]{64}$' AND ${t.customerKey} ~ '^[0-9a-f]{64}$' AND char_length(${t.key}) between 1 and 200`),
  check("promotion_reservation_state_check",sql`${t.status} IN ('preparing','active','released','expired','consumed') AND ${t.paymentMethod} IN ('prepaid','cod')`),
  check("promotion_reservation_amount_check",sql`${t.merchandiseAmount} between 99000 and 9007199254740991 AND ${t.merchandiseAmount}%99000=0 AND ${t.shippingAmount} between 1 and 9007199254740991 AND ${t.subsidyAmount}>0 AND ${t.subsidyAmount}<=${t.shippingAmount}`),
  check("promotion_reservation_deadline_check",sql`${t.expiresAt}>${t.createdAt} AND ${t.expiresAt}<=${t.createdAt}+interval '24 hours'`),
  check("promotion_reservation_resolution_check",sql`(${t.status} IN ('preparing','active') AND ${t.resolvedAt} IS NULL AND ${t.resolutionReason} IS NULL) OR (${t.status} IN ('released','expired','consumed') AND ${t.resolvedAt} IS NOT NULL AND ${t.resolutionReason} IS NOT NULL AND char_length(${t.resolutionReason}) between 1 and 500)`),
]);
export const promotionReservationItem = appSchema.table("promotion_reservation_item",{
  reservationId:uuid("reservation_id").notNull().references(()=>promotionReservation.id,{onDelete:"restrict"}),lineId:text("line_id").notNull(),
  productId:uuid("product_id").notNull(),productRevision:integer("product_revision").notNull(),offerId:uuid("offer_id").notNull(),quantity:integer("quantity").notNull(),
},(t)=>[
  primaryKey({columns:[t.reservationId,t.lineId]}),
  foreignKey({columns:[t.productId,t.productRevision,t.offerId],foreignColumns:[offerRevision.productId,offerRevision.revision,offerRevision.offerId],name:"promotion_reservation_offer_fk"}).onDelete("restrict"),
  check("promotion_reservation_item_check",sql`${t.quantity} between 1 and 1000000 AND char_length(${t.lineId}) between 1 and 100`),
]);
export const promotionShipment = appSchema.table("promotion_shipment",{
  reservationId:uuid("reservation_id").notNull().references(()=>promotionReservation.id,{onDelete:"restrict"}),shipmentId:text("shipment_id").notNull(),
  originWarehouseId:uuid("origin_warehouse_id").notNull().references(()=>warehouse.id,{onDelete:"restrict"}),shippingFee:bigint("shipping_fee",{mode:"number"}).notNull(),
  serviceId:text("service_id").notNull(),regionIds:text("region_ids").array().notNull(),
},(t)=>[
  primaryKey({columns:[t.reservationId,t.shipmentId]}),
  check("promotion_shipment_value_check",sql`${t.shippingFee} between 0 and 9007199254740991 AND char_length(${t.shipmentId}) between 1 and 100 AND char_length(${t.serviceId}) between 1 and 100 AND cardinality(${t.regionIds}) between 1 and 10 AND array_position(${t.regionIds},NULL) IS NULL`),
]);
export const promotionAllocation = appSchema.table("promotion_allocation",{
  reservationId:uuid("reservation_id").notNull().references(()=>promotionReservation.id,{onDelete:"restrict"}),promotionId:uuid("promotion_id").notNull(),
  versionId:uuid("version_id").notNull(),amount:bigint("amount",{mode:"number"}).notNull(),
},(t)=>[
  primaryKey({columns:[t.reservationId,t.promotionId]}),
  foreignKey({columns:[t.versionId,t.promotionId],foreignColumns:[promotionVersion.id,promotionVersion.promotionId],name:"promotion_allocation_version_fk"}).onDelete("restrict"),
  check("promotion_allocation_value_check",sql`${t.amount} between 1 and 9007199254740991`),
]);
export const promotionShipmentAllocation = appSchema.table("promotion_shipment_allocation",{
  reservationId:uuid("reservation_id").notNull(),promotionId:uuid("promotion_id").notNull(),shipmentId:text("shipment_id").notNull(),amount:bigint("amount",{mode:"number"}).notNull(),
},(t)=>[
  primaryKey({columns:[t.reservationId,t.promotionId,t.shipmentId]}),
  foreignKey({columns:[t.reservationId,t.promotionId],foreignColumns:[promotionAllocation.reservationId,promotionAllocation.promotionId],name:"promotion_shipment_parent_fk"}).onDelete("restrict"),
  foreignKey({columns:[t.reservationId,t.shipmentId],foreignColumns:[promotionShipment.reservationId,promotionShipment.shipmentId],name:"promotion_shipment_fee_fk"}).onDelete("restrict"),
  check("promotion_shipment_allocation_value_check",sql`${t.amount} between 1 and 9007199254740991`),
]);
export const promotionMovement = appSchema.table("promotion_movement",{
  id:uuid("id").primaryKey().defaultRandom(),promotionId:uuid("promotion_id").notNull().references(()=>promotion.id,{onDelete:"restrict"}),
  customerKey:text("customer_key").notNull(),reservationId:uuid("reservation_id").notNull().references(()=>promotionReservation.id,{onDelete:"restrict"}),
  exceptionOperationId:uuid("exception_operation_id").references(()=>exceptionOperation.id,{onDelete:"restrict"}),
  kind:text("kind").notNull(),amount:bigint("amount",{mode:"number"}).notNull(),budgetRevision:integer("budget_revision").notNull(),buyerRevision:integer("buyer_revision").notNull(),
  reservedDelta:bigint("reserved_delta",{mode:"number"}).notNull(),committedDelta:bigint("committed_delta",{mode:"number"}).notNull(),
  reservedUsesDelta:integer("reserved_uses_delta").notNull(),committedUsesDelta:integer("committed_uses_delta").notNull(),
  actorId:text("actor_id"),reason:text("reason").notNull(),createdAt:instant("created_at").notNull().default(sql`clock_timestamp()`),
},(t)=>[
  unique("promotion_movement_budget_unique").on(t.promotionId,t.budgetRevision),unique("promotion_movement_buyer_unique").on(t.promotionId,t.customerKey,t.buyerRevision),
  uniqueIndex("promotion_movement_effect_unique").on(t.reservationId,t.promotionId,t.kind).where(sql`${t.exceptionOperationId} IS NULL`),
  unique("promotion_movement_exception_unique").on(t.reservationId,t.promotionId,t.exceptionOperationId),
  foreignKey({columns:[t.promotionId,t.customerKey],foreignColumns:[promotionBuyerUsage.promotionId,promotionBuyerUsage.customerKey],name:"promotion_movement_buyer_fk"}).onDelete("restrict"),
  check("promotion_movement_value_check",sql`${t.amount} between 1 and 9007199254740991 AND ${t.budgetRevision}>0 AND ${t.buyerRevision}>0 AND char_length(${t.reason}) between 1 and 500`),
  check("promotion_movement_cause_check",sql`((${t.kind} IN ('cancel_reserved','cancel_committed'))=(${t.exceptionOperationId} IS NOT NULL))`),
  check("promotion_movement_delta_check",sql`(${t.kind}='reserve' AND ${t.reservedDelta}=${t.amount} AND ${t.committedDelta}=0 AND ${t.reservedUsesDelta}=1 AND ${t.committedUsesDelta}=0) OR (${t.kind}='release' AND ${t.reservedDelta}=-${t.amount} AND ${t.committedDelta}=0 AND ${t.reservedUsesDelta}=-1 AND ${t.committedUsesDelta}=0) OR (${t.kind}='consume' AND ${t.reservedDelta}=-${t.amount} AND ${t.committedDelta}=${t.amount} AND ${t.reservedUsesDelta}=-1 AND ${t.committedUsesDelta}=1) OR (${t.kind}='cancel_reserved' AND ${t.reservedDelta}=-${t.amount} AND ${t.committedDelta}=0 AND ${t.reservedUsesDelta} IN (0,-1) AND ${t.committedUsesDelta}=0) OR (${t.kind}='cancel_committed' AND ${t.reservedDelta}=0 AND ${t.committedDelta}=-${t.amount} AND ${t.reservedUsesDelta}=0 AND ${t.committedUsesDelta}=0)`),
]);

export const commerceGuest = appSchema.table('commerce_guest_context',{
 id:uuid('id').primaryKey().defaultRandom(),digest:text('digest').notNull().unique(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),expiresAt:instant('expires_at').notNull(),revokedAt:instant('revoked_at'),
},t=>[index('commerce_guest_expiry_idx').on(t.expiresAt),check('commerce_guest_value_check',sql`${t.digest} ~ '^[0-9a-f]{64}$' AND ${t.expiresAt}>${t.createdAt} AND ${t.expiresAt}<=${t.createdAt}+interval '7 days'`)]);
export const commerceOperation = appSchema.table('commerce_operation',{
 id:uuid('id').primaryKey().defaultRandom(),actorScope:text('actor_scope').notNull(),key:text('key').notNull(),action:text('action').notNull(),requestHash:text('request_hash').notNull(),resourceId:uuid('resource_id').notNull(),result:jsonb('result').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('commerce_operation_key_unique').on(t.actorScope,t.key),check('commerce_operation_value_check',sql`char_length(${t.actorScope}) between 6 and 250 AND char_length(${t.key}) between 1 and 200 AND ${t.requestHash} ~ '^[0-9a-f]{64}$' AND jsonb_typeof(${t.result})='object'`)]);
export const cart = appSchema.table('cart',{
 id:uuid('id').primaryKey().defaultRandom(),ownerUserId:text('owner_user_id').references(()=>user.id,{onDelete:'restrict'}),ownerGuestId:uuid('owner_guest_id').references(()=>commerceGuest.id,{onDelete:'restrict'}),revision:integer('revision').notNull().default(1),state:text('state').notNull().default('open'),transport:text('transport').notNull(),capDigest:text('cap_digest'),capIssuedAt:instant('cap_issued_at'),capExpiresAt:instant('cap_expires_at'),clockNamespace:text('clock_namespace').references(()=>fixtureNamespace.name,{onDelete:'restrict'}),createdAt:instant('created_at').notNull(),expiresAt:instant('expires_at').notNull(),activeQuoteId:uuid('active_quote_id'),submittedOrderId:uuid('submitted_order_id'),
},t=>[index('cart_user_idx').on(t.ownerUserId),index('cart_guest_idx').on(t.ownerGuestId),
 check('cart_owner_check',sql`(${t.ownerUserId} IS NULL) <> (${t.ownerGuestId} IS NULL)`),
 check('cart_state_check',sql`${t.revision}>0 AND ${t.state} IN ('open','submitted') AND ${t.transport} IN ('browser','header') AND (${t.ownerUserId} IS NULL OR ${t.transport}='browser') AND ((${t.state}='open' AND ${t.submittedOrderId} IS NULL) OR (${t.state}='submitted' AND ${t.submittedOrderId} IS NOT NULL))`),
 check('cart_deadline_check',sql`${t.expiresAt}>${t.createdAt} AND ${t.expiresAt}<=${t.createdAt}+interval '7 days'`),
 check('cart_capability_check',sql`(${t.ownerGuestId} IS NOT NULL AND ${t.capDigest} IS NOT NULL AND ${t.capDigest} ~ '^[0-9a-f]{64}$' AND ${t.capIssuedAt} IS NOT NULL AND ${t.capExpiresAt} IS NOT NULL AND ${t.capExpiresAt}=${t.capIssuedAt}+interval '7 days') OR (${t.ownerUserId} IS NOT NULL AND ${t.capDigest} IS NULL AND ${t.capIssuedAt} IS NULL AND ${t.capExpiresAt} IS NULL)`),
]);
export const cartLine = appSchema.table('cart_line',{
 id:uuid('id').primaryKey().defaultRandom(),cartId:uuid('cart_id').notNull().references(()=>cart.id,{onDelete:'restrict'}),productId:uuid('product_id').notNull(),productRevision:integer('product_revision').notNull(),offerId:uuid('offer_id').notNull(),publicationId:uuid('publication_id').notNull(),quantity:integer('quantity').notNull(),unitPrice:integer('unit_price').notNull().default(99000),
},t=>[unique('cart_line_offer_unique').on(t.cartId,t.offerId),foreignKey({columns:[t.publicationId,t.productId,t.productRevision],foreignColumns:[publicationVersion.id,publicationVersion.productId,publicationVersion.productRevision],name:'cart_line_publication_fk'}).onDelete('restrict'),foreignKey({columns:[t.publicationId,t.offerId],foreignColumns:[publicationOffer.publicationId,publicationOffer.offerId],name:'cart_line_offer_fk'}).onDelete('restrict'),check('cart_line_value_check',sql`${t.quantity} between 1 and 50 AND ${t.unitPrice}=99000`)]);
export const checkoutQuote = appSchema.table('checkout_quote',{
 id:uuid('id').primaryKey().defaultRandom(),cartId:uuid('cart_id').notNull().references(()=>cart.id,{onDelete:'restrict'}),cartRevision:integer('cart_revision').notNull(),parentId:uuid('parent_id'),operationId:uuid('operation_id').notNull().unique(),document:jsonb('document').notNull(),paymentMethod:text('payment_method').notNull(),merchandiseAmount:bigint('merchandise_amount',{mode:'number'}).notNull(),shippingAmount:bigint('shipping_amount',{mode:'number'}).notNull(),subsidyAmount:bigint('subsidy_amount',{mode:'number'}).notNull(),buyerTotal:bigint('buyer_total',{mode:'number'}).notNull(),createdAt:instant('created_at').notNull(),expiresAt:instant('expires_at').notNull(),
 paymentChannel:text('payment_channel'),paymentChargeAmount:bigint('payment_charge_amount',{mode:'number'}).notNull().default(0),codFeeBps:integer('cod_fee_bps'),
},t=>[index('checkout_quote_cart_idx').on(t.cartId),
 // S104/S100: staff phone-suffix search matches a reversed digit prefix (text_pattern_ops for LIKE under en_US).
 index('checkout_quote_contact_phone_suffix_idx').using('btree',sql`reverse(regexp_replace(coalesce(${t.document}->'contact'->>'phone',''),'[^0-9]','','g')) text_pattern_ops`),
 index('checkout_quote_address_phone_suffix_idx').using('btree',sql`reverse(regexp_replace(coalesce(${t.document}->'address'->>'phone',''),'[^0-9]','','g')) text_pattern_ops`),
 check('checkout_quote_value_check',sql`${t.cartRevision}>0 AND ${t.paymentMethod} IN ('prepaid','cod') AND ${t.merchandiseAmount} between 99000 and 4950000 AND ${t.merchandiseAmount}%99000=0 AND ${t.shippingAmount} between 0 and 9007199254740991 AND ${t.subsidyAmount} between 0 and ${t.shippingAmount} AND ${t.buyerTotal}=${t.merchandiseAmount}+${t.shippingAmount}-${t.subsidyAmount} AND ${t.buyerTotal}<=9007199254740991`),check('checkout_quote_payment_check',sql`(${t.paymentChannel} IS NULL OR (${t.paymentMethod}='cod' AND ${t.paymentChannel}='cod') OR (${t.paymentMethod}='prepaid' AND ${t.paymentChannel} IN ('local-prepaid','manual-bank','autolaris'))) AND ${t.paymentChargeAmount} between 0 and 9007199254740991 AND (${t.codFeeBps} IS NULL OR ${t.codFeeBps} between 0 and 2000) AND (${t.paymentMethod}='cod' OR (${t.paymentChargeAmount}=0 AND ${t.codFeeBps} IS NULL))`),check('checkout_quote_document_check',sql`jsonb_typeof(${t.document})='object' AND octet_length(${t.document}::text)<=1048576`),check('checkout_quote_deadline_check',sql`${t.expiresAt}>${t.createdAt} AND ${t.expiresAt}<=${t.createdAt}+interval '10 minutes'`)]);
export const commerceOrder = appSchema.table('commerce_order',{
 id:uuid('id').primaryKey().defaultRandom(),number:text('number').notNull().unique(),cartId:uuid('cart_id').notNull().unique().references(()=>cart.id,{onDelete:'restrict'}),quoteId:uuid('quote_id').notNull().unique().references(()=>checkoutQuote.id,{onDelete:'restrict'}),ownerUserId:text('owner_user_id').references(()=>user.id,{onDelete:'restrict'}),ownerGuestId:uuid('owner_guest_id').references(()=>commerceGuest.id,{onDelete:'restrict'}),stockReservationId:uuid('stock_reservation_id').notNull().unique().references(()=>stockReservation.id,{onDelete:'restrict'}),promotionReservationId:uuid('promotion_reservation_id').unique().references(()=>promotionReservation.id,{onDelete:'restrict'}),operationId:uuid('operation_id').notNull().unique(),paymentMethod:text('payment_method').notNull(),merchandiseAmount:bigint('merchandise_amount',{mode:'number'}).notNull(),shippingAmount:bigint('shipping_amount',{mode:'number'}).notNull(),subsidyAmount:bigint('subsidy_amount',{mode:'number'}).notNull(),buyerTotal:bigint('buyer_total',{mode:'number'}).notNull(),buyerNote:text('buyer_note'),revision:integer('revision').notNull().default(0),status:text('status').notNull().default('preparing'),paymentStatus:text('payment_status').notNull().default('pending'),clockNamespace:text('clock_namespace').references(()=>fixtureNamespace.name,{onDelete:'restrict'}),createdAt:instant('created_at').notNull(),expiresAt:instant('expires_at').notNull(),actionableAt:instant('actionable_at'),
 paymentChannel:text('payment_channel'),paymentChargeAmount:bigint('payment_charge_amount',{mode:'number'}).notNull().default(0),codFeeBps:integer('cod_fee_bps'),transferCode:integer('transfer_code'),paymentPolicyVersionId:uuid('payment_policy_version_id').references(()=>policyVersion.id,{onDelete:'restrict'}),
},t=>[index('commerce_order_history_idx').on(t.createdAt,t.id),
 // S104: transfer codes stay reserved 72 h past the order deadline (reservedTransferCodes).
 index('commerce_order_transfer_code_recent_idx').on(t.expiresAt,t.transferCode).where(sql`${t.paymentChannel}='manual-bank'`),
 index('commerce_order_guest_idx').on(t.ownerGuestId),index('commerce_order_expiry_idx').on(t.expiresAt).where(sql`${t.status}='pending'`),check('commerce_order_owner_check',sql`(${t.ownerUserId} IS NULL) <> (${t.ownerGuestId} IS NULL)`),check('commerce_order_value_check',sql`${t.number} ~ '^99-[A-Z0-9]{16}$' AND ${t.paymentMethod} IN ('prepaid','cod') AND ${t.merchandiseAmount} between 99000 and 4950000 AND ${t.shippingAmount} between 0 and 9007199254740991 AND ${t.subsidyAmount} between 0 and ${t.shippingAmount} AND ${t.buyerTotal}=${t.merchandiseAmount}+${t.shippingAmount}-${t.subsidyAmount} AND ${t.buyerTotal}<=9007199254740991 AND (${t.buyerNote} IS NULL OR char_length(${t.buyerNote})<=500)`),check('commerce_order_state_check',sql`(${t.status}='preparing' AND ${t.revision}=0 AND ${t.paymentStatus}='pending' AND ${t.actionableAt} IS NULL) OR (${t.status}='pending' AND ${t.revision}=1 AND ${t.paymentStatus}='pending' AND ${t.actionableAt} IS NULL) OR (${t.status} IN ('pending','processing','partially_completed','cancelled') AND ${t.revision}>=2 AND ${t.paymentStatus}='confirmed' AND ${t.paymentMethod}='prepaid' AND ${t.actionableAt} IS NOT NULL) OR (${t.status} IN ('pending','processing','partially_completed','cancelled') AND ${t.paymentMethod}='cod' AND ${t.actionableAt} IS NOT NULL AND (${t.revision}>=2 AND ${t.paymentStatus} IN ('cod_due','partially_collected','confirmed'))) OR (${t.status}='cancelled' AND ${t.revision}=2 AND ${t.paymentStatus}='expired' AND ${t.actionableAt} IS NULL)`),check('commerce_order_deadline_check',sql`${t.expiresAt}=${t.createdAt}+interval '30 minutes' OR (${t.paymentChannel}='manual-bank' AND ${t.expiresAt}=${t.createdAt}+interval '24 hours')`),check('commerce_order_payment_check',sql`(${t.paymentChannel} IS NULL OR (${t.paymentMethod}='cod' AND ${t.paymentChannel}='cod') OR (${t.paymentMethod}='prepaid' AND ${t.paymentChannel} IN ('local-prepaid','manual-bank','autolaris'))) AND ${t.paymentChargeAmount} between 0 and 9007199254740991 AND (${t.codFeeBps} IS NULL OR ${t.codFeeBps} between 0 and 2000) AND ((${t.paymentChannel}='manual-bank')=(${t.transferCode} IS NOT NULL)) AND (${t.transferCode} IS NULL OR (${t.transferCode} between 1 and 999 AND ${t.paymentChargeAmount}=${t.transferCode} AND ${t.paymentPolicyVersionId} IS NOT NULL)) AND (${t.paymentMethod}='cod' OR ${t.paymentChannel}='manual-bank' OR (${t.paymentChargeAmount}=0 AND ${t.codFeeBps} IS NULL))`),uniqueIndex('commerce_order_open_transfer_code_unique').on(t.transferCode).where(sql`${t.paymentChannel}='manual-bank' AND ${t.status}='pending' AND ${t.paymentStatus}='pending'`)]);
export const orderItem = appSchema.table('order_item',{
 id:uuid('id').primaryKey().defaultRandom(),orderId:uuid('order_id').notNull().references(()=>commerceOrder.id,{onDelete:'restrict'}),lineId:uuid('line_id').notNull(),productId:uuid('product_id').notNull(),productRevision:integer('product_revision').notNull(),offerId:uuid('offer_id').notNull(),publicationId:uuid('publication_id').notNull(),quantity:integer('quantity').notNull(),unitPrice:integer('unit_price').notNull().default(99000),snapshot:jsonb('snapshot').notNull(),
},t=>[unique('order_item_line_unique').on(t.orderId,t.lineId),foreignKey({columns:[t.publicationId,t.productId,t.productRevision],foreignColumns:[publicationVersion.id,publicationVersion.productId,publicationVersion.productRevision],name:'order_item_publication_fk'}).onDelete('restrict'),foreignKey({columns:[t.publicationId,t.offerId],foreignColumns:[publicationOffer.publicationId,publicationOffer.offerId],name:'order_item_offer_fk'}).onDelete('restrict'),check('order_item_value_check',sql`${t.quantity} between 1 and 50 AND ${t.unitPrice}=99000 AND jsonb_typeof(${t.snapshot})='object'`)]);
export const orderShipment = appSchema.table('order_shipment',{
 id:uuid('id').primaryKey().defaultRandom(),orderId:uuid('order_id').notNull().references(()=>commerceOrder.id,{onDelete:'restrict'}),parcelId:text('parcel_id').notNull(),warehouseId:uuid('warehouse_id').notNull().references(()=>warehouse.id,{onDelete:'restrict'}),merchandiseAmount:bigint('merchandise_amount',{mode:'number'}).notNull(),shippingAmount:bigint('shipping_amount',{mode:'number'}).notNull(),subsidyAmount:bigint('subsidy_amount',{mode:'number'}).notNull(),buyerShipping:bigint('buyer_shipping',{mode:'number'}).notNull(),codDue:bigint('cod_due',{mode:'number'}).notNull(),snapshot:jsonb('snapshot').notNull(),paymentCharge:bigint('payment_charge',{mode:'number'}).notNull().default(0),
},t=>[index('order_shipment_warehouse_idx').on(t.warehouseId),check('order_shipment_payment_charge_check',sql`${t.paymentCharge} between 0 and 9007199254740991`),unique('order_shipment_parcel_unique').on(t.orderId,t.parcelId),check('order_shipment_value_check',sql`${t.merchandiseAmount}>0 AND ${t.shippingAmount} between 0 and 9007199254740991 AND ${t.subsidyAmount} between 0 and ${t.shippingAmount} AND ${t.buyerShipping}=${t.shippingAmount}-${t.subsidyAmount} AND ${t.codDue} between 0 and 9007199254740991 AND jsonb_typeof(${t.snapshot})='object'`)]);
export const fulfillmentItem = appSchema.table('fulfillment_item',{
 id:uuid('id').primaryKey().defaultRandom(),orderItemId:uuid('order_item_id').notNull().references(()=>orderItem.id,{onDelete:'restrict'}),shipmentId:uuid('shipment_id').notNull().references(()=>orderShipment.id,{onDelete:'restrict'}),unitIndex:integer('unit_index').notNull(),buyerShipping:bigint('buyer_shipping',{mode:'number'}).notNull(),subsidyAmount:bigint('subsidy_amount',{mode:'number'}).notNull(),paymentCharge:bigint('payment_charge',{mode:'number'}).notNull().default(0),
},t=>[check('fulfillment_item_payment_charge_check',sql`${t.paymentCharge} between 0 and 9007199254740991`),unique('fulfillment_item_occurrence_unique').on(t.orderItemId,t.unitIndex),check('fulfillment_item_value_check',sql`${t.unitIndex} between 1 and 50 AND ${t.buyerShipping} between 0 and 9007199254740991 AND ${t.subsidyAmount} between 0 and 9007199254740991`)]);
export const fulfillmentComponent = appSchema.table('fulfillment_component_allocation',{
 fulfillmentItemId:uuid('fulfillment_item_id').notNull().references(()=>fulfillmentItem.id,{onDelete:'restrict'}),balanceId:uuid('balance_id').notNull().references(()=>inventoryBalance.id,{onDelete:'restrict'}),stockItemId:uuid('stock_item_id').notNull().references(()=>stockItem.id,{onDelete:'restrict'}),quantity:integer('quantity').notNull(),
},t=>[primaryKey({columns:[t.fulfillmentItemId,t.balanceId]}),check('fulfillment_component_quantity_check',sql`${t.quantity} between 1 and 1000000`)]);
export const orderEvent = appSchema.table('order_event',{
 id:uuid('id').primaryKey().defaultRandom(),orderId:uuid('order_id').notNull().references(()=>commerceOrder.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),status:text('status').notNull(),paymentStatus:text('payment_status').notNull(),reason:text('reason').notNull(),sourceId:uuid('source_id').notNull(),createdAt:instant('created_at').notNull(),recordedAt:instant('recorded_at').default(sql`clock_timestamp()`),
},t=>[index('order_event_history_idx').on(t.orderId,t.createdAt,t.id),unique('order_event_revision_unique').on(t.orderId,t.revision),check('order_event_value_check',sql`char_length(${t.reason}) between 1 and 500 AND ((${t.revision}=1 AND ${t.status}='pending' AND ${t.paymentStatus}='pending') OR (${t.revision}=2 AND ${t.status}='cancelled' AND ${t.paymentStatus}='expired') OR (${t.revision}=2 AND ${t.status}='pending' AND ${t.paymentStatus} IN ('confirmed','cod_due')) OR (${t.revision}>=3 AND ${t.status} IN ('pending','processing','partially_completed','cancelled') AND ${t.paymentStatus} IN ('cod_due','partially_collected','confirmed')))`)]);
export const orderAccess = appSchema.table('order_access',{
 orderId:uuid('order_id').primaryKey().references(()=>commerceOrder.id,{onDelete:'restrict'}),guestId:uuid('guest_id').notNull().references(()=>commerceGuest.id,{onDelete:'restrict'}),digest:text('digest').notNull().unique(),issuedAt:instant('issued_at').notNull(),expiresAt:instant('expires_at').notNull(),revokedAt:instant('revoked_at'),
},t=>[index('order_access_guest_idx').on(t.guestId),check('order_access_value_check',sql`${t.digest} ~ '^[0-9a-f]{64}$' AND ${t.expiresAt}=${t.issuedAt}+interval '7 days'`)]);

export const financeTransaction = appSchema.table('finance_transaction',{
 id:uuid('id').primaryKey().defaultRandom(),kind:text('kind').notNull(),source:text('source').notNull(),environment:text('environment').notNull(),effectReference:text('effect_reference').notNull(),requestHash:text('request_hash').notNull(),
 orderId:uuid('order_id').references(()=>commerceOrder.id,{onDelete:'restrict'}),reversesId:uuid('reverses_id'),reason:text('reason').notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),createdXid:text('created_xid').notNull().default(sql`pg_current_xact_id()::text`),
},t=>[
 unique('finance_transaction_effect_unique').on(t.source,t.environment,t.effectReference),unique('finance_transaction_reversal_unique').on(t.reversesId),
 foreignKey({columns:[t.reversesId],foreignColumns:[t.id],name:'finance_transaction_reversal_fk'}).onDelete('restrict'),
 index('finance_transaction_order_idx').on(t.orderId,t.recordedAt,t.id),
 check('finance_transaction_kind_check',sql`${t.kind} IN ('economic_receipt','adjustment','reversal','settlement_cash','settlement_fee','settlement_match','refund_obligation','refund_cash','recovery_obligation','recovery_cash') AND ((${t.kind}='reversal')=(${t.reversesId} IS NOT NULL)) AND ${t.reversesId} IS DISTINCT FROM ${t.id}`),
 check('finance_transaction_identity_check',sql`${t.source} ~ '^[a-z][a-z0-9_.-]{0,99}$' AND ${t.environment} IN ('local','test','production') AND ${t.effectReference} ~ '^[A-Za-z0-9_.:-]{1,200}$' AND ${t.requestHash} ~ '^[0-9a-f]{64}$' AND char_length(${t.reason}) between 1 and 500`),
]);
export const financePosting = appSchema.table('finance_posting',{
 transactionId:uuid('transaction_id').notNull().references(()=>financeTransaction.id,{onDelete:'restrict'}),ordinal:integer('ordinal').notNull(),account:text('account').notNull(),side:text('side').notNull(),amount:bigint('amount',{mode:'number'}).notNull(),
},t=>[primaryKey({columns:[t.transactionId,t.ordinal]}),
 check('finance_posting_value_check',sql`${t.ordinal} between 1 and 100 AND ${t.account} IN ('provider_receivable','buyer_funds_liability','company_cash','settlement_clearing','carrier_expense','provider_fee_expense','refund_payable','commission_expense','affiliate_payable') AND ${t.side} IN ('debit','credit') AND ${t.amount} between 1 and 9007199254740991`),
]);
export const economicReceipt = appSchema.table('economic_receipt',{
 id:uuid('id').primaryKey().defaultRandom(),transactionId:uuid('transaction_id').notNull().unique().references(()=>financeTransaction.id,{onDelete:'restrict'}),orderId:uuid('order_id').notNull().references(()=>commerceOrder.id,{onDelete:'restrict'}),shipmentId:uuid('shipment_id').references(()=>orderShipment.id,{onDelete:'restrict'}),kind:text('kind').notNull(),source:text('source').notNull(),environment:text('environment').notNull(),eventId:text('event_id').notNull(),effectReference:text('effect_reference').notNull(),
 amount:bigint('amount',{mode:'number'}).notNull(),merchandiseAmount:bigint('merchandise_amount',{mode:'number'}).notNull(),buyerShipping:bigint('buyer_shipping',{mode:'number'}).notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
 paymentCharge:bigint('payment_charge',{mode:'number'}).notNull().default(0),
},t=>[
 unique('economic_receipt_event_unique').on(t.source,t.environment,t.eventId),unique('economic_receipt_effect_unique').on(t.source,t.environment,t.effectReference),
 uniqueIndex('economic_receipt_prepaid_order_unique').on(t.orderId).where(sql`${t.kind}='prepaid'`),uniqueIndex('economic_receipt_cod_shipment_unique').on(t.shipmentId).where(sql`${t.kind}='cod'`),
 check('economic_receipt_kind_check',sql`(${t.kind}='prepaid' AND ${t.source}='local.payment' AND ${t.shipmentId} IS NULL) OR (${t.kind}='cod' AND ${t.source}='local.cod' AND ${t.shipmentId} IS NOT NULL)`),
 check('economic_receipt_identity_check',sql`${t.environment} IN ('local','test','production') AND ${t.eventId} ~ '^[A-Za-z0-9_.:-]{1,200}$' AND ${t.effectReference} ~ '^[A-Za-z0-9_.:-]{1,200}$'`),
 check('economic_receipt_money_check',sql`${t.amount} between 1 and 9007199254740991 AND ${t.merchandiseAmount} between 1 and 9007199254740991 AND ${t.buyerShipping} between 0 and 9007199254740991 AND ${t.paymentCharge} between 0 and 9007199254740991 AND ${t.amount}::numeric=${t.merchandiseAmount}::numeric+${t.buyerShipping}::numeric+${t.paymentCharge}::numeric`),
]);

export const paymentAttempt = appSchema.table('payment_attempt',{
 id:uuid('id').primaryKey().defaultRandom(),orderId:uuid('order_id').notNull().references(()=>commerceOrder.id,{onDelete:'restrict'}),methodId:text('method_id').notNull(),key:text('key').notNull(),requestHash:text('request_hash').notNull(),creationJobId:uuid('creation_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),
 providerOperationId:uuid('provider_operation_id').references(():AnyPgColumn=>localPaymentOperation.id,{onDelete:'restrict'}),receiptId:uuid('receipt_id').references(()=>economicReceipt.id,{onDelete:'restrict'}),expectedAmount:bigint('expected_amount',{mode:'number'}).notNull(),revision:integer('revision').notNull().default(0),status:text('status').notNull().default('preparing'),createdAt:instant('created_at').notNull(),expiresAt:instant('expires_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[
 unique('payment_attempt_key_unique').on(t.orderId,t.key),
 index('payment_attempt_open_method_idx').on(t.methodId,t.expiresAt).where(sql`${t.status} IN ('preparing','pending','unknown')`),uniqueIndex('payment_attempt_active_unique').on(t.orderId).where(sql`${t.status} IN ('pending','unknown','confirmed')`),
 check('payment_attempt_identity_check',sql`${t.methodId} IN ('local-prepaid','manual-bank','autolaris') AND ${t.key} ~ '^[A-Za-z0-9_-]{16,200}$' AND ${t.requestHash} ~ '^[0-9a-f]{64}$'`),
 check('payment_attempt_value_check',sql`${t.expectedAmount} between 1 and 9007199254740991 AND ${t.expiresAt}>${t.createdAt} AND ${t.revision}>=0 AND ${t.status} IN ('preparing','pending','unknown','confirmed','expired','failed') AND ((${t.status}='preparing')=(${t.revision}=0)) AND (${t.status}<>'confirmed' OR (${t.providerOperationId} IS NOT NULL AND ${t.receiptId} IS NOT NULL))`),
]);
export const paymentAttemptEvent = appSchema.table('payment_attempt_event',{
 id:uuid('id').primaryKey().defaultRandom(),attemptId:uuid('attempt_id').notNull().references(()=>paymentAttempt.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),status:text('status').notNull(),sourceType:text('source_type').notNull(),sourceId:uuid('source_id').notNull(),providerOperationId:uuid('provider_operation_id').references(()=>localPaymentOperation.id,{onDelete:'restrict'}),receiptId:uuid('receipt_id').references(()=>economicReceipt.id,{onDelete:'restrict'}),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('payment_attempt_event_revision_unique').on(t.attemptId,t.revision),
 check('payment_attempt_event_value_check',sql`${t.revision}>0 AND ${t.status} IN ('pending','unknown','confirmed','expired','failed') AND ${t.sourceType} IN ('request','provider_link','provider_event','creation_rejected','expiry')`),
]);
export const localPaymentOperation = appSchema.table('local_payment_operation',{
 id:uuid('id').primaryKey().defaultRandom(),attemptId:uuid('attempt_id').notNull().unique().references(()=>paymentAttempt.id,{onDelete:'restrict'}),environment:text('environment').notNull(),status:text('status').notNull(),requestedAmount:bigint('requested_amount',{mode:'number'}).notNull(),collectedAmount:bigint('collected_amount',{mode:'number'}),paidAt:instant('paid_at'),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[
 check('local_payment_operation_profile_check',sql`${t.environment} IN ('local','test','production') AND ${t.status} IN ('pending','confirmed','expired','failed')`),
 check('local_payment_operation_money_check',sql`${t.requestedAmount} between 1 and 9007199254740991 AND ((${t.status}='confirmed' AND ${t.collectedAmount} IS NOT NULL AND ${t.collectedAmount} between 1 and 9007199254740991 AND ${t.paidAt} IS NOT NULL) OR (${t.status}<>'confirmed' AND ${t.collectedAmount} IS NULL AND ${t.paidAt} IS NULL))`),
]);
export const localPaymentEvent = appSchema.table('local_payment_event',{
 id:uuid('id').primaryKey().defaultRandom(),operationId:uuid('operation_id').notNull().references(()=>localPaymentOperation.id,{onDelete:'restrict'}),status:text('status').notNull(),amount:bigint('amount',{mode:'number'}).notNull(),occurredAt:instant('occurred_at').notNull(),signature:text('signature').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[index('local_payment_event_operation_idx').on(t.operationId,t.recordedAt,t.id),check('local_payment_event_value_check',sql`${t.status} IN ('pending','confirmed','expired','failed') AND ${t.amount} between 1 and 9007199254740991 AND ${t.signature} ~ '^[0-9a-f]{64}$'`)]);
export const paymentProviderEvent = appSchema.table('payment_provider_event',{
 id:uuid('id').primaryKey().references(()=>localPaymentEvent.id,{onDelete:'restrict'}),attemptId:uuid('attempt_id').notNull().references(()=>paymentAttempt.id,{onDelete:'restrict'}),payloadHash:text('payload_hash').notNull(),callbackJobId:uuid('callback_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('payment_provider_event_hash_check',sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`)]);
export const paymentEventResult = appSchema.table('payment_event_result',{
 eventId:uuid('event_id').primaryKey().references(()=>paymentProviderEvent.id,{onDelete:'restrict'}),outcome:text('outcome').notNull(),reason:text('reason').notNull(),receiptId:uuid('receipt_id').references(()=>economicReceipt.id,{onDelete:'restrict'}),transactionId:uuid('transaction_id').references(()=>financeTransaction.id,{onDelete:'restrict'}),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[
 check('payment_event_result_outcome_check',sql`${t.outcome} IN ('confirmed','failed','expired','ignored','duplicate','recovery') AND ${t.reason} IN ('verified_collection','provider_rejected','provider_expired','pending_notification','out_of_order','duplicate_callback','late_payment','amount_mismatch','conflicting_allocation')`),
 check('payment_event_result_money_check',sql`(${t.outcome} IN ('confirmed','duplicate','recovery') AND ${t.transactionId} IS NOT NULL) OR (${t.outcome} IN ('failed','expired','ignored') AND ${t.transactionId} IS NULL AND ${t.receiptId} IS NULL)`),
]);

export const visitorSession = appSchema.table('visitor_session',{
 id:uuid('id').primaryKey().defaultRandom(),digest:text('digest').notNull().unique(),principalScope:text('principal_scope').notNull(),status:text('status').notNull(),activationKey:text('activation_key'),activationHash:text('activation_hash'),consentRevision:integer('consent_revision').notNull().default(0),currentConsentId:uuid('current_consent_id').references(():AnyPgColumn=>consentReceipt.id,{onDelete:'restrict'}),createdAt:instant('created_at').notNull(),expiresAt:instant('expires_at').notNull(),activatedAt:instant('activated_at'),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[index('visitor_session_expires_idx').on(t.expiresAt),uniqueIndex('visitor_authenticated_activation_unique').on(t.principalScope,t.activationKey).where(sql`${t.principalScope}<>'browser' AND ${t.activationKey} IS NOT NULL`),
 check('visitor_identity_check',sql`${t.digest} ~ '^[0-9a-f]{64}$' AND char_length(${t.principalScope}) between 1 and 500 AND (${t.principalScope}='browser' OR ${t.principalScope} LIKE 'user:%')`),
 check('visitor_state_check',sql`${t.status} IN ('preparing','active','revoked') AND ${t.expiresAt}>${t.createdAt} AND ${t.consentRevision}>=0 AND ((${t.consentRevision}=0)=(${t.currentConsentId} IS NULL)) AND ((${t.status}='preparing' AND ${t.activatedAt} IS NULL AND ${t.activationKey} IS NULL AND ${t.activationHash} IS NULL) OR (${t.status}<>'preparing' AND ${t.activatedAt} IS NOT NULL AND ${t.activationKey} IS NOT NULL AND ${t.activationHash} IS NOT NULL AND ${t.activationKey} ~ '^[A-Za-z0-9_-]{16,200}$' AND ${t.activationHash} ~ '^[0-9a-f]{64}$'))`),
]);
export const consentReceipt = appSchema.table('consent_receipt',{
 id:uuid('id').primaryKey().defaultRandom(),visitorId:uuid('visitor_id').notNull().references(()=>visitorSession.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),key:text('key').notNull(),requestHash:text('request_hash').notNull(),policyVersion:text('policy_version').notNull(),choices:jsonb('choices').notNull(),effectiveAt:instant('effective_at').notNull(),expiresAt:instant('expires_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('consent_revision_unique').on(t.visitorId,t.revision),unique('consent_request_unique').on(t.visitorId,t.key),check('consent_value_check',sql`${t.revision}>0 AND ${t.key} ~ '^[A-Za-z0-9_-]{16,200}$' AND ${t.requestHash} ~ '^[0-9a-f]{64}$' AND char_length(${t.policyVersion}) between 1 and 100 AND jsonb_typeof(${t.choices})='object' AND ${t.expiresAt}>${t.effectiveAt}`)]);
export const visitorBootstrapRequest = appSchema.table('visitor_bootstrap_request',{
 visitorId:uuid('visitor_id').notNull().references(()=>visitorSession.id,{onDelete:'restrict'}),key:text('key').notNull(),requestHash:text('request_hash').notNull(),principalScope:text('principal_scope').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[primaryKey({columns:[t.visitorId,t.key]}),uniqueIndex('visitor_bootstrap_authenticated_key_unique').on(t.principalScope,t.key).where(sql`${t.principalScope}<>'browser'`),check('visitor_bootstrap_request_value_check',sql`${t.key} ~ '^[A-Za-z0-9_-]{16,200}$' AND ${t.requestHash} ~ '^[0-9a-f]{64}$' AND char_length(${t.principalScope}) between 1 and 500`)]);
export const orderAdAttribution = appSchema.table('order_ad_attribution',{
 orderId:uuid('order_id').primaryKey().references(()=>commerceOrder.id,{onDelete:'restrict'}),visitorId:uuid('visitor_id').notNull().references(()=>visitorSession.id,{onDelete:'restrict'}),consentReceiptId:uuid('consent_receipt_id').references(()=>consentReceipt.id,{onDelete:'restrict'}),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[index('order_ad_attribution_visitor_idx').on(t.visitorId)]);
export const commerceEvent = appSchema.table('commerce_event',{
 id:uuid('id').primaryKey().defaultRandom(),name:text('name').notNull(),schemaVersion:integer('schema_version').notNull().default(1),sourceKind:text('source_kind').notNull(),sourceReference:text('source_reference').notNull(),requestHash:text('request_hash').notNull(),visitorId:uuid('visitor_id').references(()=>visitorSession.id,{onDelete:'restrict'}),consentReceiptId:uuid('consent_receipt_id').references(()=>consentReceipt.id,{onDelete:'restrict'}),orderId:uuid('order_id').references(()=>commerceOrder.id,{onDelete:'restrict'}),receiptId:uuid('receipt_id').unique().references(()=>economicReceipt.id,{onDelete:'restrict'}),merchandiseAmount:bigint('merchandise_amount',{mode:'number'}).notNull().default(0),payload:jsonb('payload').notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[index('commerce_event_visitor_idx').on(t.visitorId),unique('commerce_event_source_unique').on(t.sourceKind,t.sourceReference),index('commerce_event_order_idx').on(t.orderId,t.occurredAt,t.id),check('commerce_event_value_check',sql`${t.schemaVersion}=1 AND ${t.sourceKind} IN ('economic_receipt','commerce_operation','browser') AND char_length(${t.sourceReference}) between 1 and 500 AND ${t.requestHash} ~ '^[0-9a-f]{64}$' AND ${t.merchandiseAmount} between 0 and 9007199254740991 AND jsonb_typeof(${t.payload})='object' AND ((${t.name}='Purchase' AND ${t.sourceKind}='economic_receipt' AND ${t.receiptId} IS NOT NULL AND ${t.orderId} IS NOT NULL AND ${t.merchandiseAmount}>0) OR (${t.name} IN ('product_viewed','offer_selected','cart_changed','checkout_started','contact_validated','address_validated','shipping_selected','payment_method_selected','order_placed','receipt_viewed') AND ${t.sourceKind}<>'economic_receipt' AND ${t.receiptId} IS NULL))`)]);
export const purchaseAllocation = appSchema.table('purchase_allocation',{
 eventId:uuid('event_id').notNull().references(()=>commerceEvent.id,{onDelete:'restrict'}),orderItemId:uuid('order_item_id').notNull().references(()=>orderItem.id,{onDelete:'restrict'}),quantity:integer('quantity').notNull(),merchandiseAmount:bigint('merchandise_amount',{mode:'number'}).notNull(),
},t=>[primaryKey({columns:[t.eventId,t.orderItemId]}),check('purchase_allocation_value_check',sql`${t.quantity}>0 AND ${t.merchandiseAmount} between 1 and 9007199254740991 AND ${t.merchandiseAmount}=99000::bigint*${t.quantity}`)]);
export const adEventOutbox = appSchema.table('ad_event_outbox',{
 id:uuid('id').primaryKey().defaultRandom(),eventId:uuid('event_id').notNull().references(()=>commerceEvent.id,{onDelete:'restrict'}),platform:text('platform').notNull(),destinationVersion:text('destination_version').notNull().default('local-sink-v1'),status:text('status').notNull(),reason:text('reason').notNull(),jobId:uuid('job_id').unique().references(()=>outboxJob.id,{onDelete:'restrict'}),expiresAt:instant('expires_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('ad_event_delivery_unique').on(t.eventId,t.platform,t.destinationVersion),index('ad_event_status_idx').on(t.status,t.recordedAt,t.id),check('ad_event_outbox_value_check',sql`${t.platform} IN ('meta','google','tiktok') AND ${t.destinationVersion}='local-sink-v1' AND ${t.status} IN ('queued','suppressed','accepted','cancelled','quarantined') AND ${t.reason} IN ('eligible','no_consent','expired','withdrawn','unavailable_context','source_not_eligible','accepted_local','definitive_no_effect') AND (${t.status}<>'queued' OR ${t.jobId} IS NOT NULL)`)]);
export const adDeliveryAttempt = appSchema.table('ad_delivery_attempt',{
 id:uuid('id').primaryKey().defaultRandom(),outboxId:uuid('outbox_id').notNull().references(()=>adEventOutbox.id,{onDelete:'restrict'}),kind:text('kind').notNull(),outcome:text('outcome').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('ad_delivery_attempt_value_check',sql`${t.kind} IN ('dispatch','reconcile') AND ${t.outcome} IN ('accepted','suppressed','definitive_no_effect')`)]);
export const localAdSink = appSchema.table('local_ad_sink',{
 outboxId:uuid('outbox_id').primaryKey().references(()=>adEventOutbox.id,{onDelete:'restrict'}),eventId:uuid('event_id').notNull().references(()=>commerceEvent.id,{onDelete:'restrict'}),platform:text('platform').notNull(),payloadHash:text('payload_hash').notNull(),payload:jsonb('payload').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('local_ad_sink_event_unique').on(t.eventId,t.platform),check('local_ad_sink_value_check',sql`${t.platform} IN ('meta','google','tiktok') AND ${t.payloadHash} ~ '^[0-9a-f]{64}$' AND jsonb_typeof(${t.payload})='object'`)]);
export const funnelIntake = appSchema.table('funnel_intake',{
 id:uuid('id').primaryKey().defaultRandom(),visitorId:uuid('visitor_id').notNull().references(()=>visitorSession.id,{onDelete:'restrict'}),clientEventId:text('client_event_id').notNull(),requestHash:text('request_hash').notNull(),consentReceiptId:uuid('consent_receipt_id').notNull().references(()=>consentReceipt.id,{onDelete:'restrict'}),eventId:uuid('event_id').unique().references(()=>commerceEvent.id,{onDelete:'restrict'}),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('funnel_intake_request_unique').on(t.visitorId,t.clientEventId),check('funnel_intake_value_check',sql`${t.clientEventId} ~ '^[A-Za-z0-9_-]{16,100}$' AND ${t.requestHash} ~ '^[0-9a-f]{64}$'`)]);

export const codConfirmation = appSchema.table('cod_confirmation',{
 id:uuid('id').primaryKey().defaultRandom(),orderId:uuid('order_id').notNull().unique().references(()=>commerceOrder.id,{onDelete:'restrict'}),operationId:uuid('operation_id').notNull().unique().references(()=>commerceOperation.id,{onDelete:'restrict'}),acceptedAt:instant('accepted_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
});
export const localCodOperation = appSchema.table('local_cod_operation',{
 id:uuid('id').primaryKey().defaultRandom(),shipmentId:uuid('shipment_id').notNull().references(()=>orderShipment.id,{onDelete:'restrict'}),reference:text('reference').notNull(),environment:text('environment').notNull(),status:text('status').notNull(),unitIds:jsonb('unit_ids'),requestedAmount:bigint('requested_amount',{mode:'number'}).notNull(),amount:bigint('amount',{mode:'number'}).notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('local_cod_operation_reference_unique').on(t.shipmentId,t.reference),check('local_cod_operation_value_check',sql`${t.environment} IN ('local','test','production') AND ${t.reference} ~ '^[A-Za-z0-9_.:-]{1,200}$' AND ${t.requestedAmount} between 0 and 9007199254740991 AND ((${t.status}='collected' AND ${t.amount} between 1 and 9007199254740991) OR (${t.status}='refused' AND ${t.amount}=0))`),check('local_cod_operation_units_check',sql`${t.unitIds} IS NULL OR (jsonb_typeof(${t.unitIds})='array' AND jsonb_array_length(${t.unitIds})<=100)`)]);
export const localCodEvent = appSchema.table('local_cod_event',{
 id:uuid('id').primaryKey().defaultRandom(),operationId:uuid('operation_id').notNull().references(()=>localCodOperation.id,{onDelete:'restrict'}),status:text('status').notNull(),amount:bigint('amount',{mode:'number'}).notNull(),occurredAt:instant('occurred_at').notNull(),signature:text('signature').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[index('local_cod_event_operation_idx').on(t.operationId,t.recordedAt,t.id),check('local_cod_event_value_check',sql`${t.signature} ~ '^[0-9a-f]{64}$' AND ((${t.status}='collected' AND ${t.amount} between 1 and 9007199254740991) OR (${t.status}='refused' AND ${t.amount}=0))`)]);
export const codProviderEvent = appSchema.table('cod_provider_event',{
 id:uuid('id').primaryKey().references(()=>localCodEvent.id,{onDelete:'restrict'}),shipmentId:uuid('shipment_id').notNull().references(()=>orderShipment.id,{onDelete:'restrict'}),payloadHash:text('payload_hash').notNull(),callbackJobId:uuid('callback_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('cod_provider_event_hash_check',sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`)]);
export const codEventResult = appSchema.table('cod_event_result',{
 eventId:uuid('event_id').primaryKey().references(()=>codProviderEvent.id,{onDelete:'restrict'}),outcome:text('outcome').notNull(),reason:text('reason').notNull(),receiptId:uuid('receipt_id').references(()=>economicReceipt.id,{onDelete:'restrict'}),transactionId:uuid('transaction_id').references(()=>financeTransaction.id,{onDelete:'restrict'}),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[uniqueIndex('cod_collected_receipt_unique').on(t.receiptId).where(sql`${t.outcome}='collected'`),check('cod_event_result_value_check',sql`${t.outcome} IN ('collected','refused','duplicate','recovery') AND ${t.reason} IN ('verified_collection','recipient_refused','duplicate_callback','amount_mismatch','conflicting_allocation','late_collection') AND ((${t.outcome}='collected' AND ${t.receiptId} IS NOT NULL AND ${t.transactionId} IS NOT NULL) OR (${t.outcome}='refused' AND ${t.receiptId} IS NULL AND ${t.transactionId} IS NULL) OR (${t.outcome}='recovery' AND ${t.transactionId} IS NOT NULL) OR (${t.outcome}='duplicate' AND (${t.receiptId} IS NULL OR ${t.transactionId} IS NOT NULL)))`)]);

export const fulfillment = appSchema.table('fulfillment',{
 id:uuid('id').primaryKey().defaultRandom(),shipmentId:uuid('shipment_id').notNull().unique().references(()=>orderShipment.id,{onDelete:'restrict'}),revision:integer('revision').notNull().default(0),status:text('status').notNull().default('preparing'),deadlineId:uuid('deadline_id'),bookingId:uuid('booking_id'),calendarError:text('calendar_error'),preparedAt:instant('prepared_at'),waybillIssuedAt:instant('waybill_issued_at'),trackingNumber:text('tracking_number'),handoverAt:instant('handover_at'),handoverReference:text('handover_reference'),createdAt:instant('created_at').notNull(),
},t=>[index('fulfillment_tracking_number_idx').on(t.trackingNumber).where(sql`${t.trackingNumber} IS NOT NULL`),check('fulfillment_state_check',sql`${t.revision}>=0 AND ${t.status} IN ('preparing','ready','picking','packed','handover_pending','handed_over','exception') AND (${t.trackingNumber} IS NULL OR ${t.trackingNumber} ~ '^[A-Z0-9][A-Z0-9-]{7,39}$') AND (${t.handoverReference} IS NULL OR char_length(${t.handoverReference}) between 1 and 200)`)]);
export const fulfillmentDeadline = appSchema.table('fulfillment_deadline',{
 id:uuid('id').primaryKey().defaultRandom(),fulfillmentId:uuid('fulfillment_id').notNull().references(()=>fulfillment.id,{onDelete:'restrict'}),sourceId:uuid('source_id').notNull().unique(),calendarVersionId:uuid('calendar_version_id').notNull().references(()=>policyVersion.id,{onDelete:'restrict'}),calendar:jsonb('calendar').notNull(),calendarCoverage:jsonb('calendar_coverage').notNull(),handoverCalendarCoverage:jsonb('handover_calendar_coverage'),actionableAt:instant('actionable_at').notNull(),packingDueAt:instant('packing_due_at').notNull(),handoverDueAt:instant('handover_due_at'),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('fulfillment_deadline_value_check',sql`jsonb_typeof(${t.calendar})='object' AND ${t.packingDueAt}>${t.actionableAt} AND (${t.handoverDueAt} IS NULL OR ${t.handoverDueAt}>${t.actionableAt})`)]);
export const fulfillmentEvent = appSchema.table('fulfillment_event',{
 id:uuid('id').primaryKey().defaultRandom(),fulfillmentId:uuid('fulfillment_id').notNull().references(()=>fulfillment.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),status:text('status').notNull(),kind:text('kind').notNull(),sourceKind:text('source_kind').notNull(),sourceId:uuid('source_id').notNull(),actorId:text('actor_id'),publicExplanation:text('public_explanation'),deadlineId:uuid('deadline_id').references(()=>fulfillmentDeadline.id,{onDelete:'restrict'}),reason:text('reason').notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('fulfillment_event_revision_unique').on(t.fulfillmentId,t.revision),
 // Hand-written in 0019, declared here (S104) so the snapshot carries it.
 uniqueIndex('fulfillment_causal_source_unique').on(t.sourceKind,t.sourceId).where(sql`${t.sourceKind} IN ('operation','provider')`),
 check('fulfillment_event_value_check',sql`${t.revision}>0 AND ${t.status} IN ('ready','picking','packed','handover_pending','handed_over','exception') AND ${t.kind} IN ('initialize','prepare','booking','issued','reissued','booking_cancelled','packed','handover','exception','reschedule','manual_issued','tracking_corrected') AND ${t.sourceKind} IN ('activation','operation','provider','cancellation') AND char_length(${t.reason}) between 1 and 500 AND ((${t.kind}='reschedule' AND ${t.publicExplanation} IS NOT NULL AND char_length(${t.publicExplanation}) between 1 and 200) OR (${t.kind}<>'reschedule' AND ${t.publicExplanation} IS NULL))`)]);
export const shipmentBooking = appSchema.table('shipment_booking',{
 id:uuid('id').primaryKey().defaultRandom(),fulfillmentId:uuid('fulfillment_id').notNull().references(()=>fulfillment.id,{onDelete:'restrict'}),creationJobId:uuid('creation_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),operationId:uuid('operation_id').notNull().unique(),providerOperationId:uuid('provider_operation_id'),status:text('status').notNull().default('queued'),createdAt:instant('created_at').notNull(),
},t=>[
 // Hand-written in 0019 as DEFERRABLE INITIALLY DEFERRED; Drizzle cannot express deferrability, so the
 // snapshot carries the FK and 0036 does not re-add it (S104). Do not recreate it from this declaration.
 foreignKey({columns:[t.operationId],foreignColumns:[accessOperation.id],name:'shipment_booking_operation_fk'}).onDelete('restrict'),
 uniqueIndex('shipment_booking_active_unique').on(t.fulfillmentId).where(sql`${t.status} NOT IN ('failed','cancelled')`),check('shipment_booking_state_check',sql`${t.status} IN ('queued','acknowledged','issued','failed','cancelled')`)]);
export const localWaybillOperation = appSchema.table('local_waybill_operation',{
 id:uuid('id').primaryKey().defaultRandom(),bookingId:uuid('booking_id').notNull().unique().references(()=>shipmentBooking.id,{onDelete:'restrict'}),environment:text('environment').notNull(),requestBasis:jsonb('request_basis'),requestHash:text('request_hash').notNull(),status:text('status').notNull().default('acknowledged'),trackingNumber:text('tracking_number').unique(),createdAt:instant('created_at').notNull(),terminalAt:instant('terminal_at'),
},t=>[check('local_waybill_operation_basis_check',sql`${t.requestBasis} IS NULL OR (jsonb_typeof(${t.requestBasis})='object' AND ${t.requestBasis} ?& ARRAY['unit_ids','cod_due'] AND (${t.requestBasis}-ARRAY['unit_ids','cod_due'])='{}'::jsonb AND jsonb_typeof(${t.requestBasis}->'unit_ids')='array' AND jsonb_array_length(${t.requestBasis}->'unit_ids') between 1 and 100 AND jsonb_typeof(${t.requestBasis}->'cod_due')='number' AND (${t.requestBasis}->>'cod_due') ~ '^(0|[1-9][0-9]*)$' AND (${t.requestBasis}->>'cod_due')::numeric between 0 and 9007199254740991)`),check('local_waybill_operation_value_check',sql`${t.environment} IN ('local','test') AND ${t.requestHash} ~ '^[a-f0-9]{64}$' AND ((${t.status}='acknowledged' AND ${t.trackingNumber} IS NULL AND ${t.terminalAt} IS NULL) OR (${t.status}='issued' AND ${t.trackingNumber} ~ '^LOCAL-[A-F0-9]{32}$' AND ${t.terminalAt}>=${t.createdAt}) OR (${t.status}='failed' AND ${t.trackingNumber} IS NULL AND ${t.terminalAt}>=${t.createdAt}))`)]);
export const localWaybillEvent = appSchema.table('local_waybill_event',{
 id:uuid('id').primaryKey().defaultRandom(),operationId:uuid('operation_id').notNull().references(()=>localWaybillOperation.id,{onDelete:'restrict'}),status:text('status').notNull(),trackingNumber:text('tracking_number'),occurredAt:instant('occurred_at').notNull(),signature:text('signature').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('local_waybill_event_value_check',sql`${t.status} IN ('acknowledged','issued','failed') AND ${t.signature} ~ '^[a-f0-9]{64}$' AND ((${t.status}='issued' AND ${t.trackingNumber} ~ '^LOCAL-[A-F0-9]{32}$') OR (${t.status}<>'issued' AND ${t.trackingNumber} IS NULL))`)]);
export const waybillProviderEvent = appSchema.table('waybill_provider_event',{
 id:uuid('id').primaryKey().references(()=>localWaybillEvent.id,{onDelete:'restrict'}),bookingId:uuid('booking_id').notNull().references(()=>shipmentBooking.id,{onDelete:'restrict'}),payloadHash:text('payload_hash').notNull(),callbackJobId:uuid('callback_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('waybill_provider_hash_check',sql`${t.payloadHash} ~ '^[a-f0-9]{64}$'`)]);
export const waybillEventResult = appSchema.table('waybill_event_result',{
 eventId:uuid('event_id').primaryKey().references(()=>waybillProviderEvent.id,{onDelete:'restrict'}),outcome:text('outcome').notNull(),fulfillmentEventId:uuid('fulfillment_event_id').references(()=>fulfillmentEvent.id,{onDelete:'restrict'}),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('waybill_result_value_check',sql`${t.outcome} IN ('acknowledged','issued','failed','duplicate','ignored')`)]);
export const fulfillmentNotice = appSchema.table('fulfillment_notice',{
 id:uuid('id').primaryKey().defaultRandom(),fulfillmentId:uuid('fulfillment_id').notNull().references(()=>fulfillment.id,{onDelete:'restrict'}),sourceId:uuid('source_id').notNull(),kind:text('kind').notNull(),jobId:uuid('job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),message:text('message').notNull(),occurredAt:instant('occurred_at').notNull(),availableAt:instant('available_at'),
},t=>[unique('fulfillment_notice_identity_unique').on(t.fulfillmentId,t.sourceId,t.kind),check('fulfillment_notice_value_check',sql`${t.kind} IN ('calendar_missing','packing_overdue','handover_overdue','booking_failed','rescheduled') AND char_length(${t.message}) between 1 and 500`)]);

// Owned local settlement protocol. These are source observations, not payment
// collection, delivery, revenue or a real provider's message format.
export const localSettlementOperation = appSchema.table('local_settlement_operation',{
 id:uuid('id').primaryKey().defaultRandom(),provider:text('provider').notNull(),environment:text('environment').notNull(),reference:text('reference').notNull(),direction:text('direction').notNull(),netAmount:bigint('net_amount',{mode:'number'}).notNull(),clockNamespace:text('clock_namespace').references(()=>fixtureNamespace.name,{onDelete:'restrict'}),occurredAt:instant('occurred_at').notNull(),requestHash:text('request_hash').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('local_settlement_identity_unique').on(t.provider,t.environment,t.reference),check('local_settlement_operation_value_check',sql`${t.provider} IN ('local.payment','local.cod') AND ${t.environment} IN ('local','test','production') AND ${t.reference} ~ '^[A-Za-z0-9_.:-]{1,200}$' AND ${t.direction} IN ('credit','debit') AND ${t.netAmount} between 0 and 9007199254740991 AND ${t.requestHash} ~ '^[0-9a-f]{64}$'`)]);
export const localSettlementStatement = appSchema.table('local_settlement_statement',{
 id:uuid('id').primaryKey().defaultRandom(),operationId:uuid('operation_id').notNull().references(()=>localSettlementOperation.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),grossAmount:bigint('gross_amount',{mode:'number'}),carrierFee:bigint('carrier_fee',{mode:'number'}),providerFee:bigint('provider_fee',{mode:'number'}),allocationClaims:jsonb('allocation_claims'),reversesReference:text('reverses_reference'),sourceReportedAt:instant('source_reported_at').notNull(),requestHash:text('request_hash').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('local_settlement_statement_revision_unique').on(t.operationId,t.revision),check('local_settlement_statement_value_check',sql`${t.revision}>0 AND (${t.grossAmount} IS NULL OR ${t.grossAmount} between 1 and 9007199254740991) AND (${t.carrierFee} IS NULL OR ${t.carrierFee} between 0 and 9007199254740991) AND (${t.providerFee} IS NULL OR ${t.providerFee} between 0 and 9007199254740991) AND (${t.allocationClaims} IS NULL OR (jsonb_typeof(${t.allocationClaims})='array' AND jsonb_array_length(${t.allocationClaims})<=100)) AND (${t.reversesReference} IS NULL OR ${t.reversesReference} ~ '^[A-Za-z0-9_.:-]{1,200}$') AND ${t.requestHash} ~ '^[0-9a-f]{64}$'`)]);
export const localSettlementEvent = appSchema.table('local_settlement_event',{
 id:uuid('id').primaryKey().defaultRandom(),statementId:uuid('statement_id').notNull().references(()=>localSettlementStatement.id,{onDelete:'restrict'}),signature:text('signature').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[index('local_settlement_event_statement_idx').on(t.statementId,t.recordedAt,t.id),check('local_settlement_event_signature_check',sql`${t.signature} ~ '^[0-9a-f]{64}$'`)]);
export const settlementProviderEvent = appSchema.table('settlement_provider_event',{
 id:uuid('id').primaryKey().references(()=>localSettlementEvent.id,{onDelete:'restrict'}),operationId:uuid('operation_id').notNull().references(()=>localSettlementOperation.id,{onDelete:'restrict'}),payloadHash:text('payload_hash').notNull(),callbackJobId:uuid('callback_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('settlement_provider_event_hash_check',sql`${t.payloadHash} ~ '^[0-9a-f]{64}$'`)]);
export const providerSettlement = appSchema.table('provider_settlement',{
 id:uuid('id').primaryKey().defaultRandom(),operationId:uuid('operation_id').notNull().unique().references(()=>localSettlementOperation.id,{onDelete:'restrict'}),cashTransactionId:uuid('cash_transaction_id').unique().references(()=>financeTransaction.id,{onDelete:'restrict'}),feeTransactionId:uuid('fee_transaction_id').unique().references(()=>financeTransaction.id,{onDelete:'restrict'}),appliedFeeStatementId:uuid('applied_fee_statement_id').references(()=>localSettlementStatement.id,{onDelete:'restrict'}),currentStatementId:uuid('current_statement_id').notNull().references(()=>localSettlementStatement.id,{onDelete:'restrict'}),currentMatchId:uuid('current_match_id').unique().references(():AnyPgColumn=>settlementMatch.id,{onDelete:'restrict'}),lastMatchId:uuid('last_match_id').references(():AnyPgColumn=>settlementMatch.id,{onDelete:'restrict'}),revision:integer('revision').notNull().default(0),status:text('status').notNull().default('preparing'),problemCode:text('problem_code'),createdAt:instant('created_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[index('provider_settlement_queue_idx').on(t.status,t.createdAt,t.id),check('provider_settlement_state_check',sql`${t.revision}>=0 AND ${t.status} IN ('preparing','pending','partial','matched','mismatched','exception') AND ((${t.status}='preparing')=(${t.revision}=0)) AND (${t.problemCode} IS NULL OR ${t.problemCode} ~ '^[A-Z][A-Z0-9_]{0,99}$') AND (${t.currentMatchId} IS NULL OR ${t.lastMatchId}=${t.currentMatchId}) AND (${t.feeTransactionId} IS NULL OR ${t.appliedFeeStatementId} IS NOT NULL)`)]);
export const settlementMatch = appSchema.table('settlement_match',{
 id:uuid('id').primaryKey().defaultRandom(),settlementId:uuid('settlement_id').notNull().references(()=>providerSettlement.id,{onDelete:'restrict'}),statementId:uuid('statement_id').notNull().references(()=>localSettlementStatement.id,{onDelete:'restrict'}),transactionId:uuid('transaction_id').notNull().unique().references(()=>financeTransaction.id,{onDelete:'restrict'}),sourceKind:text('source_kind').notNull(),sourceId:uuid('source_id').notNull(),actorId:text('actor_id'),correctionOf:uuid('correction_of').unique().references(():AnyPgColumn=>settlementMatch.id,{onDelete:'restrict'}),reversalTransactionId:uuid('reversal_transaction_id').unique().references(()=>financeTransaction.id,{onDelete:'restrict'}),reversedByOperationId:uuid('reversed_by_operation_id').references(()=>accessOperation.id,{onDelete:'restrict'}),reason:text('reason').notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[uniqueIndex('settlement_match_active_unique').on(t.settlementId).where(sql`${t.reversalTransactionId} IS NULL`),check('settlement_match_value_check',sql`${t.sourceKind} IN ('provider','operation') AND ((${t.sourceKind}='operation')=(${t.actorId} IS NOT NULL)) AND ${t.correctionOf} IS DISTINCT FROM ${t.id} AND ((${t.reversalTransactionId} IS NULL)=(${t.reversedByOperationId} IS NULL)) AND char_length(${t.reason}) between 1 and 500`)]);
export const settlementAllocation = appSchema.table('settlement_allocation',{
 id:uuid('id').primaryKey().defaultRandom(),matchId:uuid('match_id').notNull().references(()=>settlementMatch.id,{onDelete:'restrict'}),ordinal:integer('ordinal').notNull(),receivableTransactionId:uuid('receivable_transaction_id').notNull().references(()=>financeTransaction.id,{onDelete:'restrict'}),orderId:uuid('order_id').notNull().references(()=>commerceOrder.id,{onDelete:'restrict'}),receiptId:uuid('receipt_id').references(()=>economicReceipt.id,{onDelete:'restrict'}),sourceBasis:text('source_basis').notNull(),grossAmount:bigint('gross_amount',{mode:'number'}).notNull(),netAmount:bigint('net_amount',{mode:'number'}).notNull(),carrierFee:bigint('carrier_fee',{mode:'number'}).notNull(),providerFee:bigint('provider_fee',{mode:'number'}).notNull(),reopensAllocationId:uuid('reopens_allocation_id').references(():AnyPgColumn=>settlementAllocation.id,{onDelete:'restrict'}),
},t=>[unique('settlement_allocation_ordinal_unique').on(t.matchId,t.ordinal),unique('settlement_allocation_basis_unique').on(t.matchId,t.receivableTransactionId,t.reopensAllocationId).nullsNotDistinct(),index('settlement_allocation_receivable_idx').on(t.receivableTransactionId,t.matchId),index('settlement_allocation_reopening_idx').on(t.reopensAllocationId),check('settlement_allocation_value_check',sql`${t.ordinal} between 1 and 100 AND ${t.sourceBasis} IN ('qualified','recovery') AND ((${t.sourceBasis}='qualified')=(${t.receiptId} IS NOT NULL)) AND ${t.grossAmount} between 1 and 9007199254740991 AND ${t.netAmount} between 0 and 9007199254740991 AND ${t.carrierFee} between 0 and 9007199254740991 AND ${t.providerFee} between 0 and 9007199254740991 AND ${t.grossAmount}::numeric=${t.netAmount}::numeric+${t.carrierFee}::numeric+${t.providerFee}::numeric AND ${t.reopensAllocationId} IS DISTINCT FROM ${t.id}`)]);
export const settlementEvent = appSchema.table('settlement_event',{
 id:uuid('id').primaryKey().defaultRandom(),settlementId:uuid('settlement_id').notNull().references(()=>providerSettlement.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),status:text('status').notNull(),kind:text('kind').notNull(),sourceKind:text('source_kind').notNull(),sourceId:uuid('source_id').notNull(),actorId:text('actor_id'),statementId:uuid('statement_id').notNull().references(()=>localSettlementStatement.id,{onDelete:'restrict'}),matchId:uuid('match_id').references(()=>settlementMatch.id,{onDelete:'restrict'}),feeTransactionId:uuid('fee_transaction_id').references(()=>financeTransaction.id,{onDelete:'restrict'}),appliedFeeStatementId:uuid('applied_fee_statement_id').references(()=>localSettlementStatement.id,{onDelete:'restrict'}),problemCode:text('problem_code'),reason:text('reason').notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('settlement_event_revision_unique').on(t.settlementId,t.revision),unique('settlement_event_source_unique').on(t.sourceKind,t.sourceId,t.kind),check('settlement_event_value_check',sql`${t.revision}>0 AND ${t.status} IN ('pending','partial','matched','mismatched','exception') AND ${t.kind} IN ('observe','statement','match','unmatch','escalate') AND ${t.sourceKind} IN ('provider','operation') AND ((${t.sourceKind}='operation')=(${t.actorId} IS NOT NULL)) AND char_length(${t.reason}) between 1 and 500 AND (${t.problemCode} IS NULL OR ${t.problemCode} ~ '^[A-Z][A-Z0-9_]{0,99}$') AND (${t.feeTransactionId} IS NULL OR ${t.appliedFeeStatementId} IS NOT NULL)`)]);
export const settlementEventResult = appSchema.table('settlement_event_result',{
 eventId:uuid('event_id').primaryKey().references(()=>settlementProviderEvent.id,{onDelete:'restrict'}),settlementId:uuid('settlement_id').notNull().references(()=>providerSettlement.id,{onDelete:'restrict'}),headRevision:integer('head_revision').notNull(),outcome:text('outcome').notNull(),settlementEventId:uuid('settlement_event_id').references(()=>settlementEvent.id,{onDelete:'restrict'}),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('settlement_event_result_value_check',sql`${t.headRevision}>0 AND ${t.outcome} IN ('observed','matched','partial','unmatched','exception','older','duplicate') AND ((${t.outcome} IN ('older','duplicate'))=(${t.settlementEventId} IS NULL))`)]);

// S31 intended model. These structures do not exist in either database until
// independently reviewed additive0021 is explicitly applied.
export const localParcelReceipt = appSchema.table('local_parcel_receipt',{
 id:uuid('id').primaryKey().defaultRandom(),reference:text('reference').notNull(),environment:text('environment').notNull(),bookingId:uuid('booking_id').references(()=>shipmentBooking.id,{onDelete:'restrict'}),shipmentId:uuid('shipment_id').notNull().references(()=>orderShipment.id,{onDelete:'restrict'}),clockNamespace:text('clock_namespace'),unitIds:jsonb('unit_ids').notNull(),occurredAt:instant('occurred_at').notNull(),requestHash:text('request_hash').notNull(),signature:text('signature').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('local_parcel_receipt_reference_unique').on(t.environment,t.reference),check('local_parcel_receipt_value_check',sql`${t.environment} IN ('local','test','production') AND ${t.reference} ~ '^[A-Za-z0-9_.:-]{1,200}$' AND ${t.requestHash} ~ '^[a-f0-9]{64}$' AND ${t.signature} ~ '^[a-f0-9]{64}$' AND jsonb_typeof(${t.unitIds})='array' AND jsonb_array_length(${t.unitIds}) between 1 and 100`)]);
export const parcelReceiptProviderEvent = appSchema.table('parcel_receipt_provider_event',{
 id:uuid('id').primaryKey().references(()=>localParcelReceipt.id,{onDelete:'restrict'}),callbackJobId:uuid('callback_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),payloadHash:text('payload_hash').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('parcel_receipt_provider_hash_check',sql`${t.payloadHash} ~ '^[a-f0-9]{64}$'`)]);
export const buyerReceipt = appSchema.table('buyer_receipt',{
 id:uuid('id').primaryKey().defaultRandom(),fulfillmentItemId:uuid('fulfillment_item_id').notNull().unique().references(()=>fulfillmentItem.id,{onDelete:'restrict'}),sourceId:uuid('source_id').notNull().references(()=>parcelReceiptProviderEvent.id,{onDelete:'restrict'}),receivedAt:instant('received_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[index('buyer_receipt_source_idx').on(t.sourceId,t.fulfillmentItemId)]);
export const parcelReceiptResult = appSchema.table('parcel_receipt_result',{
 eventId:uuid('event_id').primaryKey().references(()=>parcelReceiptProviderEvent.id,{onDelete:'restrict'}),outcome:text('outcome').notNull(),reason:text('reason').notNull(),receiptCount:integer('receipt_count').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('parcel_receipt_result_value_check',sql`(${t.outcome}='received' AND ${t.receiptCount} between 1 and 100) OR (${t.outcome} IN ('duplicate','exception') AND ${t.receiptCount}=0)`),check('parcel_receipt_result_reason_check',sql`char_length(${t.reason}) between 1 and 500`)]);

// Retain proof digest/session identity without an auth-proof FK: ordinary
// session revocation deletes ephemeral proofs, not immutable business history.
export const returnOperation = appSchema.table('return_operation',{
 orderId:uuid('order_id').notNull().references(()=>commerceOrder.id,{onDelete:'restrict'}),occurredAt:instant('occurred_at').notNull(),
 id:uuid('id').primaryKey().defaultRandom(),actorScope:text('actor_scope').notNull(),actorId:text('actor_id').references(()=>user.id,{onDelete:'restrict'}),sessionId:text('session_id'),guestId:uuid('guest_id').references(()=>commerceGuest.id,{onDelete:'restrict'}),key:text('key').notNull(),action:text('action').notNull(),subjectId:uuid('subject_id').notNull(),requestHash:text('request_hash').notNull(),proofDigest:text('proof_digest'),response:jsonb('response').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),createdXid:text('created_xid').notNull().default(sql`pg_current_xact_id()::text`),
},t=>[unique('return_operation_key_unique').on(t.actorScope,t.key),index('return_operation_guest_idx').on(t.guestId),unique('return_operation_proof_unique').on(t.proofDigest),check('return_operation_value_check',sql`char_length(${t.key}) between 16 and 200 AND ${t.requestHash} ~ '^[a-f0-9]{64}$' AND jsonb_typeof(${t.response})='object' AND ${t.action} IN ('return.create','return.decide','return.inspect','refund.queue','refund.destination','refund.reconcile','refund.retry') AND ((${t.actorId} IS NOT NULL AND ${t.sessionId} IS NOT NULL AND ${t.guestId} IS NULL AND ${t.actorScope}='user:'||${t.actorId}) OR (${t.actorId} IS NULL AND ${t.sessionId} IS NULL AND ${t.guestId} IS NOT NULL AND ${t.actorScope}='guest:'||${t.guestId}::text))`)]);
export const returnCase = appSchema.table('return_case',{
 id:uuid('id').primaryKey().defaultRandom(),orderId:uuid('order_id').notNull().references(()=>commerceOrder.id,{onDelete:'restrict'}),operationId:uuid('operation_id').notNull().unique().references(()=>returnOperation.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),status:text('status').notNull(),requestedResolution:text('requested_resolution').notNull(),resolution:text('resolution'),requiresGoods:boolean('requires_goods'),createdAt:instant('created_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[index('return_case_order_idx').on(t.orderId,t.recordedAt,t.id),check('return_case_value_check',sql`${t.revision}>0 AND ${t.status} IN ('requested','reviewing','approved','rejected','awaiting_goods','inspecting','refunding','replacing','resolved') AND ${t.requestedResolution} IN ('refund','replacement') AND (${t.resolution} IS NULL OR ${t.resolution} IN ('refund','replacement'))`)]);
export const returnItem = appSchema.table('return_item',{
 id:uuid('id').primaryKey().defaultRandom(),caseId:uuid('case_id').notNull().references(()=>returnCase.id,{onDelete:'restrict'}),fulfillmentItemId:uuid('fulfillment_item_id').notNull().references(()=>fulfillmentItem.id,{onDelete:'restrict'}),buyerReceiptId:uuid('buyer_receipt_id').notNull().references(()=>buyerReceipt.id,{onDelete:'restrict'}),replacementLinkId:uuid('replacement_link_id').references(():AnyPgColumn=>replacementLink.id,{onDelete:'restrict'}),reason:text('reason').notNull(),details:text('details').notNull(),deadlineAt:instant('deadline_at').notNull(),merchandiseAmount:bigint('merchandise_amount',{mode:'number'}).notNull(),buyerShipping:bigint('buyer_shipping',{mode:'number'}).notNull(),paymentCharge:bigint('payment_charge',{mode:'number'}).notNull().default(0),claimState:text('claim_state').notNull().default('held'),inspectionStatus:text('inspection_status').notNull().default('pending'),
},t=>[unique('return_item_case_unit_unique').on(t.caseId,t.fulfillmentItemId),unique('return_item_case_identity_unique').on(t.caseId,t.id),uniqueIndex('return_item_active_unit_unique').on(sql`coalesce(${t.replacementLinkId},${t.fulfillmentItemId})`).where(sql`${t.claimState}<>'released'`),index('return_item_case_idx').on(t.caseId,t.id),check('return_item_value_check',sql`${t.reason} IN ('wrong_item','damaged','defective','not_as_described','incomplete','expired','broken_mandatory_seal') AND char_length(${t.details})<=2000 AND ${t.merchandiseAmount}=99000 AND ${t.buyerShipping} between 0 and 9007199254641991 AND ${t.paymentCharge} between 0 and 9007199254740991 AND ${t.claimState} IN ('held','released','refunded','replacing','replaced') AND ${t.inspectionStatus} IN ('pending','accepted','rejected','needs_review','waived')`)]);
export const returnEvent = appSchema.table('return_event',{
 id:uuid('id').primaryKey().defaultRandom(),caseId:uuid('case_id').notNull().references(()=>returnCase.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),kind:text('kind').notNull(),status:text('status').notNull(),resolution:text('resolution'),requiresGoods:boolean('requires_goods'),sourceKind:text('source_kind').notNull(),sourceId:uuid('source_id').notNull(),actorId:text('actor_id'),reason:text('reason').notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('return_event_revision_unique').on(t.caseId,t.revision),unique('return_event_case_identity_unique').on(t.caseId,t.id),unique('return_event_source_unique').on(t.sourceKind,t.sourceId,t.kind),check('return_event_value_check',sql`${t.revision}>0 AND ${t.kind} IN ('create','decision','inspection','refund_queue','refund_confirmed','refund_failed','replacement_started','replacement_received','replacement_cancelled') AND ${t.status} IN ('requested','reviewing','approved','rejected','awaiting_goods','inspecting','refunding','replacing','resolved') AND ${t.sourceKind} IN ('operation','refund','replacement','recovery') AND (${t.sourceKind} IN ('operation','replacement') OR ${t.actorId} IS NULL) AND char_length(${t.reason}) between 1 and 2000`)]);
export const returnItemEvent = appSchema.table('return_item_event',{
 caseId:uuid('case_id').notNull(),eventId:uuid('event_id').notNull(),returnItemId:uuid('return_item_id').notNull(),claimState:text('claim_state').notNull(),inspectionStatus:text('inspection_status').notNull(),
},t=>[primaryKey({columns:[t.eventId,t.returnItemId]}),foreignKey({columns:[t.caseId,t.eventId],foreignColumns:[returnEvent.caseId,returnEvent.id],name:'return_item_event_case_event_fk'}).onDelete('restrict'),foreignKey({columns:[t.caseId,t.returnItemId],foreignColumns:[returnItem.caseId,returnItem.id],name:'return_item_event_case_item_fk'}).onDelete('restrict'),index('return_item_event_item_idx').on(t.returnItemId,t.eventId),check('return_item_event_state_check',sql`${t.claimState} IN ('held','released','refunded','replacing','replaced') AND ${t.inspectionStatus} IN ('pending','accepted','rejected','needs_review','waived')`)]);
export const returnGoods = appSchema.table('return_goods',{
 id:uuid('id').primaryKey().defaultRandom(),eventId:uuid('event_id').notNull().references(()=>returnEvent.id,{onDelete:'restrict'}),returnItemId:uuid('return_item_id').notNull().references(()=>returnItem.id,{onDelete:'restrict'}),expectedBalanceId:uuid('expected_balance_id').notNull().references(()=>inventoryBalance.id,{onDelete:'restrict'}),quantity:integer('quantity').notNull(),identityConfirmed:boolean('identity_confirmed').notNull(),stockMovementId:uuid('stock_movement_id').unique().references(()=>stockMovement.id,{onDelete:'restrict'}),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('return_goods_event_position_unique').on(t.eventId,t.returnItemId,t.expectedBalanceId),check('return_goods_value_check',sql`${t.quantity} between 1 and 1000000 AND (${t.identityConfirmed}=(${t.stockMovementId} IS NOT NULL))`)]);

export const refund = appSchema.table('refund',{
 id:uuid('id').primaryKey().defaultRandom(),caseId:uuid('case_id').notNull().unique().references(()=>returnCase.id,{onDelete:'restrict'}),orderId:uuid('order_id').notNull().references(()=>commerceOrder.id,{onDelete:'restrict'}),operationId:uuid('operation_id').notNull().unique().references(()=>returnOperation.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),status:text('status').notNull(),amount:bigint('amount',{mode:'number'}).notNull(),obligationTransactionId:uuid('obligation_transaction_id').notNull().unique().references(()=>financeTransaction.id,{onDelete:'restrict'}),cashTransactionId:uuid('cash_transaction_id').unique().references(()=>financeTransaction.id,{onDelete:'restrict'}),currentJobId:uuid('current_job_id').unique().references(()=>outboxJob.id,{onDelete:'restrict'}),currentOperationId:uuid('current_operation_id').references(():AnyPgColumn=>localRefundOperation.id,{onDelete:'restrict'}),destinationSourceId:uuid('destination_source_id').references(():AnyPgColumn=>localRefundDestination.id,{onDelete:'restrict'}),createdAt:instant('created_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[index('refund_order_idx').on(t.orderId,t.recordedAt,t.id),check('refund_value_check',sql`${t.revision}>0 AND ${t.amount} between 1 and 9007199254740991 AND ${t.status} IN ('awaiting_destination','queued','processing','unknown','succeeded','failed') AND ((${t.status}='succeeded')=(${t.cashTransactionId} IS NOT NULL))`)]);
export const refundAllocation = appSchema.table('refund_allocation',{
 refundId:uuid('refund_id').notNull().references(()=>refund.id,{onDelete:'restrict'}),returnItemId:uuid('return_item_id').notNull().unique().references(()=>returnItem.id,{onDelete:'restrict'}),receiptId:uuid('receipt_id').notNull().references(()=>economicReceipt.id,{onDelete:'restrict'}),purchaseEventId:uuid('purchase_event_id').references(()=>commerceEvent.id,{onDelete:'restrict'}),merchandiseAmount:bigint('merchandise_amount',{mode:'number'}).notNull(),buyerShipping:bigint('buyer_shipping',{mode:'number'}).notNull(),amount:bigint('amount',{mode:'number'}).notNull(),paymentCharge:bigint('payment_charge',{mode:'number'}).notNull().default(0),
},t=>[primaryKey({columns:[t.refundId,t.returnItemId]}),index('refund_allocation_receipt_idx').on(t.receiptId,t.refundId),check('refund_allocation_value_check',sql`${t.merchandiseAmount}=99000 AND ${t.buyerShipping}>=0 AND ${t.paymentCharge}>=0 AND ${t.amount} between 99000 and 9007199254740991 AND ${t.amount}::numeric=${t.merchandiseAmount}::numeric+${t.buyerShipping}::numeric+${t.paymentCharge}::numeric`)]);
export const refundEvent = appSchema.table('refund_event',{
 id:uuid('id').primaryKey().defaultRandom(),refundId:uuid('refund_id').notNull().references(()=>refund.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),kind:text('kind').notNull(),status:text('status').notNull(),sourceKind:text('source_kind').notNull(),sourceId:uuid('source_id').notNull(),providerOperationId:uuid('provider_operation_id').references(():AnyPgColumn=>localRefundOperation.id,{onDelete:'restrict'}),jobId:uuid('job_id').references(()=>outboxJob.id,{onDelete:'restrict'}),destinationSourceId:uuid('destination_source_id').references(():AnyPgColumn=>localRefundDestination.id,{onDelete:'restrict'}),cashTransactionId:uuid('cash_transaction_id').references(()=>financeTransaction.id,{onDelete:'restrict'}),reason:text('reason').notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('refund_event_revision_unique').on(t.refundId,t.revision),unique('refund_event_source_unique').on(t.sourceKind,t.sourceId,t.kind),check('refund_event_value_check',sql`${t.revision}>0 AND ${t.kind} IN ('queue','destination','prepare','confirm','fail','reconcile','retry') AND ${t.status} IN ('awaiting_destination','queued','processing','unknown','succeeded','failed') AND ${t.sourceKind} IN ('operation','job','provider') AND char_length(${t.reason}) between 1 and 2000`)]);
export const localRefundDestination = appSchema.table('local_refund_destination',{
 id:uuid('id').primaryKey().defaultRandom(),refundId:uuid('refund_id').notNull().references(()=>refund.id,{onDelete:'restrict'}),environment:text('environment').notNull(),buyerScope:text('buyer_scope').notNull(),destinationReference:text('destination_reference').notNull().unique(),signature:text('signature').notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('local_refund_destination_value_check',sql`${t.environment} IN ('local','test') AND ${t.buyerScope} ~ '^(user|guest):[A-Za-z0-9_-]{1,100}$' AND ${t.destinationReference} ~ '^synthetic:[0-9a-f-]{36}$' AND ${t.signature} ~ '^[a-f0-9]{64}$'`)]);
export const localRefundOperation = appSchema.table('local_refund_operation',{
 id:uuid('id').primaryKey().defaultRandom(),refundId:uuid('refund_id').notNull().references(()=>refund.id,{onDelete:'restrict'}),creationJobId:uuid('creation_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),attempt:integer('attempt').notNull(),environment:text('environment').notNull(),rail:text('rail').notNull(),originalPaymentOperationId:uuid('original_payment_operation_id').references(()=>localPaymentOperation.id,{onDelete:'restrict'}),destinationSourceId:uuid('destination_source_id').references(()=>localRefundDestination.id,{onDelete:'restrict'}),amount:bigint('amount',{mode:'number'}).notNull(),clockNamespace:text('clock_namespace'),requestHash:text('request_hash').notNull(),createdAt:instant('created_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('local_refund_attempt_unique').on(t.refundId,t.attempt),check('local_refund_operation_value_check',sql`${t.attempt}>0 AND ${t.environment} IN ('local','test') AND ${t.amount} between 1 and 9007199254740991 AND ${t.requestHash} ~ '^[a-f0-9]{64}$' AND ((${t.rail}='prepaid_original' AND ${t.originalPaymentOperationId} IS NOT NULL AND ${t.destinationSourceId} IS NULL) OR (${t.rail}='cod_verified_destination' AND ${t.originalPaymentOperationId} IS NULL AND ${t.destinationSourceId} IS NOT NULL))`)]);
export const localRefundEvent = appSchema.table('local_refund_event',{
 id:uuid('id').primaryKey().defaultRandom(),operationId:uuid('operation_id').notNull().unique().references(()=>localRefundOperation.id,{onDelete:'restrict'}),status:text('status').notNull(),amount:bigint('amount',{mode:'number'}).notNull(),bankReference:text('bank_reference').notNull().unique(),occurredAt:instant('occurred_at').notNull(),signature:text('signature').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('local_refund_event_value_check',sql`((${t.status}='succeeded' AND ${t.amount} between 1 and 9007199254740991) OR (${t.status}='failed' AND ${t.amount}=0)) AND ${t.bankReference} ~ '^LOCAL-REFUND-[A-F0-9]{32}$' AND ${t.signature} ~ '^[a-f0-9]{64}$'`)]);
export const refundProviderEvent = appSchema.table('refund_provider_event',{
 id:uuid('id').primaryKey().references(()=>localRefundEvent.id,{onDelete:'restrict'}),refundId:uuid('refund_id').notNull().references(()=>refund.id,{onDelete:'restrict'}),callbackJobId:uuid('callback_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),payloadHash:text('payload_hash').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('refund_provider_event_hash_check',sql`${t.payloadHash} ~ '^[a-f0-9]{64}$'`)]);
export const refundEventResult = appSchema.table('refund_event_result',{
 eventId:uuid('event_id').primaryKey().references(()=>refundProviderEvent.id,{onDelete:'restrict'}),refundId:uuid('refund_id').notNull().references(()=>refund.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),outcome:text('outcome').notNull(),refundEventId:uuid('refund_event_id').notNull().unique().references(()=>refundEvent.id,{onDelete:'restrict'}),cashTransactionId:uuid('cash_transaction_id').unique().references(()=>financeTransaction.id,{onDelete:'restrict'}),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('refund_event_result_value_check',sql`${t.revision}>0 AND ${t.outcome} IN ('confirmed','failed') AND ((${t.outcome}='confirmed')=(${t.cashTransactionId} IS NOT NULL))`)]);
export const refundAdjustmentIntent = appSchema.table('refund_adjustment_intent',{
 id:uuid('id').primaryKey().defaultRandom(),refundId:uuid('refund_id').notNull().references(()=>refund.id,{onDelete:'restrict'}),receiptId:uuid('receipt_id').notNull().references(()=>economicReceipt.id,{onDelete:'restrict'}),purchaseEventId:uuid('purchase_event_id').references(()=>commerceEvent.id,{onDelete:'restrict'}),dispatchReason:text('dispatch_reason').notNull(),sequence:integer('sequence').notNull(),merchandiseRefunded:bigint('merchandise_refunded',{mode:'number'}).notNull(),retainedMerchandise:bigint('retained_merchandise',{mode:'number'}).notNull(),allocation:jsonb('allocation').notNull(),originalOccurredAt:instant('original_occurred_at').notNull(),confirmedAt:instant('confirmed_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('refund_adjustment_receipt_unique').on(t.refundId,t.receiptId),unique('refund_adjustment_sequence_unique').on(t.receiptId,t.sequence),check('refund_adjustment_value_check',sql`((${t.purchaseEventId} IS NULL AND ${t.dispatchReason}='original_purchase_missing') OR (${t.purchaseEventId} IS NOT NULL AND ${t.dispatchReason}='pending_adapter')) AND ${t.sequence}>0 AND ${t.merchandiseRefunded} between 99000 and 9007199254740991 AND ${t.retainedMerchandise} between 0 and 9007199254740991 AND ${t.merchandiseRefunded}%99000=0 AND ${t.retainedMerchandise}%99000=0 AND jsonb_typeof(${t.allocation})='array' AND jsonb_array_length(${t.allocation}) between 1 and 100 AND ${t.confirmedAt}>=${t.originalOccurredAt}`)]);

// S32 models. An account identity alone grants no
// referral/enrollment/payout authority; S35 owns the accepted first-touch path.
export const affiliateAccount = appSchema.table('affiliate_account',{
 id:uuid('id').primaryKey().defaultRandom(),userId:text('user_id').notNull().unique().references(()=>user.id,{onDelete:'restrict'}),status:text('status').notNull().default('active'),rateRevision:integer('rate_revision').notNull().default(0),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('affiliate_account_state_check',sql`${t.status} IN ('active','suspended') AND ${t.rateRevision}>=0`)]);
export const affiliateRateVersion = appSchema.table('affiliate_rate_version',{
 id:uuid('id').primaryKey().defaultRandom(),affiliateId:uuid('affiliate_id').notNull().references(()=>affiliateAccount.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),operationId:uuid('operation_id').notNull().unique(),basisPoints:integer('basis_points').notNull(),effectiveAt:instant('effective_at').notNull(),actorId:text('actor_id').notNull().references(()=>user.id,{onDelete:'restrict'}),sessionId:text('session_id').notNull(),proofDigest:text('proof_digest').notNull().unique(),reason:text('reason').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),createdXid:text('created_xid').notNull().default(sql`pg_current_xact_id()::text`),
},t=>[unique('affiliate_rate_revision_unique').on(t.affiliateId,t.revision),index('affiliate_rate_effective_idx').on(t.affiliateId,t.effectiveAt,t.revision),check('affiliate_rate_value_check',sql`${t.revision}>0 AND ${t.basisPoints} between 0 and 10000 AND ${t.proofDigest} ~ '^[a-f0-9]{64}$' AND char_length(${t.reason}) between 1 and 500`)]);

// Replacement parcels never enter order_shipment: that table is the immutable
// original financial parcel set used by checkout, COD, receipts and Purchase.
export const replacementOperation = appSchema.table('replacement_operation',{
 id:uuid('id').primaryKey().defaultRandom(),caseId:uuid('case_id').notNull().references(()=>returnCase.id,{onDelete:'restrict'}),subjectId:uuid('subject_id').notNull(),actorId:text('actor_id').notNull().references(()=>user.id,{onDelete:'restrict'}),sessionId:text('session_id').notNull(),key:text('key').notNull(),action:text('action').notNull(),requestHash:text('request_hash').notNull(),response:jsonb('response').notNull(),occurredAt:instant('occurred_at').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),createdXid:text('created_xid').notNull().default(sql`pg_current_xact_id()::text`),
},t=>[unique('replacement_operation_key_unique').on(t.actorId,t.key),check('replacement_operation_value_check',sql`char_length(${t.key}) between 16 and 200 AND ${t.action} IN ('create','reserve','prepare','book','handover','reconcile') AND ${t.requestHash} ~ '^[a-f0-9]{64}$' AND jsonb_typeof(${t.response})='object' AND octet_length(${t.response}::text)<=1048576`)]);
export const replacementShipment = appSchema.table('replacement_shipment',{
 id:uuid('id').primaryKey().defaultRandom(),caseId:uuid('case_id').notNull().references(()=>returnCase.id,{onDelete:'restrict'}),operationId:uuid('operation_id').notNull().unique().references(()=>replacementOperation.id,{onDelete:'restrict'}),warehouseId:uuid('warehouse_id').notNull().references(()=>warehouse.id,{onDelete:'restrict'}),stockReservationId:uuid('stock_reservation_id').unique().references(()=>stockReservation.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),status:text('status').notNull(),bookingId:uuid('booking_id').references(():AnyPgColumn=>replacementBooking.id,{onDelete:'restrict'}),buyerShipping:bigint('buyer_shipping',{mode:'number'}).notNull().default(0),codDue:bigint('cod_due',{mode:'number'}).notNull().default(0),preparedAt:instant('prepared_at'),waybillIssuedAt:instant('waybill_issued_at'),trackingNumber:text('tracking_number'),handoverAt:instant('handover_at'),handoverReference:text('handover_reference'),packingDueAt:instant('packing_due_at'),calendarSnapshot:jsonb('calendar_snapshot'),createdAt:instant('created_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[index('replacement_shipment_case_idx').on(t.caseId,t.id),index('replacement_shipment_queue_idx').on(t.warehouseId,t.status,t.id),check('replacement_shipment_state_check',sql`${t.revision}>0 AND ${t.status} IN ('awaiting_stock','ready','picking','booking_pending','booking_unknown','booking_failed','packed','handed_over','partially_delivered','delivered','cancelled') AND ${t.buyerShipping}=0 AND ${t.codDue}=0 AND ((${t.packingDueAt} IS NULL)=(${t.calendarSnapshot} IS NULL)) AND (${t.calendarSnapshot} IS NULL OR (jsonb_typeof(${t.calendarSnapshot})='object' AND octet_length(${t.calendarSnapshot}::text)<=65536)) AND (${t.trackingNumber} IS NULL OR ${t.trackingNumber} ~ '^LOCAL-REPLACEMENT-[A-F0-9]{32}$') AND (${t.handoverReference} IS NULL OR char_length(${t.handoverReference}) between 1 and 200)`)]);
export const replacementLink = appSchema.table('replacement_link',{
 id:uuid('id').primaryKey().defaultRandom(),shipmentId:uuid('shipment_id').notNull().references(()=>replacementShipment.id,{onDelete:'restrict'}),returnItemId:uuid('return_item_id').notNull().unique().references(()=>returnItem.id,{onDelete:'restrict'}),originalFulfillmentItemId:uuid('original_fulfillment_item_id').notNull().references(()=>fulfillmentItem.id,{onDelete:'restrict'}),predecessorId:uuid('predecessor_id').references(():AnyPgColumn=>replacementLink.id,{onDelete:'restrict'}),generation:integer('generation').notNull(),createdAt:instant('created_at').notNull(),
},t=>[unique('replacement_link_generation_unique').on(t.originalFulfillmentItemId,t.generation),index('replacement_link_shipment_idx').on(t.shipmentId,t.id),check('replacement_link_value_check',sql`${t.generation}>0 AND (${t.predecessorId} IS NULL OR ${t.predecessorId}<>${t.id}) AND ${t.id}<>${t.originalFulfillmentItemId}`)]);
export const replacementComponent = appSchema.table('replacement_component_allocation',{
 replacementLinkId:uuid('replacement_link_id').notNull().references(()=>replacementLink.id,{onDelete:'restrict'}),balanceId:uuid('balance_id').notNull().references(()=>inventoryBalance.id,{onDelete:'restrict'}),stockItemId:uuid('stock_item_id').notNull().references(()=>stockItem.id,{onDelete:'restrict'}),quantity:integer('quantity').notNull(),
},t=>[primaryKey({columns:[t.replacementLinkId,t.balanceId]}),check('replacement_component_quantity_check',sql`${t.quantity} between 1 and 1000000`)]);
export const replacementEvent = appSchema.table('replacement_event',{
 id:uuid('id').primaryKey().defaultRandom(),shipmentId:uuid('shipment_id').notNull().references(()=>replacementShipment.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),kind:text('kind').notNull(),status:text('status').notNull(),sourceKind:text('source_kind').notNull(),sourceId:uuid('source_id').notNull(),actorId:text('actor_id'),reason:text('reason').notNull(),snapshot:jsonb('snapshot').notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('replacement_event_revision_unique').on(t.shipmentId,t.revision),unique('replacement_event_source_unique').on(t.sourceKind,t.sourceId,t.kind),check('replacement_event_value_check',sql`${t.revision}>0 AND ${t.kind} IN ('create','reserve','stock_wait','prepare','book','unknown','waybill_issued','waybill_failed','handover','receipt','reconcile','cancel') AND ${t.sourceKind} IN ('operation','job','provider','receipt','exception') AND (${t.sourceKind}='operation' OR ${t.actorId} IS NULL) AND char_length(${t.reason}) between 1 and 500 AND jsonb_typeof(${t.snapshot})='object' AND octet_length(${t.snapshot}::text)<=65536`)]);
export const replacementBooking = appSchema.table('replacement_booking',{
 id:uuid('id').primaryKey().defaultRandom(),shipmentId:uuid('shipment_id').notNull().references(()=>replacementShipment.id,{onDelete:'restrict'}),attempt:integer('attempt').notNull(),operationId:uuid('operation_id').notNull().unique().references(()=>replacementOperation.id,{onDelete:'restrict'}),creationJobId:uuid('creation_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),providerOperationId:uuid('provider_operation_id').unique().references(():AnyPgColumn=>localReplacementOperation.id,{onDelete:'restrict'}),status:text('status').notNull(),createdAt:instant('created_at').notNull(),
},t=>[unique('replacement_booking_attempt_unique').on(t.shipmentId,t.attempt),uniqueIndex('replacement_booking_active_unique').on(t.shipmentId).where(sql`${t.status}<>'failed'`),check('replacement_booking_state_check',sql`${t.attempt}>0 AND ${t.status} IN ('queued','processing','unknown','issued','failed')`)]);
export const localReplacementOperation = appSchema.table('local_replacement_operation',{
 id:uuid('id').primaryKey().defaultRandom(),bookingId:uuid('booking_id').notNull().unique().references(()=>replacementBooking.id,{onDelete:'restrict'}),environment:text('environment').notNull(),clockNamespace:text('clock_namespace'),profile:text('profile').notNull(),requestHash:text('request_hash').notNull(),codDue:bigint('cod_due',{mode:'number'}).notNull().default(0),status:text('status').notNull(),trackingNumber:text('tracking_number'),createdAt:instant('created_at').notNull(),terminalAt:instant('terminal_at'),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('local_replacement_operation_value_check',sql`${t.environment} IN ('local','test') AND ${t.profile} IN ('normal','creation_ack_lost','issuance_ack_lost','rejected') AND ${t.codDue}=0 AND ${t.requestHash} ~ '^[a-f0-9]{64}$' AND ((${t.status}='created' AND ${t.trackingNumber} IS NULL AND ${t.terminalAt} IS NULL) OR (${t.status}='issued' AND ${t.trackingNumber} IS NOT NULL AND ${t.trackingNumber} ~ '^LOCAL-REPLACEMENT-[A-F0-9]{32}$' AND ${t.terminalAt} IS NOT NULL) OR (${t.status}='failed' AND ${t.trackingNumber} IS NULL AND ${t.terminalAt} IS NOT NULL))`)]);
export const localReplacementEvent = appSchema.table('local_replacement_event',{
 id:uuid('id').primaryKey().defaultRandom(),operationId:uuid('operation_id').notNull().unique().references(()=>localReplacementOperation.id,{onDelete:'restrict'}),status:text('status').notNull(),trackingNumber:text('tracking_number'),occurredAt:instant('occurred_at').notNull(),signature:text('signature').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('local_replacement_event_value_check',sql`${t.signature} ~ '^[a-f0-9]{64}$' AND ((${t.status}='issued' AND ${t.trackingNumber} IS NOT NULL AND ${t.trackingNumber} ~ '^LOCAL-REPLACEMENT-[A-F0-9]{32}$') OR (${t.status}='failed' AND ${t.trackingNumber} IS NULL))`)]);
export const replacementProviderEvent = appSchema.table('replacement_provider_event',{
 id:uuid('id').primaryKey().references(()=>localReplacementEvent.id,{onDelete:'restrict'}),callbackJobId:uuid('callback_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),payloadHash:text('payload_hash').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('replacement_provider_event_hash_check',sql`${t.payloadHash} ~ '^[a-f0-9]{64}$'`)]);
export const replacementEventResult = appSchema.table('replacement_event_result',{
 eventId:uuid('event_id').primaryKey().references(()=>replacementProviderEvent.id,{onDelete:'restrict'}),shipmentId:uuid('shipment_id').notNull().references(()=>replacementShipment.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),replacementEventId:uuid('replacement_event_id').notNull().unique().references(()=>replacementEvent.id,{onDelete:'restrict'}),outcome:text('outcome').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('replacement_event_result_value_check',sql`${t.revision}>0 AND ${t.outcome} IN ('issued','failed')`)]);
export const localReplacementReceipt = appSchema.table('local_replacement_receipt',{
 id:uuid('id').primaryKey().defaultRandom(),reference:text('reference').notNull(),environment:text('environment').notNull(),shipmentId:uuid('shipment_id').notNull().references(()=>replacementShipment.id,{onDelete:'restrict'}),bookingId:uuid('booking_id').notNull().references(()=>replacementBooking.id,{onDelete:'restrict'}),clockNamespace:text('clock_namespace'),unitIds:jsonb('unit_ids').notNull(),requestHash:text('request_hash').notNull(),signature:text('signature').notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('local_replacement_receipt_reference_unique').on(t.environment,t.reference),check('local_replacement_receipt_value_check',sql`${t.environment} IN ('local','test') AND ${t.reference} ~ '^[A-Za-z0-9_.:-]{1,200}$' AND ${t.requestHash} ~ '^[a-f0-9]{64}$' AND ${t.signature} ~ '^[a-f0-9]{64}$' AND jsonb_typeof(${t.unitIds})='array' AND jsonb_array_length(${t.unitIds}) between 1 and 100`)]);
export const replacementReceiptProviderEvent = appSchema.table('replacement_receipt_provider_event',{
 id:uuid('id').primaryKey().references(()=>localReplacementReceipt.id,{onDelete:'restrict'}),callbackJobId:uuid('callback_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),payloadHash:text('payload_hash').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('replacement_receipt_provider_hash_check',sql`${t.payloadHash} ~ '^[a-f0-9]{64}$'`)]);
export const replacementBuyerReceipt = appSchema.table('replacement_buyer_receipt',{
 id:uuid('id').primaryKey().defaultRandom(),replacementLinkId:uuid('replacement_link_id').notNull().unique().references(()=>replacementLink.id,{onDelete:'restrict'}),sourceId:uuid('source_id').notNull().references(()=>localReplacementReceipt.id,{onDelete:'restrict'}),receivedAt:instant('received_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[index('replacement_buyer_receipt_source_idx').on(t.sourceId,t.replacementLinkId)]);
export const replacementReceiptResult = appSchema.table('replacement_receipt_result',{
 eventId:uuid('event_id').primaryKey().references(()=>replacementReceiptProviderEvent.id,{onDelete:'restrict'}),shipmentId:uuid('shipment_id').notNull().references(()=>replacementShipment.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),outcome:text('outcome').notNull(),receiptCount:integer('receipt_count').notNull(),replacementEventId:uuid('replacement_event_id').unique().references(()=>replacementEvent.id,{onDelete:'restrict'}),returnEventId:uuid('return_event_id').unique().references(()=>returnEvent.id,{onDelete:'restrict'}),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('replacement_receipt_result_value_check',sql`${t.revision}>0 AND ((${t.outcome}='received' AND ${t.receiptCount} between 1 and 100 AND ${t.replacementEventId} IS NOT NULL AND ${t.returnEventId} IS NOT NULL) OR (${t.outcome}='duplicate' AND ${t.receiptCount}=0 AND ${t.replacementEventId} IS NULL AND ${t.returnEventId} IS NULL))`)]);

// S33 draft: generation is separate from native review/application. Original
// fulfillment_item rows already exist at checkout, including expired orders;
// they remain the financial unit identity without asserting physical delivery.
export const commerceException = appSchema.table('commerce_exception',{
 id:uuid('id').primaryKey().defaultRandom(),orderId:uuid('order_id').notNull().references(()=>commerceOrder.id,{onDelete:'restrict'}),
 kind:text('kind').notNull(),revision:integer('revision').notNull().default(0),status:text('status').notNull().default('preparing'),
 sourceKind:text('source_kind').notNull(),sourceId:uuid('source_id').notNull(),proposalEventId:uuid('proposal_event_id').references(():AnyPgColumn=>exceptionEvent.id,{onDelete:'restrict'}),
 reason:text('reason').notNull(),occurredAt:instant('occurred_at').notNull(),createdAt:instant('created_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),createdXid:text('created_xid').notNull().default(sql`pg_current_xact_id()::text`),
},t=>[
 unique('commerce_exception_source_unique').on(t.sourceKind,t.sourceId),unique('commerce_exception_kind_identity').on(t.id,t.kind),
 index('commerce_exception_queue_idx').on(t.status,t.createdAt,t.id),index('commerce_exception_order_idx').on(t.orderId,t.createdAt,t.id),
 check('commerce_exception_kind_check',sql`${t.kind} IN ('late_collection','unallocated_collection','stock_discrepancy','cod_refusal','delivery_failure','replacement_stock','waybill_uncertain') AND ${t.sourceKind} IN ('payment_event','cod_event','stock_report','parcel_outcome','replacement','booking')`),
 check('commerce_exception_state_check',sql`((${t.status}='preparing' AND ${t.revision}=0) OR (${t.status} IN ('open','awaiting_source','awaiting_buyer','awaiting_stock','awaiting_return','ready_for_refund','refunding','unknown','resolved','escalated') AND ${t.revision}>0)) AND char_length(${t.reason}) between 1 and 500`),
]);
export const exceptionOperation = appSchema.table('exception_operation',{
 id:uuid('id').primaryKey().defaultRandom(),exceptionId:uuid('exception_id').notNull().references(()=>commerceException.id,{onDelete:'restrict'}),subjectId:uuid('subject_id').notNull(),
 actorScope:text('actor_scope').notNull(),actorId:text('actor_id').references(()=>user.id,{onDelete:'restrict'}),guestId:uuid('guest_id').references(()=>commerceGuest.id,{onDelete:'restrict'}),sessionId:text('session_id'),
 action:text('action').notNull(),key:text('key').notNull(),requestHash:text('request_hash').notNull(),proofDigest:text('proof_digest').unique(),input:jsonb('input').notNull(),response:jsonb('response').notNull(),
 occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),createdXid:text('created_xid').notNull().default(sql`pg_current_xact_id()::text`),
},t=>[
 unique('exception_operation_key_unique').on(t.actorScope,t.action,t.key),index('exception_operation_case_idx').on(t.exceptionId,t.id),index('exception_operation_guest_idx').on(t.guestId),
 check('exception_operation_actor_check',sql`(${t.actorId} IS NOT NULL AND ${t.guestId} IS NULL AND ${t.sessionId} IS NOT NULL AND ${t.actorScope}='user:'||${t.actorId}) OR (${t.actorId} IS NULL AND ${t.guestId} IS NOT NULL AND ${t.sessionId} IS NULL AND ${t.actorScope}='guest:'||${t.guestId}::text)`),
 check('exception_operation_value_check',sql`${t.action} IN ('report','decide','apply','intake','buyer_accept','buyer_decline','destination','refund_queue','refund_reconcile','refund_retry') AND char_length(${t.key}) between 16 and 200 AND ${t.requestHash} ~ '^[a-f0-9]{64}$' AND (${t.proofDigest} IS NULL OR ${t.proofDigest} ~ '^[a-f0-9]{64}$') AND jsonb_typeof(${t.input})='object' AND NOT (${t.input} ?| ARRAY['password','reauthentication_proof','bank_account','signature']) AND octet_length(${t.input}::text)<=131072 AND jsonb_typeof(${t.response})='object' AND NOT (${t.response} ?| ARRAY['password','reauthentication_proof','bank_account','signature']) AND octet_length(${t.response}::text)<=1048576`),
]);
export const exceptionUnit = appSchema.table('exception_unit',{
 id:uuid('id').primaryKey().defaultRandom(),exceptionId:uuid('exception_id').notNull(),kind:text('kind').notNull(),
 fulfillmentItemId:uuid('fulfillment_item_id').notNull().references(()=>fulfillmentItem.id,{onDelete:'restrict'}),replacementLinkId:uuid('replacement_link_id').references(()=>replacementLink.id,{onDelete:'restrict'}),active:boolean('active').notNull().default(true),createdAt:instant('created_at').notNull(),
},t=>[
 foreignKey({columns:[t.exceptionId,t.kind],foreignColumns:[commerceException.id,commerceException.kind],name:'exception_unit_case_kind_fk'}).onDelete('restrict'),
 unique('exception_unit_case_identity').on(t.exceptionId,t.id),
 uniqueIndex('exception_unit_case_occurrence_unique').on(t.exceptionId,t.fulfillmentItemId,sql`coalesce(${t.replacementLinkId},'00000000-0000-0000-0000-000000000000'::uuid)`),
 uniqueIndex('exception_unit_active_kind_unique').on(t.kind,t.fulfillmentItemId,sql`coalesce(${t.replacementLinkId},'00000000-0000-0000-0000-000000000000'::uuid)`).where(sql`${t.active}`),
]);
// Proposals and buyer choices are immutable typed events, not another workflow
// store. A choice points to its exact proposal event and can occur only once.
export const exceptionEvent = appSchema.table('exception_event',{
 id:uuid('id').primaryKey().defaultRandom(),exceptionId:uuid('exception_id').notNull().references(()=>commerceException.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),kind:text('kind').notNull(),status:text('status').notNull(),
 sourceKind:text('source_kind').notNull(),sourceId:uuid('source_id').notNull(),actorId:text('actor_id'),causeEventId:uuid('cause_event_id'),reason:text('reason').notNull(),snapshot:jsonb('snapshot').notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[
 unique('exception_event_revision_unique').on(t.exceptionId,t.revision),unique('exception_event_case_identity').on(t.exceptionId,t.id),unique('exception_event_source_unique').on(t.exceptionId,t.sourceKind,t.sourceId,t.kind),
 foreignKey({columns:[t.exceptionId,t.causeEventId],foreignColumns:[t.exceptionId,t.id],name:'exception_event_same_case_cause_fk'}).onDelete('restrict'),
 uniqueIndex('exception_proposal_choice_unique').on(t.causeEventId).where(sql`${t.kind} IN ('buyer_accept','buyer_decline')`),
 check('exception_event_value_check',sql`${t.revision}>0 AND ${t.kind} IN ('open','stock_report','propose','buyer_accept','buyer_decline','escalate','cancel','intake','refund_queue','refund_confirmed','refund_failed','source_reconciled','resolved') AND ${t.status} IN ('open','awaiting_source','awaiting_buyer','awaiting_stock','awaiting_return','ready_for_refund','refunding','unknown','resolved','escalated') AND ${t.sourceKind} IN ('operation','payment','cod','parcel','job','refund','replacement') AND (${t.sourceKind}='operation' OR ${t.actorId} IS NULL) AND ((${t.kind} IN ('buyer_accept','buyer_decline'))=(${t.causeEventId} IS NOT NULL)) AND char_length(${t.reason}) between 1 and 500 AND jsonb_typeof(${t.snapshot})='object' AND octet_length(${t.snapshot}::text)<=65536`),
]);
export const exceptionStockObservation = appSchema.table('exception_stock_observation',{
 operationId:uuid('operation_id').notNull().references(()=>exceptionOperation.id,{onDelete:'restrict'}),balanceId:uuid('balance_id').notNull().references(()=>inventoryBalance.id,{onDelete:'restrict'}),stockItemId:uuid('stock_item_id').notNull().references(()=>stockItem.id,{onDelete:'restrict'}),
 balanceRevision:integer('balance_revision').notNull(),missingQuantity:integer('missing_quantity').notNull(),onHand:integer('on_hand').notNull(),reserved:integer('reserved').notNull(),quarantined:integer('quarantined').notNull(),
},t=>[primaryKey({columns:[t.operationId,t.balanceId]}),check('exception_stock_observation_check',sql`${t.balanceRevision}>=0 AND ${t.missingQuantity} between 0 and 2147483647 AND ${t.onHand}>=0 AND ${t.reserved}>=0 AND ${t.quarantined}>=0 AND ${t.reserved}::bigint+${t.quarantined}::bigint<=${t.onHand}::bigint AND ${t.missingQuantity}<=${t.onHand}`)]);
export const exceptionCancellation = appSchema.table('exception_cancellation',{
 exceptionUnitId:uuid('exception_unit_id').primaryKey(),exceptionId:uuid('exception_id').notNull(),fulfillmentItemId:uuid('fulfillment_item_id').notNull().references(()=>fulfillmentItem.id,{onDelete:'restrict'}),replacementLinkId:uuid('replacement_link_id').references(()=>replacementLink.id,{onDelete:'restrict'}),
 stockDisposition:text('stock_disposition').notNull(),stockReportOperationId:uuid('stock_report_operation_id').references(()=>exceptionOperation.id,{onDelete:'restrict'}),physicalSourceId:uuid('physical_source_id').references(():AnyPgColumn=>localParcelOutcome.id,{onDelete:'restrict'}),
 eventId:uuid('event_id').notNull(),consentEventId:uuid('consent_event_id').notNull(),operationId:uuid('operation_id').notNull().references(()=>exceptionOperation.id,{onDelete:'restrict'}),occurredAt:instant('occurred_at').notNull(),
},t=>[
 check('exception_cancellation_stock_check',sql`${t.stockDisposition} IN ('released','consumed','not_reserved') AND (${t.stockDisposition}<>'consumed' OR ${t.physicalSourceId} IS NOT NULL) AND (${t.stockDisposition}<>'not_reserved' OR ${t.replacementLinkId} IS NOT NULL)`),
 foreignKey({columns:[t.exceptionId,t.exceptionUnitId],foreignColumns:[exceptionUnit.exceptionId,exceptionUnit.id],name:'exception_cancellation_unit_case_fk'}).onDelete('restrict'),
 foreignKey({columns:[t.exceptionId,t.eventId],foreignColumns:[exceptionEvent.exceptionId,exceptionEvent.id],name:'exception_cancellation_event_case_fk'}).onDelete('restrict'),
 foreignKey({columns:[t.exceptionId,t.consentEventId],foreignColumns:[exceptionEvent.exceptionId,exceptionEvent.id],name:'exception_cancellation_consent_case_fk'}).onDelete('restrict'),
 uniqueIndex('exception_cancel_original_unit_unique').on(t.fulfillmentItemId).where(sql`${t.replacementLinkId} IS NULL`),unique('exception_cancel_replacement_unique').on(t.replacementLinkId),
]);
// PR-21 original-booking cancellation. Original waybill history is never rewritten.
export const shipmentCancellation = appSchema.table('shipment_cancellation',{
 id:uuid('id').primaryKey().defaultRandom(),bookingId:uuid('booking_id').notNull().references(()=>shipmentBooking.id,{onDelete:'restrict'}),operationId:uuid('operation_id').notNull().references(()=>exceptionOperation.id,{onDelete:'restrict'}),
 attempt:integer('attempt').notNull(),creationJobId:uuid('creation_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),providerOperationId:uuid('provider_operation_id').references(():AnyPgColumn=>localWaybillCancellation.id,{onDelete:'restrict'}),status:text('status').notNull().default('queued'),createdAt:instant('created_at').notNull(),
},t=>[unique('shipment_cancellation_attempt_unique').on(t.bookingId,t.attempt),unique('shipment_cancellation_request_unique').on(t.bookingId,t.operationId),uniqueIndex('shipment_cancellation_active_unique').on(t.bookingId).where(sql`${t.status} NOT IN ('failed','not_created')`),check('shipment_cancellation_state_check',sql`${t.attempt}>0 AND ${t.status} IN ('queued','acknowledged','cancelled','failed','not_created')`)]);
export const localWaybillCancellation = appSchema.table('local_waybill_cancellation',{
 id:uuid('id').primaryKey().defaultRandom(),cancellationId:uuid('cancellation_id').notNull().unique().references(()=>shipmentCancellation.id,{onDelete:'restrict'}),environment:text('environment').notNull(),requestHash:text('request_hash').notNull(),status:text('status').notNull().default('acknowledged'),
 sourceOperationId:uuid('source_operation_id').references(()=>localWaybillOperation.id,{onDelete:'restrict'}),sourceStatus:text('source_status'),trackingNumber:text('tracking_number'),failureCode:text('failure_code'),createdAt:instant('created_at').notNull(),terminalAt:instant('terminal_at'),
},t=>[check('local_waybill_cancellation_value_check',sql`(${t.environment} IN ('local','test') AND ${t.requestHash} ~ '^[a-f0-9]{64}$' AND ((${t.status}='acknowledged' AND ${t.sourceOperationId} IS NULL AND ${t.sourceStatus} IS NULL AND ${t.trackingNumber} IS NULL AND ${t.failureCode} IS NULL AND ${t.terminalAt} IS NULL) OR (${t.status} IN ('cancelled','failed') AND ${t.sourceStatus} IN ('absent','acknowledged','issued','failed') AND ((${t.sourceStatus}='absent')=(${t.sourceOperationId} IS NULL)) AND ((${t.sourceStatus}='issued' AND ${t.trackingNumber} ~ '^LOCAL-[A-F0-9]{32}$') OR (${t.sourceStatus}<>'issued' AND ${t.trackingNumber} IS NULL)) AND ((${t.status}='cancelled' AND ${t.failureCode} IS NULL) OR (${t.status}='failed' AND ${t.failureCode} IN ('CANCELLATION_REJECTED','TEMPORARY_UNAVAILABLE'))) AND ${t.terminalAt}>=${t.createdAt}))) IS TRUE`)]);
export const localWaybillCancellationEvent = appSchema.table('local_waybill_cancellation_event',{
 id:uuid('id').primaryKey().defaultRandom(),operationId:uuid('operation_id').notNull().references(()=>localWaybillCancellation.id,{onDelete:'restrict'}),status:text('status').notNull(),sourceOperationId:uuid('source_operation_id').references(()=>localWaybillOperation.id,{onDelete:'restrict'}),sourceStatus:text('source_status'),trackingNumber:text('tracking_number'),failureCode:text('failure_code'),occurredAt:instant('occurred_at').notNull(),signature:text('signature').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('waybill_cancellation_event_check',sql`(${t.signature} ~ '^[a-f0-9]{64}$' AND ((${t.status}='acknowledged' AND ${t.sourceOperationId} IS NULL AND ${t.sourceStatus} IS NULL AND ${t.trackingNumber} IS NULL AND ${t.failureCode} IS NULL) OR (${t.status} IN ('cancelled','failed') AND ${t.sourceStatus} IN ('absent','acknowledged','issued','failed') AND ((${t.sourceStatus}='absent')=(${t.sourceOperationId} IS NULL)) AND ((${t.sourceStatus}='issued' AND ${t.trackingNumber} ~ '^LOCAL-[A-F0-9]{32}$') OR (${t.sourceStatus}<>'issued' AND ${t.trackingNumber} IS NULL)) AND ((${t.status}='cancelled' AND ${t.failureCode} IS NULL) OR (${t.status}='failed' AND ${t.failureCode} IN ('CANCELLATION_REJECTED','TEMPORARY_UNAVAILABLE')))))) IS TRUE`)]);
export const waybillCancellationProviderEvent = appSchema.table('waybill_cancellation_provider_event',{
 id:uuid('id').primaryKey().references(()=>localWaybillCancellationEvent.id,{onDelete:'restrict'}),cancellationId:uuid('cancellation_id').notNull().references(()=>shipmentCancellation.id,{onDelete:'restrict'}),callbackJobId:uuid('callback_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),payloadHash:text('payload_hash').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('waybill_cancellation_provider_hash_check',sql`${t.payloadHash} ~ '^[a-f0-9]{64}$'`)]);
export const waybillCancellationResult = appSchema.table('waybill_cancellation_result',{
 eventId:uuid('event_id').primaryKey().references(()=>waybillCancellationProviderEvent.id,{onDelete:'restrict'}),outcome:text('outcome').notNull(),fulfillmentEventId:uuid('fulfillment_event_id').unique().references(()=>fulfillmentEvent.id,{onDelete:'restrict'}),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('waybill_cancellation_result_check',sql`${t.outcome} IN ('acknowledged','cancelled','failed','duplicate') AND ((${t.outcome}='cancelled')=(${t.fulfillmentEventId} IS NOT NULL))`)]);

export const localParcelOutcome = appSchema.table('local_parcel_outcome',{
 id:uuid('id').primaryKey().defaultRandom(),reference:text('reference').notNull(),environment:text('environment').notNull(),shipmentId:uuid('shipment_id').notNull().references(()=>orderShipment.id,{onDelete:'restrict'}),bookingId:uuid('booking_id').notNull().references(()=>shipmentBooking.id,{onDelete:'restrict'}),
 clockNamespace:text('clock_namespace'),status:text('status').notNull(),unitIds:jsonb('unit_ids').notNull(),requestHash:text('request_hash').notNull(),signature:text('signature').notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('local_parcel_outcome_reference_unique').on(t.environment,t.reference),index('local_parcel_outcome_shipment_idx').on(t.shipmentId,t.occurredAt,t.id),check('local_parcel_outcome_value_check',sql`${t.environment} IN ('local','test') AND ${t.reference} ~ '^[A-Za-z0-9_.:-]{1,200}$' AND ${t.status} IN ('failed','refused','returned_to_sender') AND jsonb_typeof(${t.unitIds})='array' AND jsonb_array_length(${t.unitIds}) between 1 and 100 AND ${t.requestHash} ~ '^[a-f0-9]{64}$' AND ${t.signature} ~ '^[a-f0-9]{64}$'`)]);
export const parcelOutcomeProviderEvent = appSchema.table('parcel_outcome_provider_event',{
 id:uuid('id').primaryKey().references(()=>localParcelOutcome.id,{onDelete:'restrict'}),callbackJobId:uuid('callback_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),payloadHash:text('payload_hash').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('parcel_outcome_provider_hash_check',sql`${t.payloadHash} ~ '^[a-f0-9]{64}$'`)]);
export const parcelOutcomeResult = appSchema.table('parcel_outcome_result',{
 eventId:uuid('event_id').primaryKey().references(()=>parcelOutcomeProviderEvent.id,{onDelete:'restrict'}),outcome:text('outcome').notNull(),exceptionIds:jsonb('exception_ids').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('parcel_outcome_result_value_check',sql`${t.outcome} IN ('observed','duplicate','exception') AND jsonb_typeof(${t.exceptionIds})='array' AND jsonb_array_length(${t.exceptionIds}) between 0 and 100`)]);
export const exceptionGoodsIntake = appSchema.table('exception_goods_intake',{
 id:uuid('id').primaryKey().defaultRandom(),exceptionId:uuid('exception_id').notNull().references(()=>commerceException.id,{onDelete:'restrict'}),operationId:uuid('operation_id').notNull().unique().references(()=>exceptionOperation.id,{onDelete:'restrict'}),eventId:uuid('event_id').notNull(),physicalOutcomeId:uuid('physical_outcome_id').notNull().references(()=>localParcelOutcome.id,{onDelete:'restrict'}),occurredAt:instant('occurred_at').notNull(),
},t=>[unique('exception_intake_case_identity').on(t.exceptionId,t.id),foreignKey({columns:[t.exceptionId,t.eventId],foreignColumns:[exceptionEvent.exceptionId,exceptionEvent.id],name:'exception_intake_event_case_fk'}).onDelete('restrict')]);
export const exceptionGoodsLine = appSchema.table('exception_goods_line',{
 id:uuid('id').primaryKey().defaultRandom(),exceptionId:uuid('exception_id').notNull(),intakeId:uuid('intake_id').notNull(),exceptionUnitId:uuid('exception_unit_id').notNull(),stockItemId:uuid('stock_item_id').references(()=>stockItem.id,{onDelete:'restrict'}),balanceId:uuid('balance_id').references(()=>inventoryBalance.id,{onDelete:'restrict'}),quantity:integer('quantity').notNull(),identityConfirmed:boolean('identity_confirmed').notNull(),stockMovementId:uuid('stock_movement_id').unique().references(()=>stockMovement.id,{onDelete:'restrict'}),
},t=>[
 foreignKey({columns:[t.exceptionId,t.intakeId],foreignColumns:[exceptionGoodsIntake.exceptionId,exceptionGoodsIntake.id],name:'exception_goods_intake_case_fk'}).onDelete('restrict'),foreignKey({columns:[t.exceptionId,t.exceptionUnitId],foreignColumns:[exceptionUnit.exceptionId,exceptionUnit.id],name:'exception_goods_unit_case_fk'}).onDelete('restrict'),
 index('exception_goods_unit_idx').on(t.exceptionUnitId,t.balanceId,t.id),
 check('exception_goods_line_value_check',sql`${t.quantity} between 1 and 1000000 AND ((${t.identityConfirmed} AND ${t.stockItemId} IS NOT NULL AND ${t.balanceId} IS NOT NULL AND ${t.stockMovementId} IS NOT NULL) OR (NOT ${t.identityConfirmed} AND ${t.stockItemId} IS NULL AND ${t.balanceId} IS NULL AND ${t.stockMovementId} IS NULL))`),
]);
// One finance authorization may queue several original sources. Each refund
// still owns one exact collection basis, immutable obligation and bounded job.
export const recoveryRefund = appSchema.table('recovery_refund',{
 id:uuid('id').primaryKey().defaultRandom(),exceptionId:uuid('exception_id').notNull().references(()=>commerceException.id,{onDelete:'restrict'}),orderId:uuid('order_id').notNull().references(()=>commerceOrder.id,{onDelete:'restrict'}),operationId:uuid('operation_id').notNull().references(()=>exceptionOperation.id,{onDelete:'restrict'}),
 revision:integer('revision').notNull(),status:text('status').notNull(),basisKind:text('basis_kind').notNull(),sourceKind:text('source_kind').notNull(),sourceId:uuid('source_id').notNull(),sourceTransactionId:uuid('source_transaction_id').notNull().references(()=>financeTransaction.id,{onDelete:'restrict'}),receiptId:uuid('receipt_id').references(()=>economicReceipt.id,{onDelete:'restrict'}),sourceAmount:bigint('source_amount',{mode:'number'}).notNull(),amount:bigint('amount',{mode:'number'}).notNull(),
 obligationTransactionId:uuid('obligation_transaction_id').notNull().unique().references(()=>financeTransaction.id,{onDelete:'restrict'}),cashTransactionId:uuid('cash_transaction_id').unique().references(()=>financeTransaction.id,{onDelete:'restrict'}),currentJobId:uuid('current_job_id').unique().references(()=>outboxJob.id,{onDelete:'restrict'}),currentOperationId:uuid('current_operation_id').references(():AnyPgColumn=>localRecoveryOperation.id,{onDelete:'restrict'}),destinationSourceId:uuid('destination_source_id').references(():AnyPgColumn=>localRecoveryDestination.id,{onDelete:'restrict'}),createdAt:instant('created_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[
 unique('recovery_refund_case_source_unique').on(t.exceptionId,t.sourceTransactionId),index('recovery_refund_source_idx').on(t.sourceTransactionId,t.id),index('recovery_refund_order_idx').on(t.orderId,t.createdAt,t.id),
 check('recovery_refund_value_check',sql`${t.revision}>0 AND ${t.status} IN ('awaiting_destination','queued','processing','unknown','succeeded','failed') AND ${t.basisKind} IN ('purchased_units','unallocated') AND ${t.sourceKind} IN ('payment_event','cod_event') AND ${t.sourceAmount} between 1 and 9007199254740991 AND ${t.amount} between 1 and ${t.sourceAmount} AND ((${t.status}='succeeded')=(${t.cashTransactionId} IS NOT NULL)) AND ((${t.basisKind}='purchased_units')=(${t.receiptId} IS NOT NULL))`),
]);
export const recoveryRefundAllocation = appSchema.table('recovery_refund_allocation',{
 id:uuid('id').primaryKey().defaultRandom(),refundId:uuid('refund_id').notNull().references(()=>recoveryRefund.id,{onDelete:'restrict'}),exceptionUnitId:uuid('exception_unit_id').unique().references(()=>exceptionUnit.id,{onDelete:'restrict'}),fulfillmentItemId:uuid('fulfillment_item_id').unique().references(()=>fulfillmentItem.id,{onDelete:'restrict'}),receiptId:uuid('receipt_id').references(()=>economicReceipt.id,{onDelete:'restrict'}),purchaseEventId:uuid('purchase_event_id').references(()=>commerceEvent.id,{onDelete:'restrict'}),merchandiseAmount:bigint('merchandise_amount',{mode:'number'}).notNull(),buyerShipping:bigint('buyer_shipping',{mode:'number'}).notNull(),amount:bigint('amount',{mode:'number'}).notNull(),paymentCharge:bigint('payment_charge',{mode:'number'}).notNull().default(0),
},t=>[
 uniqueIndex('recovery_unallocated_refund_unique').on(t.refundId).where(sql`${t.exceptionUnitId} IS NULL`),index('recovery_allocation_receipt_idx').on(t.receiptId,t.refundId),
 check('recovery_allocation_value_check',sql`${t.amount} between 1 and 9007199254740991 AND ((${t.exceptionUnitId} IS NOT NULL AND ${t.fulfillmentItemId} IS NOT NULL AND ${t.receiptId} IS NOT NULL AND ${t.merchandiseAmount}=99000 AND ${t.buyerShipping}>=0 AND ${t.paymentCharge}>=0 AND ${t.amount}::numeric=${t.merchandiseAmount}::numeric+${t.buyerShipping}::numeric+${t.paymentCharge}::numeric) OR (${t.exceptionUnitId} IS NULL AND ${t.fulfillmentItemId} IS NULL AND ${t.receiptId} IS NULL AND ${t.purchaseEventId} IS NULL AND ${t.merchandiseAmount}=0 AND ${t.buyerShipping}=0 AND ${t.paymentCharge}=0))`),
]);
export const recoveryRefundEvent = appSchema.table('recovery_refund_event',{
 id:uuid('id').primaryKey().defaultRandom(),refundId:uuid('refund_id').notNull().references(()=>recoveryRefund.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),kind:text('kind').notNull(),status:text('status').notNull(),sourceKind:text('source_kind').notNull(),sourceId:uuid('source_id').notNull(),providerOperationId:uuid('provider_operation_id').references(():AnyPgColumn=>localRecoveryOperation.id,{onDelete:'restrict'}),jobId:uuid('job_id').references(()=>outboxJob.id,{onDelete:'restrict'}),destinationSourceId:uuid('destination_source_id').references(():AnyPgColumn=>localRecoveryDestination.id,{onDelete:'restrict'}),cashTransactionId:uuid('cash_transaction_id').references(()=>financeTransaction.id,{onDelete:'restrict'}),reason:text('reason').notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('recovery_refund_event_revision_unique').on(t.refundId,t.revision),unique('recovery_refund_event_source_unique').on(t.refundId,t.sourceKind,t.sourceId,t.kind),check('recovery_refund_event_value_check',sql`${t.revision}>0 AND ${t.kind} IN ('queue','destination','prepare','confirm','fail','reconcile','retry') AND ${t.status} IN ('awaiting_destination','queued','processing','unknown','succeeded','failed') AND ${t.sourceKind} IN ('operation','job','provider') AND char_length(${t.reason}) between 1 and 500`)]);
export const localRecoveryDestination = appSchema.table('local_recovery_destination',{
 id:uuid('id').primaryKey().defaultRandom(),refundId:uuid('refund_id').notNull().references(()=>recoveryRefund.id,{onDelete:'restrict'}),environment:text('environment').notNull(),buyerScope:text('buyer_scope').notNull(),destinationReference:text('destination_reference').notNull().unique(),signature:text('signature').notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('local_recovery_destination_check',sql`${t.environment} IN ('local','test') AND ${t.buyerScope} ~ '^(user:[A-Za-z0-9_-]{1,100}|guest:[a-f0-9-]{36})$' AND ${t.destinationReference} ~ '^LOCAL-RECOVERY-DEST-[A-F0-9]{32}$' AND ${t.signature} ~ '^[a-f0-9]{64}$'`)]);
export const localRecoveryOperation = appSchema.table('local_recovery_operation',{
 id:uuid('id').primaryKey().defaultRandom(),refundId:uuid('refund_id').notNull().references(()=>recoveryRefund.id,{onDelete:'restrict'}),creationJobId:uuid('creation_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),attempt:integer('attempt').notNull(),environment:text('environment').notNull(),rail:text('rail').notNull(),originalPaymentOperationId:uuid('original_payment_operation_id').references(()=>localPaymentOperation.id,{onDelete:'restrict'}),destinationSourceId:uuid('destination_source_id').references(()=>localRecoveryDestination.id,{onDelete:'restrict'}),sourceTransactionId:uuid('source_transaction_id').notNull().references(()=>financeTransaction.id,{onDelete:'restrict'}),amount:bigint('amount',{mode:'number'}).notNull(),clockNamespace:text('clock_namespace'),requestHash:text('request_hash').notNull(),createdAt:instant('created_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('local_recovery_attempt_unique').on(t.refundId,t.attempt),check('local_recovery_operation_value_check',sql`${t.attempt}>0 AND ${t.environment} IN ('local','test') AND ${t.amount} between 1 and 9007199254740991 AND ${t.requestHash} ~ '^[a-f0-9]{64}$' AND ((${t.rail}='prepaid_original' AND ${t.originalPaymentOperationId} IS NOT NULL AND ${t.destinationSourceId} IS NULL) OR (${t.rail}='cod_verified_destination' AND ${t.originalPaymentOperationId} IS NULL AND ${t.destinationSourceId} IS NOT NULL))`)]);
export const localRecoveryEvent = appSchema.table('local_recovery_event',{
 id:uuid('id').primaryKey().defaultRandom(),operationId:uuid('operation_id').notNull().unique().references(()=>localRecoveryOperation.id,{onDelete:'restrict'}),status:text('status').notNull(),amount:bigint('amount',{mode:'number'}).notNull(),bankReference:text('bank_reference').notNull().unique(),occurredAt:instant('occurred_at').notNull(),signature:text('signature').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('local_recovery_event_value_check',sql`((${t.status}='succeeded' AND ${t.amount} between 1 and 9007199254740991) OR (${t.status}='failed' AND ${t.amount}=0)) AND ${t.bankReference} ~ '^LOCAL-RECOVERY-[A-F0-9]{32}$' AND ${t.signature} ~ '^[a-f0-9]{64}$'`)]);
export const recoveryProviderEvent = appSchema.table('recovery_provider_event',{
 id:uuid('id').primaryKey().references(()=>localRecoveryEvent.id,{onDelete:'restrict'}),refundId:uuid('refund_id').notNull().references(()=>recoveryRefund.id,{onDelete:'restrict'}),callbackJobId:uuid('callback_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),payloadHash:text('payload_hash').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('recovery_provider_event_hash_check',sql`${t.payloadHash} ~ '^[a-f0-9]{64}$'`)]);
export const recoveryEventResult = appSchema.table('recovery_event_result',{
 eventId:uuid('event_id').primaryKey().references(()=>recoveryProviderEvent.id,{onDelete:'restrict'}),refundId:uuid('refund_id').notNull().references(()=>recoveryRefund.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),outcome:text('outcome').notNull(),refundEventId:uuid('refund_event_id').notNull().unique().references(()=>recoveryRefundEvent.id,{onDelete:'restrict'}),exceptionEventId:uuid('exception_event_id').notNull().unique().references(()=>exceptionEvent.id,{onDelete:'restrict'}),cashTransactionId:uuid('cash_transaction_id').unique().references(()=>financeTransaction.id,{onDelete:'restrict'}),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('recovery_event_result_value_check',sql`${t.revision}>0 AND ${t.outcome} IN ('confirmed','failed') AND ((${t.outcome}='confirmed')=(${t.cashTransactionId} IS NOT NULL))`)]);
export const recoveryAdjustmentIntent = appSchema.table('recovery_adjustment_intent',{
 id:uuid('id').primaryKey().defaultRandom(),refundId:uuid('refund_id').notNull().references(()=>recoveryRefund.id,{onDelete:'restrict'}),receiptId:uuid('receipt_id').notNull().references(()=>economicReceipt.id,{onDelete:'restrict'}),purchaseEventId:uuid('purchase_event_id').references(()=>commerceEvent.id,{onDelete:'restrict'}),dispatchReason:text('dispatch_reason').notNull(),sequence:integer('sequence').notNull(),merchandiseRefunded:bigint('merchandise_refunded',{mode:'number'}).notNull(),retainedMerchandise:bigint('retained_merchandise',{mode:'number'}).notNull(),allocation:jsonb('allocation').notNull(),originalOccurredAt:instant('original_occurred_at').notNull(),confirmedAt:instant('confirmed_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('recovery_adjustment_receipt_unique').on(t.refundId,t.receiptId),unique('recovery_adjustment_sequence_unique').on(t.receiptId,t.sequence),check('recovery_adjustment_value_check',sql`((${t.purchaseEventId} IS NULL AND ${t.dispatchReason}='original_purchase_missing') OR (${t.purchaseEventId} IS NOT NULL AND ${t.dispatchReason}='pending_adapter')) AND ${t.sequence}>0 AND ${t.merchandiseRefunded} between 99000 and 9007199254740991 AND ${t.retainedMerchandise} between 0 and 9007199254740991 AND ${t.merchandiseRefunded}%99000=0 AND ${t.retainedMerchandise}%99000=0 AND jsonb_typeof(${t.allocation})='array' AND jsonb_array_length(${t.allocation}) between 1 and 100 AND ${t.confirmedAt}>=${t.originalOccurredAt}`)]);

// S34..S60 domain tables: finance expenses, affiliate attribution/commissions/payouts,
// native support chat, buyer accounts/addresses/return evidence, shipping label jobs/artifacts,
// admin export selections and ad destination diagnostics.
export const financeExpense = appSchema.table('finance_expense',{
 id:uuid('id').primaryKey().defaultRandom(),category:text('category').notNull(),amountIdr:bigint('amount_idr',{mode:'number'}).notNull(),status:text('status').notNull().default('posted'),periodKey:text('period_key').notNull(),evidenceReference:text('evidence_reference'),transactionId:uuid('transaction_id').references(()=>financeTransaction.id,{onDelete:'restrict'}),actorId:text('actor_id').notNull().references(()=>user.id,{onDelete:'restrict'}),reason:text('reason').notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
});
export const affiliateProfile = appSchema.table('affiliate_profile',{
 affiliateId:uuid('affiliate_id').primaryKey().references(()=>affiliateAccount.id,{onDelete:'restrict'}),referralCode:text('referral_code').notNull().unique(),displayName:text('display_name').notNull(),beneficiaryBankCode:text('beneficiary_bank_code').notNull(),beneficiaryAccountNumber:text('beneficiary_account_number').notNull(),beneficiaryAccountHolder:text('beneficiary_account_holder').notNull(),beneficiaryStatus:text('beneficiary_status').notNull().default('verified'),beneficiaryRevision:integer('beneficiary_revision').notNull().default(1),revision:integer('revision').notNull().default(1),enrolledAt:instant('enrolled_at').notNull().default(sql`clock_timestamp()`),updatedAt:instant('updated_at').notNull().default(sql`clock_timestamp()`),
});
export const affiliateBeneficiaryChange = appSchema.table('affiliate_beneficiary_change',{
 id:uuid('id').primaryKey().defaultRandom(),affiliateId:uuid('affiliate_id').notNull().references(()=>affiliateAccount.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),bankCode:text('bank_code').notNull(),accountNumber:text('account_number').notNull(),accountHolder:text('account_holder').notNull(),status:text('status').notNull().default('verified'),operationId:uuid('operation_id').notNull().unique(),proofDigest:text('proof_digest'),reason:text('reason').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('affiliate_beneficiary_change_rev_unique').on(t.affiliateId,t.revision)]);
export const referralTouch = appSchema.table('referral_touch',{
 id:uuid('id').primaryKey().defaultRandom(),affiliateId:uuid('affiliate_id').notNull().references(()=>affiliateAccount.id,{onDelete:'restrict'}),referralCode:text('referral_code').notNull(),visitorId:uuid('visitor_id'),buyerUserId:text('buyer_user_id'),guestId:uuid('guest_id').references(()=>commerceGuest.id,{onDelete:'restrict'}),sourcePath:text('source_path'),touchedAt:instant('touched_at').notNull(),expiresAt:instant('expires_at').notNull(),operationId:uuid('operation_id').notNull().unique(),requestHash:text('request_hash').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[index('referral_touch_guest_idx').on(t.guestId)]);
export const orderAttribution = appSchema.table('order_attribution',{
 orderId:uuid('order_id').primaryKey().references(()=>commerceOrder.id,{onDelete:'restrict'}),affiliateId:uuid('affiliate_id').notNull().references(()=>affiliateAccount.id,{onDelete:'restrict'}),referralTouchId:uuid('referral_touch_id').notNull().references(()=>referralTouch.id,{onDelete:'restrict'}),rateVersionId:uuid('rate_version_id'),policyVersionId:uuid('policy_version_id'),basisPoints:integer('basis_points').notNull(),attributedAt:instant('attributed_at').notNull().default(sql`clock_timestamp()`),
});
export const commissionEntry = appSchema.table('commission_entry',{
 id:uuid('id').primaryKey().defaultRandom(),orderId:uuid('order_id').notNull().references(()=>commerceOrder.id,{onDelete:'restrict'}),orderItemId:uuid('order_item_id').notNull().references(()=>orderItem.id,{onDelete:'restrict'}),fulfillmentItemId:uuid('fulfillment_item_id').notNull().unique().references(()=>fulfillmentItem.id,{onDelete:'restrict'}),replacementLinkId:uuid('replacement_link_id'),affiliateId:uuid('affiliate_id').notNull().references(()=>affiliateAccount.id,{onDelete:'restrict'}),basisPoints:integer('basis_points').notNull(),merchandiseAmount:bigint('merchandise_amount',{mode:'number'}).notNull().default(99000),amountIdr:bigint('amount_idr',{mode:'number'}).notNull(),status:text('status').notNull().default('pending'),holdReason:text('hold_reason'),receiptAnchor:instant('receipt_anchor'),availableAt:instant('available_at'),revision:integer('revision').notNull().default(1),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),updatedAt:instant('updated_at').notNull().default(sql`clock_timestamp()`),
});
export const commissionAdjustment = appSchema.table('commission_adjustment',{
 id:uuid('id').primaryKey().defaultRandom(),commissionEntryId:uuid('commission_entry_id').notNull().references(()=>commissionEntry.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),kind:text('kind').notNull(),deltaIdr:bigint('delta_idr',{mode:'number'}).notNull(),statusAfter:text('status_after').notNull(),sourceKind:text('source_kind').notNull(),sourceId:uuid('source_id').notNull(),reason:text('reason').notNull(),occurredAt:instant('occurred_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('commission_adjustment_rev_unique').on(t.commissionEntryId,t.revision)]);
export const affiliatePayout = appSchema.table('affiliate_payout',{
 id:uuid('id').primaryKey().defaultRandom(),affiliateId:uuid('affiliate_id').notNull().references(()=>affiliateAccount.id,{onDelete:'restrict'}),amountIdr:bigint('amount_idr',{mode:'number'}).notNull(),status:text('status').notNull().default('queued'),executionMode:text('execution_mode').notNull().default('manual'),beneficiarySnapshot:jsonb('beneficiary_snapshot').notNull(),claimedByUserId:text('claimed_by_user_id'),claimedAt:instant('claimed_at'),claimExpiresAt:instant('claim_expires_at'),transferReference:text('transfer_reference'),transferredAt:instant('transferred_at'),evidenceArtifactId:uuid('evidence_artifact_id'),verifiedByUserId:text('verified_by_user_id'),verifiedAt:instant('verified_at'),financeTransactionId:uuid('finance_transaction_id').references(()=>financeTransaction.id,{onDelete:'restrict'}),revision:integer('revision').notNull().default(1),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),updatedAt:instant('updated_at').notNull().default(sql`clock_timestamp()`),
});
export const affiliatePayoutEntry = appSchema.table('affiliate_payout_entry',{
 payoutId:uuid('payout_id').notNull().references(()=>affiliatePayout.id,{onDelete:'restrict'}),commissionEntryId:uuid('commission_entry_id').notNull().unique().references(()=>commissionEntry.id,{onDelete:'restrict'}),allocatedAmountIdr:bigint('allocated_amount_idr',{mode:'number'}).notNull(),
},t=>[primaryKey({columns:[t.payoutId,t.commissionEntryId]})]);
export const affiliatePayoutEvent = appSchema.table('affiliate_payout_event',{
 id:uuid('id').primaryKey().defaultRandom(),payoutId:uuid('payout_id').notNull().references(()=>affiliatePayout.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),kind:text('kind').notNull(),status:text('status').notNull(),actorId:text('actor_id'),operationId:uuid('operation_id'),details:jsonb('details').notNull(),reason:text('reason').notNull(),occurredAt:instant('occurred_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('affiliate_payout_event_rev_unique').on(t.payoutId,t.revision)]);
export const affiliatePayoutEvidence = appSchema.table('affiliate_payout_evidence',{
 id:uuid('id').primaryKey(),payoutId:uuid('payout_id').notNull().references(()=>affiliatePayout.id,{onDelete:'restrict'}),createdByUserId:text('created_by_user_id').notNull(),fileName:text('file_name').notNull(),mediaType:text('media_type').notNull(),sizeBytes:integer('size_bytes').notNull(),expiresAt:instant('expires_at').notNull(),artifactId:uuid('artifact_id'),sha256:text('sha256'),uploadedAt:instant('uploaded_at'),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('affiliate_payout_evidence_artifact_unique').on(t.artifactId),index('affiliate_payout_evidence_payout_idx').on(t.payoutId),
 check('affiliate_payout_evidence_value_check',sql`${t.mediaType} IN ('image/jpeg','image/png','application/pdf') AND ${t.sizeBytes} between 1 and 10485760 AND ((${t.artifactId} IS NULL) = (${t.uploadedAt} IS NULL)) AND ((${t.artifactId} IS NULL) = (${t.sha256} IS NULL)) AND (${t.sha256} IS NULL OR ${t.sha256} ~ '^[0-9a-f]{64}$')`)]);

export const guestSupportIdentity = appSchema.table('guest_support_identity',{
 id:uuid('id').primaryKey().defaultRandom(),tokenDigest:text('token_digest').notNull().unique(),guestId:uuid('guest_id').references(()=>commerceGuest.id,{onDelete:'restrict'}),orderId:uuid('order_id'),contactValue:text('contact_value'),contactVerifiedAt:instant('contact_verified_at'),linkedUserId:text('linked_user_id'),expiresAt:instant('expires_at').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[index('guest_support_identity_guest_idx').on(t.guestId)]);
export const supportConversation = appSchema.table('support_conversation',{
 id:uuid('id').primaryKey().defaultRandom(),buyerUserId:text('buyer_user_id').references(()=>user.id,{onDelete:'restrict'}),guestSupportId:uuid('guest_support_id').references(()=>guestSupportIdentity.id,{onDelete:'restrict'}),primaryProductId:uuid('primary_product_id'),primaryOrderId:uuid('primary_order_id'),status:text('status').notNull().default('open'),assignedUserId:text('assigned_user_id').references(()=>user.id,{onDelete:'restrict'}),priority:text('priority').notNull().default('normal'),publicSequence:integer('public_sequence').notNull().default(0),revision:integer('revision').notNull().default(1),lastPublicMessageAt:instant('last_public_message_at'),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),updatedAt:instant('updated_at').notNull().default(sql`clock_timestamp()`),
},t=>[
 // S104: staff inbox keyset (newest activity first), unfiltered and per assignee (null = unassigned).
 index('support_conversation_inbox_idx').on(sql`coalesce(${t.lastPublicMessageAt},${t.createdAt})`,t.id),
 index('support_conversation_assignee_inbox_idx').on(t.assignedUserId,sql`coalesce(${t.lastPublicMessageAt},${t.createdAt})`,t.id),
]);
export const supportMessage = appSchema.table('support_message',{
 id:uuid('id').primaryKey().defaultRandom(),conversationId:uuid('conversation_id').notNull().references(()=>supportConversation.id,{onDelete:'restrict'}),publicSequence:integer('public_sequence').notNull(),senderSide:text('sender_side').notNull(),senderUserId:text('sender_user_id'),senderGuestId:uuid('sender_guest_id'),clientMessageId:text('client_message_id').notNull(),requestHash:text('request_hash').notNull(),body:text('body').notNull(),replyToMessageId:uuid('reply_to_message_id'),redactedAt:instant('redacted_at'),redactedReason:text('redacted_reason'),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('support_message_seq_unique').on(t.conversationId,t.publicSequence),unique('support_message_client_unique').on(t.conversationId,t.senderSide,t.clientMessageId)]);
export const supportAttachment = appSchema.table('support_attachment',{
 id:uuid('id').primaryKey().defaultRandom(),conversationId:uuid('conversation_id').notNull().references(()=>supportConversation.id,{onDelete:'restrict'}),messageId:uuid('message_id'),uploaderScope:text('uploader_scope').notNull(),contentType:text('content_type').notNull(),byteSize:integer('byte_size').notNull(),sha256:text('sha256').notNull(),storageKey:text('storage_key').notNull(),scanStatus:text('scan_status').notNull().default('ready'),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
});
export const supportContextCard = appSchema.table('support_context_card',{
 id:uuid('id').primaryKey().defaultRandom(),conversationId:uuid('conversation_id').notNull().references(()=>supportConversation.id,{onDelete:'restrict'}),messageId:uuid('message_id').notNull().references(()=>supportMessage.id,{onDelete:'restrict'}),kind:text('kind').notNull(),resourceId:uuid('resource_id').notNull(),snapshot:jsonb('snapshot').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
});
export const supportInternalNote = appSchema.table('support_internal_note',{
 id:uuid('id').primaryKey().defaultRandom(),conversationId:uuid('conversation_id').notNull().references(()=>supportConversation.id,{onDelete:'restrict'}),authorUserId:text('author_user_id').notNull().references(()=>user.id,{onDelete:'restrict'}),clientNoteId:text('client_note_id').notNull(),requestHash:text('request_hash').notNull(),body:text('body').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('support_internal_note_client_unique').on(t.conversationId,t.authorUserId,t.clientNoteId)]);
export const supportReadPosition = appSchema.table('support_read_position',{
 conversationId:uuid('conversation_id').notNull().references(()=>supportConversation.id,{onDelete:'restrict'}),participantScope:text('participant_scope').notNull(),readerSide:text('reader_side').notNull(),lastReadSequence:integer('last_read_sequence').notNull().default(0),updatedAt:instant('updated_at').notNull().default(sql`clock_timestamp()`),
},t=>[primaryKey({columns:[t.conversationId,t.participantScope]})]);
export const supportAssignmentEvent = appSchema.table('support_assignment_event',{
 id:uuid('id').primaryKey().defaultRandom(),conversationId:uuid('conversation_id').notNull().references(()=>supportConversation.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),kind:text('kind').notNull(),previousUserId:text('previous_user_id'),assignedUserId:text('assigned_user_id'),actorId:text('actor_id').notNull(),reason:text('reason').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
});
export const supportParticipantPreference = appSchema.table('support_participant_preference',{
 conversationId:uuid('conversation_id').notNull().references(()=>supportConversation.id,{onDelete:'restrict'}),participantScope:text('participant_scope').notNull(),archived:boolean('archived').notNull().default(false),muted:boolean('muted').notNull().default(false),revision:integer('revision').notNull().default(1),updatedAt:instant('updated_at').notNull().default(sql`clock_timestamp()`),
},t=>[primaryKey({columns:[t.conversationId,t.participantScope]})]);
export const supportSavedReply = appSchema.table('support_saved_reply',{
 id:uuid('id').primaryKey().defaultRandom(),slug:text('slug').notNull().unique(),title:text('title').notNull(),bodyTemplate:text('body_template').notNull(),placeholders:jsonb('placeholders').notNull(),enabled:boolean('enabled').notNull().default(true),revision:integer('revision').notNull().default(1),actorId:text('actor_id').notNull(),updatedAt:instant('updated_at').notNull().default(sql`clock_timestamp()`),
});
export const supportTag = appSchema.table('support_tag',{
 id:uuid('id').primaryKey().defaultRandom(),slug:text('slug').notNull().unique(),label:text('label').notNull(),enabled:boolean('enabled').notNull().default(true),revision:integer('revision').notNull().default(1),actorId:text('actor_id').notNull(),updatedAt:instant('updated_at').notNull().default(sql`clock_timestamp()`),
});
export const supportConversationTag = appSchema.table('support_conversation_tag',{
 conversationId:uuid('conversation_id').notNull().references(()=>supportConversation.id,{onDelete:'restrict'}),tagId:uuid('tag_id').notNull().references(()=>supportTag.id,{onDelete:'restrict'}),actorId:text('actor_id').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[primaryKey({columns:[t.conversationId,t.tagId]})]);
export const supportInAppNotification = appSchema.table('support_in_app_notification',{
 id:uuid('id').primaryKey().defaultRandom(),recipientScope:text('recipient_scope').notNull(),eventKey:text('event_key').notNull(),conversationId:uuid('conversation_id'),kind:text('kind').notNull(),title:text('title').notNull(),summary:text('summary').notNull(),state:text('state').notNull().default('unread'),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),updatedAt:instant('updated_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('support_in_app_notification_unique').on(t.recipientScope,t.eventKey)]);
export const supportChallenge = appSchema.table('support_challenge',{
 id:uuid('id').primaryKey().defaultRandom(),kind:text('kind').notNull(),actorScope:text('actor_scope').notNull(),targetReference:text('target_reference').notNull(),orderId:uuid('order_id'),conversationId:uuid('conversation_id'),codeDigest:text('code_digest').notNull(),attempts:integer('attempts').notNull().default(0),verifiedAt:instant('verified_at'),expiresAt:instant('expires_at').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[index('support_challenge_scope_idx').on(t.actorScope)]);

export const buyerProfile = appSchema.table('buyer_profile',{
 userId:text('user_id').primaryKey().references(()=>user.id,{onDelete:'restrict'}),displayName:text('display_name').notNull(),phone:text('phone'),phoneVerifiedAt:instant('phone_verified_at'),email:text('email'),addressBookRevision:integer('address_book_revision').notNull().default(0),defaultAddressId:uuid('default_address_id'),revision:integer('revision').notNull().default(1),updatedAt:instant('updated_at').notNull().default(sql`clock_timestamp()`),
});
export const buyerAddress = appSchema.table('buyer_address',{
 id:uuid('id').primaryKey().defaultRandom(),userId:text('user_id').notNull().references(()=>user.id,{onDelete:'restrict'}),label:text('label').notNull(),recipientName:text('recipient_name').notNull(),phone:text('phone').notNull(),street:text('street').notNull(),province:text('province').notNull(),city:text('city').notNull(),district:text('district').notNull(),subdistrict:text('subdistrict').notNull(),postcode:text('postcode').notNull(),destinationCode:text('destination_code').notNull(),rtRw:text('rt_rw'),landmark:text('landmark'),isDefault:boolean('is_default').notNull().default(false),deletedAt:instant('deleted_at'),revision:integer('revision').notNull().default(1),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),updatedAt:instant('updated_at').notNull().default(sql`clock_timestamp()`),
});
export const buyerIdentityChallenge = appSchema.table('buyer_identity_challenge',{
 id:uuid('id').primaryKey().defaultRandom(),userId:text('user_id').notNull().references(()=>user.id,{onDelete:'restrict'}),kind:text('kind').notNull(),channel:text('channel').notNull(),targetValue:text('target_value').notNull(),orderId:uuid('order_id'),codeDigest:text('code_digest').notNull(),attempts:integer('attempts').notNull().default(0),status:text('status').notNull().default('pending'),verifiedAt:instant('verified_at'),expiresAt:instant('expires_at').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
});
export const buyerNotificationPreference = appSchema.table('buyer_notification_preference',{
 userId:text('user_id').primaryKey().references(()=>user.id,{onDelete:'restrict'}),orderUpdatesInApp:boolean('order_updates_in_app').notNull().default(true),orderUpdatesEmail:boolean('order_updates_email').notNull().default(true),supportRepliesInApp:boolean('support_replies_in_app').notNull().default(true),promotionsInApp:boolean('promotions_in_app').notNull().default(false),revision:integer('revision').notNull().default(1),updatedAt:instant('updated_at').notNull().default(sql`clock_timestamp()`),
});
export const returnEvidence = appSchema.table('return_evidence',{
 id:uuid('id').primaryKey().defaultRandom(),caseId:uuid('case_id').notNull().references(()=>returnCase.id,{onDelete:'restrict'}),orderId:uuid('order_id').notNull().references(()=>commerceOrder.id,{onDelete:'restrict'}),uploaderScope:text('uploader_scope').notNull(),contentType:text('content_type').notNull(),byteSize:integer('byte_size').notNull(),sha256:text('sha256').notNull(),storageKey:text('storage_key').notNull(),status:text('status').notNull().default('pending_upload'),expiresAt:instant('expires_at').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
});

export const shippingLabelTemplate = appSchema.table('shipping_label_template',{
 id:uuid('id').primaryKey().defaultRandom(),code:text('code').notNull().unique(),carrierCode:text('carrier_code').notNull(),serviceCode:text('service_code').notNull(),format:text('format').notNull(),brandMode:text('brand_mode').notNull(),privacyMode:text('privacy_mode').notNull(),activeRevision:integer('active_revision').notNull().default(1),enabled:boolean('enabled').notNull().default(true),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),updatedAt:instant('updated_at').notNull().default(sql`clock_timestamp()`),
});
export const shippingLabelTemplateVersion = appSchema.table('shipping_label_template_version',{
 id:uuid('id').primaryKey().defaultRandom(),templateId:uuid('template_id').notNull().references(()=>shippingLabelTemplate.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),rendererVersion:text('renderer_version').notNull(),permissionEvidence:text('permission_evidence').notNull(),disclosureText:text('disclosure_text').notNull(),actorId:text('actor_id').notNull(),reason:text('reason').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('shipping_label_template_ver_unique').on(t.templateId,t.revision)]);
export const shippingLabelJob = appSchema.table('shipping_label_job',{
 id:uuid('id').primaryKey().defaultRandom(),shipmentId:uuid('shipment_id').notNull().references(()=>orderShipment.id,{onDelete:'restrict'}),fulfillmentId:uuid('fulfillment_id').notNull().references(()=>fulfillment.id,{onDelete:'restrict'}),bookingId:uuid('booking_id').notNull().references(()=>shipmentBooking.id,{onDelete:'restrict'}),warehouseId:uuid('warehouse_id').notNull().references(()=>warehouse.id,{onDelete:'restrict'}),trackingNumber:text('tracking_number').notNull(),templateVersionId:uuid('template_version_id').notNull().references(()=>shippingLabelTemplateVersion.id,{onDelete:'restrict'}),format:text('format').notNull(),status:text('status').notNull().default('succeeded'),operationId:uuid('operation_id').notNull().unique(),artifactId:uuid('artifact_id'),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),updatedAt:instant('updated_at').notNull().default(sql`clock_timestamp()`),
});
export const shippingLabelArtifact = appSchema.table('shipping_label_artifact',{
 id:uuid('id').primaryKey().defaultRandom(),labelJobId:uuid('label_job_id').notNull().references(()=>shippingLabelJob.id,{onDelete:'restrict'}),shipmentId:uuid('shipment_id').notNull().references(()=>orderShipment.id,{onDelete:'restrict'}),warehouseId:uuid('warehouse_id').notNull().references(()=>warehouse.id,{onDelete:'restrict'}),trackingNumber:text('tracking_number').notNull(),format:text('format').notNull(),storageKey:text('storage_key').notNull(),sha256:text('sha256').notNull(),byteSize:integer('byte_size').notNull(),pageCount:integer('page_count').notNull().default(1),status:text('status').notNull().default('valid'),snapshot:jsonb('snapshot').notNull(),expiresAt:instant('expires_at').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[
 // S104: print-queue rank probe (valid artifact per shipment) and the page's artifact lookup by shipment.
 index('shipping_label_artifact_shipment_idx').on(t.shipmentId,t.status),
]);
export const shippingPrintBatch = appSchema.table('shipping_print_batch',{
 id:uuid('id').primaryKey().defaultRandom(),warehouseId:uuid('warehouse_id').notNull().references(()=>warehouse.id,{onDelete:'restrict'}),actorId:text('actor_id').notNull(),format:text('format').notNull(),status:text('status').notNull(),summary:jsonb('summary').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
});
export const shippingPrintBatchItem = appSchema.table('shipping_print_batch_item',{
 batchId:uuid('batch_id').notNull().references(()=>shippingPrintBatch.id,{onDelete:'restrict'}),shipmentId:uuid('shipment_id').notNull().references(()=>orderShipment.id,{onDelete:'restrict'}),ordinal:integer('ordinal').notNull(),labelJobId:uuid('label_job_id'),artifactId:uuid('artifact_id'),outcome:text('outcome').notNull(),reason:text('reason').notNull(),
},t=>[primaryKey({columns:[t.batchId,t.shipmentId]})]);
export const shippingPrintAttempt = appSchema.table('shipping_print_attempt',{
 id:uuid('id').primaryKey().defaultRandom(),shipmentId:uuid('shipment_id').notNull().references(()=>orderShipment.id,{onDelete:'restrict'}),artifactId:uuid('artifact_id').notNull().references(()=>shippingLabelArtifact.id,{onDelete:'restrict'}),warehouseId:uuid('warehouse_id').notNull().references(()=>warehouse.id,{onDelete:'restrict'}),actorId:text('actor_id').notNull(),kind:text('kind').notNull(),reportedOutcome:text('reported_outcome').notNull(),reason:text('reason').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
});

export const adminExportSelection = appSchema.table('admin_export_selection',{
 id:uuid('id').primaryKey().defaultRandom(),actorId:text('actor_id').notNull().references(()=>user.id,{onDelete:'restrict'}),scope:text('scope').notNull(),filterHash:text('filter_hash').notNull(),rowIds:jsonb('row_ids').notNull(),tokenDigest:text('token_digest').notNull().unique(),expiresAt:instant('expires_at').notNull(),consumedAt:instant('consumed_at'),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
});
export const adDestinationConfig = appSchema.table('ad_destination_config',{
 id:uuid('id').primaryKey().defaultRandom(),platform:text('platform').notNull().unique(),destinationVersion:text('destination_version').notNull().default('local-sink-v1'),paused:boolean('paused').notNull().default(false),publicIdentifier:text('public_identifier').notNull(),secretReference:text('secret_reference').notNull(),revision:integer('revision').notNull().default(1),actorId:text('actor_id'),reason:text('reason').notNull(),updatedAt:instant('updated_at').notNull().default(sql`clock_timestamp()`),
});
export const adDestinationVersion = appSchema.table('ad_destination_version',{
 id:uuid('id').primaryKey().defaultRandom(),destinationId:uuid('destination_id').notNull().references(()=>adDestinationConfig.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),platform:text('platform').notNull(),destinationVersion:text('destination_version').notNull(),paused:boolean('paused').notNull(),publicIdentifier:text('public_identifier').notNull(),secretReference:text('secret_reference').notNull(),actorId:text('actor_id').notNull(),reason:text('reason').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('ad_destination_version_rev_unique').on(t.destinationId,t.revision)]);

// DEC-007 / S91 manual consignment fulfillment. Pickup profile rows hold personal
// data (street address, PIC name/phone): private admin reads only, append-only.
export const warehousePickupProfile = appSchema.table('warehouse_pickup_profile',{
 id:uuid('id').primaryKey().defaultRandom(),warehouseId:uuid('warehouse_id').notNull().references(()=>warehouse.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),
 streetAddress:text('street_address'),picName:text('pic_name'),picPhone:text('pic_phone'),latitudeE6:integer('latitude_e6'),longitudeE6:integer('longitude_e6'),
 actorId:text('actor_id').notNull(),reason:text('reason').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('warehouse_pickup_profile_revision_unique').on(t.warehouseId,t.revision),check('warehouse_pickup_profile_value_check',sql`${t.revision}>0 AND (${t.streetAddress} IS NULL OR char_length(${t.streetAddress}) between 10 and 300) AND (${t.picName} IS NULL OR char_length(${t.picName}) between 2 and 120) AND (${t.picPhone} IS NULL OR ${t.picPhone} ~ '^62[1-9][0-9]{7,12}$') AND ((${t.latitudeE6} IS NULL)=(${t.longitudeE6} IS NULL)) AND (${t.latitudeE6} IS NULL OR (${t.latitudeE6} between -11000000 and 6000000 AND ${t.longitudeE6} between 95000000 and 141000000)) AND char_length(${t.reason}) between 1 and 200`)]);
export const manualTracking = appSchema.table('manual_tracking',{
 id:uuid('id').primaryKey().defaultRandom(),fulfillmentId:uuid('fulfillment_id').notNull().references(()=>fulfillment.id,{onDelete:'restrict'}),version:integer('version').notNull(),courier:text('courier').notNull(),trackingNumber:text('tracking_number').notNull(),
 unitIds:jsonb('unit_ids').notNull(),fulfillmentEventId:uuid('fulfillment_event_id').notNull().unique().references(()=>fulfillmentEvent.id,{onDelete:'restrict'}),actorId:text('actor_id').notNull(),reason:text('reason').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('manual_tracking_version_unique').on(t.fulfillmentId,t.version),index('manual_tracking_number_idx').on(t.trackingNumber),check('manual_tracking_value_check',sql`${t.version}>0 AND ${t.courier} IN ('jne','jnt','sicepat','sap','ninja','anteraja','idexpress','lion','pos') AND ${t.trackingNumber} ~ '^[A-Z0-9][A-Z0-9-]{7,39}$' AND jsonb_typeof(${t.unitIds})='array' AND jsonb_array_length(${t.unitIds}) between 1 and 100 AND char_length(${t.reason}) between 1 and 200`)]);
export const fulfillmentPurchaseReference = appSchema.table('fulfillment_purchase_reference',{
 id:uuid('id').primaryKey().defaultRandom(),fulfillmentId:uuid('fulfillment_id').notNull().references(()=>fulfillment.id,{onDelete:'restrict'}),version:integer('version').notNull(),reference:text('reference').notNull(),
 actorId:text('actor_id').notNull(),reason:text('reason').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('fulfillment_purchase_reference_version_unique').on(t.fulfillmentId,t.version),check('fulfillment_purchase_reference_value_check',sql`${t.version}>0 AND ${t.reference} ~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{1,79}$' AND char_length(${t.reason}) between 1 and 200`)]);
export const localTrackingObservation = appSchema.table('local_tracking_observation',{
 id:uuid('id').primaryKey().defaultRandom(),environment:text('environment').notNull(),courier:text('courier').notNull(),trackingNumber:text('tracking_number').notNull(),providerStatus:text('provider_status').notNull(),occurredAt:instant('occurred_at').notNull(),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[index('local_tracking_observation_number_idx').on(t.environment,t.trackingNumber,t.occurredAt),check('local_tracking_observation_value_check',sql`${t.environment} IN ('local','test') AND ${t.trackingNumber} ~ '^[A-Z0-9][A-Z0-9-]{7,39}$' AND ${t.providerStatus} ~ '^[A-Z_]{2,40}$'`)]);
export const shipmentTrackingEvent = appSchema.table('shipment_tracking_event',{
 id:uuid('id').primaryKey().defaultRandom(),fulfillmentId:uuid('fulfillment_id').notNull().references(()=>fulfillment.id,{onDelete:'restrict'}),trackingId:uuid('tracking_id').notNull().references(()=>manualTracking.id,{onDelete:'restrict'}),status:text('status').notNull(),sourceKind:text('source_kind').notNull(),adapter:text('adapter'),providerStatus:text('provider_status'),
 occurredAt:instant('occurred_at').notNull(),actorId:text('actor_id'),reason:text('reason'),evidence:text('evidence'),receiptSourceId:uuid('receipt_source_id').references(()=>localParcelReceipt.id,{onDelete:'restrict'}),recordedAt:instant('recorded_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('shipment_tracking_event_status_unique').on(t.fulfillmentId,t.status),check('shipment_tracking_event_value_check',sql`${t.status} IN ('picked_up','in_transit','delivered','failed') AND ((${t.sourceKind}='adapter' AND ${t.adapter} IN ('simulated','mengantar') AND ${t.actorId} IS NULL) OR (${t.sourceKind}='operator' AND ${t.adapter} IS NULL AND ${t.actorId} IS NOT NULL AND char_length(${t.reason}) between 1 and 200 AND char_length(${t.evidence}) between 1 and 500)) AND (${t.providerStatus} IS NULL OR ${t.providerStatus} ~ '^[A-Z_]{2,40}$') AND ((${t.status}='delivered')=(${t.receiptSourceId} IS NOT NULL))`)]);
// Finance-recorded Mengantar COD settlement statement (DEC-007): sources only;
// money posts through the existing COD collection and settlement journals.
export const codRemittance = appSchema.table('cod_remittance',{
 id:uuid('id').primaryKey(),reference:text('reference').notNull(),environment:text('environment').notNull(),settlementOperationId:uuid('settlement_operation_id').notNull().unique().references(()=>localSettlementOperation.id,{onDelete:'restrict'}),
 grossAmount:bigint('gross_amount',{mode:'number'}).notNull(),shippingDeduction:bigint('shipping_deduction',{mode:'number'}).notNull(),codFeeDeduction:bigint('cod_fee_deduction',{mode:'number'}).notNull(),otherDeduction:bigint('other_deduction',{mode:'number'}).notNull(),netAmount:bigint('net_amount',{mode:'number'}).notNull(),
 statementAt:instant('statement_at').notNull(),evidence:text('evidence').notNull(),matchJobId:uuid('match_job_id').notNull().unique().references(()=>outboxJob.id,{onDelete:'restrict'}),actorId:text('actor_id').notNull(),reason:text('reason').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('cod_remittance_reference_unique').on(t.environment,t.reference),check('cod_remittance_value_check',sql`${t.environment} IN ('local','test','production') AND ${t.reference} ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,79}$' AND ${t.grossAmount} between 1 and 9007199254740991 AND ${t.shippingDeduction}>=0 AND ${t.codFeeDeduction}>=0 AND ${t.otherDeduction}>=0 AND ${t.netAmount} between 0 and 9007199254740991 AND char_length(${t.evidence}) between 1 and 500 AND char_length(${t.reason}) between 1 and 200`)]);
export const codRemittanceLine = appSchema.table('cod_remittance_line',{
 remittanceId:uuid('remittance_id').notNull().references(()=>codRemittance.id,{onDelete:'restrict'}),shipmentId:uuid('shipment_id').notNull().references(()=>orderShipment.id,{onDelete:'restrict'}),ordinal:integer('ordinal').notNull(),
 amount:bigint('amount',{mode:'number'}).notNull(),expectedAmount:bigint('expected_amount',{mode:'number'}).notNull(),codOperationId:uuid('cod_operation_id').notNull().unique().references(()=>localCodOperation.id,{onDelete:'restrict'}),
},t=>[primaryKey({columns:[t.remittanceId,t.shipmentId]}),unique('cod_remittance_line_ordinal_unique').on(t.remittanceId,t.ordinal),check('cod_remittance_line_value_check',sql`${t.ordinal} between 1 and 100 AND ${t.amount} between 1 and 9007199254740991 AND ${t.expectedAmount} between 0 and 9007199254740991`)]);
// DEC-008 / S92: finance-confirmed manual bank transfer for one payment attempt.
// The source of money is the local payment operation it confirms (existing journals).
export const manualBankConfirmation = appSchema.table('manual_bank_confirmation',{
 attemptId:uuid('attempt_id').primaryKey().references(()=>paymentAttempt.id,{onDelete:'restrict'}),operationId:uuid('operation_id').notNull().unique().references(()=>localPaymentOperation.id,{onDelete:'restrict'}),
 amount:bigint('amount',{mode:'number'}).notNull(),bankReference:text('bank_reference').notNull(),transferredAt:instant('transferred_at').notNull(),evidence:text('evidence').notNull(),
 actorId:text('actor_id').notNull(),reason:text('reason').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('manual_bank_confirmation_value_check',sql`${t.amount} between 1 and 9007199254740991 AND ${t.bankReference} ~ '^[A-Za-z0-9][A-Za-z0-9_./:-]{2,79}$' AND char_length(${t.evidence}) between 1 and 500 AND char_length(${t.reason}) between 1 and 200`)]);
// R4 review (S92): one bank statement line confirms at most one manual-bank order. The
// normalised reference is unique per receiving company account (the order's pinned policy).
export const manualBankReference = appSchema.table('manual_bank_reference',{
 accountNumber:text('account_number').notNull(),referenceKey:text('reference_key').notNull(),
 attemptId:uuid('attempt_id').notNull().unique().references(()=>manualBankConfirmation.attemptId,{onDelete:'restrict'}),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[primaryKey({name:'manual_bank_reference_pk',columns:[t.accountNumber,t.referenceKey]}),check('manual_bank_reference_value_check',sql`${t.accountNumber} ~ '^[0-9]{6,20}$' AND ${t.referenceKey} ~ '^[A-Z0-9][A-Z0-9_./:-]{2,79}$'`)]);
// DEC-008 / S93: AutoLaris payment on a local simulated contract. Our side keeps
// the request identity (reff_id persisted before the call) and the one response;
// observations are append-only advice reads or audited manual confirmations;
// callbacks are raw discovery rows that never change payment state.
export const autolarisPayment = appSchema.table('autolaris_payment',{
 attemptId:uuid('attempt_id').primaryKey().references(()=>paymentAttempt.id,{onDelete:'restrict'}),operationId:uuid('operation_id').unique().references(()=>localPaymentOperation.id,{onDelete:'restrict'}),
 environment:text('environment').notNull(),reffId:text('reff_id').notNull(),channelCode:text('channel_code').notNull(),requestedAmount:bigint('requested_amount',{mode:'number'}).notNull(),
 trxId:text('trx_id'),instructionKind:text('instruction_kind'),instructionValue:text('instruction_value'),providerAmount:bigint('provider_amount',{mode:'number'}),adminFee:bigint('admin_fee',{mode:'number'}),providerTotal:bigint('provider_total',{mode:'number'}),
 refusalCode:text('refusal_code'),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),respondedAt:instant('responded_at'),
},t=>[unique('autolaris_payment_reff_unique').on(t.environment,t.reffId),unique('autolaris_payment_trx_unique').on(t.environment,t.trxId),
 check('autolaris_payment_value_check',sql`${t.environment} IN ('local','test','production') AND ${t.reffId} ~ '^[A-Za-z0-9_-]{8,64}$' AND ${t.channelCode} ~ '^[A-Z0-9_]{2,20}$' AND ${t.requestedAmount} between 1 and 9007199254740991
  AND ((${t.respondedAt} IS NULL AND ${t.trxId} IS NULL AND ${t.instructionKind} IS NULL AND ${t.instructionValue} IS NULL AND ${t.providerAmount} IS NULL AND ${t.adminFee} IS NULL AND ${t.providerTotal} IS NULL AND ${t.refusalCode} IS NULL)
   OR (${t.respondedAt} IS NOT NULL AND ${t.operationId} IS NOT NULL AND ${t.trxId} ~ '^[A-Za-z0-9_-]{1,64}$' AND ${t.instructionKind} IN ('virtual_account','qr','payment_code','url') AND char_length(${t.instructionValue}) between 1 and 2048
    AND ${t.providerAmount} between 1 and 9007199254740991 AND ${t.adminFee} between 0 and 9007199254740991 AND ${t.providerTotal} between 1 and 9007199254740991
    AND (${t.refusalCode} IS NULL OR ${t.refusalCode} IN ('AUTOLARIS_TOTAL_MISMATCH','AUTOLARIS_AMOUNT_MISMATCH'))
    AND (${t.refusalCode} IS NOT NULL OR (${t.providerAmount}=${t.requestedAmount} AND ${t.providerTotal}=${t.requestedAmount}))))`)]);
export const autolarisObservation = appSchema.table('autolaris_observation',{
 id:uuid('id').primaryKey().defaultRandom(),attemptId:uuid('attempt_id').notNull().references(()=>autolarisPayment.attemptId,{onDelete:'restrict'}),source:text('source').notNull(),
 rc:text('rc'),ket:text('ket'),classification:text('classification').notNull(),amount:bigint('amount',{mode:'number'}),occurredAt:instant('occurred_at').notNull(),
 actorId:text('actor_id'),reason:text('reason'),evidence:text('evidence'),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[index('autolaris_observation_attempt_idx').on(t.attemptId,t.createdAt),uniqueIndex('autolaris_observation_settled_unique').on(t.attemptId).where(sql`${t.classification}='settled'`),
 check('autolaris_observation_value_check',sql`${t.source} IN ('advice','manual') AND ${t.classification} IN ('pending','settled','unknown','failed')
  AND (${t.classification}='settled')=(${t.amount} IS NOT NULL) AND (${t.amount} IS NULL OR ${t.amount} between 1 and 9007199254740991)
  AND ((${t.source}='advice' AND ${t.actorId} IS NULL AND ${t.reason} IS NULL AND ${t.evidence} IS NULL AND char_length(${t.rc}) between 1 and 8 AND char_length(${t.ket}) between 0 and 120)
   OR (${t.source}='manual' AND ${t.classification}='settled' AND ${t.rc} IS NULL AND ${t.ket} IS NULL AND ${t.actorId} IS NOT NULL AND char_length(${t.reason}) between 1 and 200 AND char_length(${t.evidence}) between 1 and 500))`)]);
export const autolarisCallback = appSchema.table('autolaris_callback',{
 id:uuid('id').primaryKey().defaultRandom(),contentType:text('content_type').notNull(),body:text('body').notNull(),bodySha256:text('body_sha256').notNull(),receivedAt:instant('received_at').notNull().default(sql`clock_timestamp()`),redactedAt:instant('redacted_at'),
},t=>[index('autolaris_callback_received_idx').on(t.receivedAt),check('autolaris_callback_value_check',sql`char_length(${t.contentType}) between 0 and 120 AND octet_length(${t.body}) between 0 and 16384 AND ${t.bodySha256} ~ '^[0-9a-f]{64}$' AND (${t.redactedAt} IS NULL OR ${t.body}='')`)]);
// Host-only simulator of the AutoLaris account: provider-side transactions keyed by reff_id.
export const localAutolarisTransaction = appSchema.table('local_autolaris_transaction',{
 trxId:text('trx_id').primaryKey(),environment:text('environment').notNull(),reffId:text('reff_id').notNull(),channelCode:text('channel_code').notNull(),amount:bigint('amount',{mode:'number'}).notNull(),
 adminFee:bigint('admin_fee',{mode:'number'}).notNull(),total:bigint('total',{mode:'number'}).notNull(),instructionKind:text('instruction_kind').notNull(),instructionValue:text('instruction_value').notNull(),
 status:text('status').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),paidAt:instant('paid_at'),
},t=>[unique('local_autolaris_transaction_reff_unique').on(t.environment,t.reffId),check('local_autolaris_transaction_value_check',sql`${t.environment} IN ('local','test') AND ${t.status} IN ('pending','paid','expired','generic_success')
  AND ${t.amount}>0 AND ${t.adminFee}>=0 AND ${t.total}>0 AND (${t.status}='paid')=(${t.paidAt} IS NOT NULL)`)]);
// S110 home promo banners: a permanent identity whose revision only advances with an appended,
// immutable version (create, revise, reorder, retire). Images are catalog media (DEC-005) referenced
// by SHA-256; links are internal storefront paths only (no external links or tracking pixels).
export const homeBanner = appSchema.table('home_banner',{
 id:uuid('id').primaryKey().defaultRandom(),revision:integer('revision').notNull().default(0),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[check('home_banner_revision_check',sql`${t.revision}>=0`)]);
export const homeBannerVersion = appSchema.table('home_banner_version',{
 id:uuid('id').primaryKey().defaultRandom(),bannerId:uuid('banner_id').notNull().references(()=>homeBanner.id,{onDelete:'restrict'}),revision:integer('revision').notNull(),
 title:text('title').notNull(),subtitle:text('subtitle'),actionLabel:text('action_label').notNull(),href:text('href').notNull(),
 imageSha256:text('image_sha256').notNull(),imageWidth:integer('image_width').notNull(),imageHeight:integer('image_height').notNull(),imageAlt:text('image_alt').notNull(),tint:text('tint'),
 startsAt:instant('starts_at').notNull(),endsAt:instant('ends_at').notNull(),position:integer('position').notNull(),active:boolean('active').notNull(),retired:boolean('retired').notNull().default(false),
 actorId:text('actor_id').notNull(),reason:text('reason').notNull(),createdAt:instant('created_at').notNull().default(sql`clock_timestamp()`),
},t=>[unique('home_banner_version_unique').on(t.bannerId,t.revision),
 check('home_banner_version_text_check',sql`${t.revision}>0 AND char_length(${t.title}) between 1 and 60 AND (${t.subtitle} IS NULL OR char_length(${t.subtitle}) between 1 and 140)
  AND char_length(${t.actionLabel}) between 1 and 24 AND char_length(${t.imageAlt}) between 1 and 160 AND char_length(${t.reason}) between 1 and 500`),
 check('home_banner_version_href_check',sql`${t.href} ~ '^/(promo|kategori|kategori/[a-z0-9-]{1,80}|cari|produk/[a-z0-9-]{1,160})([?][A-Za-z0-9_.~%=&+*-]+)?$' AND char_length(${t.href})<=400`),
 check('home_banner_version_image_check',sql`${t.imageSha256} ~ '^[0-9a-f]{64}$' AND ${t.imageWidth} between 1 and 16384 AND ${t.imageHeight} between 1 and 16384
  AND (${t.tint} IS NULL OR ${t.tint} IN ('amber','slate','rose','blue','green','violet','teal'))`),
 check('home_banner_version_window_check',sql`${t.startsAt}<${t.endsAt} AND ${t.position} between 0 and 999 AND NOT (${t.retired} AND ${t.active})`),
]);
