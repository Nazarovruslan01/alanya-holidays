import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateProductOrderDto } from './dto/create-product-order.dto';
import { GetShopCatalogQueryDto } from './dto/get-shop-catalog-query.dto';

export interface ProductCategoryRow {
  id: number;
  name: string;
  sort_order: number;
  created_at?: string;
}

export interface ProductItemRow {
  id: number;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  stock: number;
  status: string;
  media: Array<{ url: string; type: string }> | null;
  category_id: number | null;
  product_categories: { id?: number; name: string } | null;
  variant_count?: number;
  created_at: string;
  updated_at?: string;
}

export interface ProductSkuRow {
  id: number;
  product_id: number;
  label: string;
  options: Record<string, string>;
  price: number;
  stock: number;
  created_at?: string;
}

export interface ProductOrderRow {
  id: number;
  user_id: string;
  total_amount: number;
  currency: string;
  status: string;
  shipping_address: Record<string, unknown>;
  payment_intent_id: string | null;
  created_at: string;
}

export interface ProductOrderItemRow {
  id: number;
  order_id: number;
  product_id: number;
  quantity: number;
  unit_price: number;
  created_at?: string;
}

export interface ProductDetailResult {
  product: ProductItemRow | null;
  variants: unknown[];
  skus: ProductSkuRow[];
}

export interface ShopCatalogResult {
  products: ProductItemRow[];
  categories: ProductCategoryRow[];
}

export interface CreateOrderResult {
  success: boolean;
  orderId: number;
  message: string;
  status?: string;
  expiresAt?: string;
  guestAccessToken?: string;
}

export interface OnlinePaymentPreparation {
  id: number;
  currency: string;
  total_amount: number;
  recipient: { email?: string } | null;
  delivery_quote_confirmed_at: string;
  checkout_expires_at: string;
}

export interface CatalogItemRow {
  id: number;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  stock: number;
  status: string;
  media: Array<{ url: string; type: string }> | null;
  category_id: number | null;
  seller_id: string | null;
  created_at: string;
  updated_at?: string;
  product_categories?: { id: number; name: string } | null;
}

@Injectable()
export class ProductsRepository {
  private readonly logger = new Logger(ProductsRepository.name);

  // Shared projection for order headers with their line items.
  private static readonly ORDER_SELECT = `
        id,
        currency,
        payment_provider,
        status,
        subtotal_items,
        customer_notes,
        customer_id,
        recipient,
        reservation_expires_at,
        delivery_fee,
        delivery_eta,
        delivery_quote_confirmed_at,
        total_amount,
        stripe_session_expires_at,
        payment_received_at,
        payment_reconciliation_status,
        created_at,
        updated_at,
        items:order_items(
          id,
          order_id,
          product_id,
          product_name,
          sku_id,
          sku_label,
          quantity,
          unit_price,
          final_price,
          subtotal,
          created_at
        )
      `;

  // Seller projection intentionally excludes whole-order totals, notes,
  // customer identity, payment metadata, and non-fulfillment recipient data.
  private static readonly SELLER_ORDER_SELECT = `
        id,
        currency,
        status,
        recipient,
        created_at,
        items:order_items!inner(
          id,
          product_id,
          product_name,
          sku_label,
          quantity,
          subtotal
        )
      `;

  constructor(private readonly supabaseService: SupabaseService) {}

  get client() {
    return this.supabaseService.getClient();
  }

  private isValidUuid(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      id,
    );
  }

  async insertProduct(productData: Record<string, unknown>) {
    const { data, error } = await this.client
      .from('products')
      .insert([productData])
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async getProducts(category?: string, page = 1, limit = 20) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    let query = this.client.from('products').select(`
        id, 
        title, 
        description, 
        price, 
        stock, 
        category, 
        images, 
        seller_id, 
        created_at,
        seller:profiles!products_seller_id_fkey(full_name)
    `);

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query
      .order('created_at', {
        ascending: false,
      })
      .order('id', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return data;
  }

  async getProductsAdmin(
    categoryId?: number,
    page = 1,
    limit = 20,
    search?: string,
  ) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    let query = this.client.from('product_items').select(
      `
        id,
        name,
        description,
        price,
        currency,
        stock,
        status,
        media,
        category_id,
        seller_id,
        created_at,
        updated_at,
        product_categories(id, name)
      `,
      { count: 'exact' },
    );

    if (categoryId) query = query.eq('category_id', categoryId);
    const safeSearch = search
      ?.trim()
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_')
      .replace(/,/g, ' ');
    if (safeSearch) {
      query = query.or(
        `name.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%`,
      );
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return { items: data ?? [], page, limit, total: count ?? 0 };
  }

  async getCatalogItemAdmin(itemId: number): Promise<CatalogItemRow | null> {
    const { data, error } = await this.client
      .from('product_items')
      .select(
        'id, name, description, price, currency, stock, status, media, category_id, seller_id, created_at, updated_at, product_categories(id, name)',
      )
      .eq('id', itemId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data as unknown as CatalogItemRow | null;
  }

  async createCatalogItemAdmin(
    item: Record<string, unknown>,
  ): Promise<CatalogItemRow> {
    const { data, error } = await this.client
      .from('product_items')
      .insert(item)
      .select(
        'id, name, description, price, currency, stock, status, media, category_id, seller_id, created_at, updated_at',
      )
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateCatalogItemAdmin(
    itemId: number,
    updates: Record<string, unknown>,
  ): Promise<CatalogItemRow | null> {
    const { data, error } = await this.client
      .from('product_items')
      .update(updates)
      .eq('id', itemId)
      .select(
        'id, name, description, price, currency, stock, status, media, category_id, seller_id, created_at, updated_at',
      )
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  }

  async deleteCatalogItemAdmin(itemId: number): Promise<{ id: number } | null> {
    const { data, error } = await this.client
      .from('product_items')
      .delete()
      .eq('id', itemId)
      .select('id')
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  }

  async getProductById(id: string) {
    if (!this.isValidUuid(id)) return null;

    const { data, error } = await this.client
      .from('products')
      .select(
        `
          id, 
          title, 
          description, 
          price, 
          stock, 
          category, 
          images, 
          seller_id, 
          created_at,
          seller:profiles!products_seller_id_fkey(full_name)
      `,
      )
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || error.code === '22P02') return null;
      throw new Error(error.message);
    }
    return data;
  }

  async getProductOwnership(productId: string) {
    if (!this.isValidUuid(productId)) return null;

    const { data, error } = await this.client
      .from('products')
      .select('seller_id, artisan_id')
      .eq('id', productId)
      .single();

    if (error) {
      if (error.code === 'PGRST116' || error.code === '22P02') return null;
      throw new Error(error.message);
    }
    return data;
  }

  async updateProduct(id: string, updates: Record<string, unknown>) {
    if (!this.isValidUuid(id)) return;

    const { error } = await this.client
      .from('products')
      .update(updates)
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  async deleteProduct(id: string) {
    if (!this.isValidUuid(id)) return;

    const { error } = await this.client.from('products').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async getProductVariants(productId: string, page = 1, limit = 20) {
    if (!this.isValidUuid(productId)) return [];
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error } = await this.client
      .from('product_variants')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);

    if (error) {
      if (error.code === 'PGRST116' || error.code === '22P02') return [];
      throw new Error(error.message);
    }
    return data ?? [];
  }

  async insertProductVariant(variantData: Record<string, unknown>) {
    const { data, error } = await this.client
      .from('product_variants')
      .insert([variantData])
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async getVariantProductId(variantId: string): Promise<string | null> {
    if (!this.isValidUuid(variantId)) return null;

    const { data } = await this.client
      .from('product_variants')
      .select('product_id')
      .eq('id', variantId)
      .single();
    return (data?.product_id as string | undefined) ?? null;
  }

  async updateProductVariant(
    variantId: string,
    updates: Record<string, unknown>,
  ) {
    if (!this.isValidUuid(variantId)) return;

    const { error } = await this.client
      .from('product_variants')
      .update(updates)
      .eq('id', variantId);
    if (error) throw new Error(error.message);
  }

  async deleteProductVariant(variantId: string) {
    if (!this.isValidUuid(variantId)) return;

    const { error } = await this.client
      .from('product_variants')
      .delete()
      .eq('id', variantId);
    if (error) throw new Error(error.message);
  }

  // --- Shop Catalog & Orders System ---

  async getFeaturedProducts(limit = 8): Promise<ProductItemRow[]> {
    try {
      const categories = await this.getShopCategories();
      const giftCardCategory = categories.find(
        (category) => category.name === 'Gift Cards',
      );
      let query = this.client
        .from('product_items')
        .select(
          'id, name, description, price, currency, stock, media, category_id, status, created_at, product_categories(id, name)',
        )
        .eq('status', 'active');

      if (giftCardCategory) {
        query = query.or(
          'category_id.is.null,category_id.neq.' + giftCardCategory.id,
        );
      }

      const { data, error } = await query
        .limit(limit)
        .order('created_at', { ascending: false });

      if (error) throw new Error(error.message);
      return (data as unknown as ProductItemRow[]) ?? [];
    } catch {
      return [];
    }
  }

  async getShopCategories(): Promise<ProductCategoryRow[]> {
    const { data, error } = await this.client
      .from('product_categories')
      .select('id, name, sort_order, created_at')
      .order('sort_order', { ascending: true });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async getShopCatalog(
    query?: GetShopCatalogQueryDto,
  ): Promise<ShopCatalogResult> {
    const categories = await this.getShopCategories();
    const giftCardCategory = categories.find(
      (category) => category.name === 'Gift Cards',
    );
    let productsQuery = this.client
      .from('product_items')
      .select(
        'id, name, description, price, currency, stock, media, category_id, status, created_at, product_categories(id, name)',
      )
      .eq('status', 'active');

    if (giftCardCategory) {
      productsQuery = productsQuery.or(
        'category_id.is.null,category_id.neq.' + giftCardCategory.id,
      );
    }

    if (query?.category) {
      const categoryNum = Number(query.category);
      if (!Number.isNaN(categoryNum)) {
        productsQuery = productsQuery.eq('category_id', categoryNum);
      }
    }

    const page = query?.page ?? 1;
    const limit = query?.limit ?? 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const productsRes = await productsQuery
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);

    if (productsRes.error) throw new Error(productsRes.error.message);

    const rawProducts = (productsRes.data as unknown as ProductItemRow[]) || [];
    const productIds = rawProducts.map((product) => product.id);
    const skusRes =
      productIds.length === 0
        ? { data: [], error: null }
        : await this.client
            .from('product_skus')
            .select('id, product_id')
            .in('product_id', productIds);
    if (skusRes.error) throw new Error(skusRes.error.message);

    const variantCounts: Record<string | number, number> = {};
    if (skusRes.data) {
      for (const sku of skusRes.data as Array<{
        product_id: string | number;
      }>) {
        variantCounts[sku.product_id] =
          (variantCounts[sku.product_id] || 0) + 1;
      }
    }

    const products = rawProducts.map((p) => ({
      ...p,
      variant_count: variantCounts[p.id] || undefined,
    }));

    return {
      products,
      categories,
    };
  }

  async getShopProductDetails(
    productId: string | number,
  ): Promise<ProductDetailResult> {
    const numId = Number(productId);
    const [productRes, skuRes] = await Promise.all([
      this.client
        .from('product_items')
        .select(
          'id, name, description, price, currency, stock, media, category_id, status, created_at, product_categories(id, name)',
        )
        .eq('id', Number.isNaN(numId) ? productId : numId)
        .maybeSingle(),
      this.client
        .from('product_skus')
        .select('id, product_id, label, options, price, stock')
        .eq('product_id', Number.isNaN(numId) ? productId : numId)
        .order('id', { ascending: true }),
    ]);

    if (productRes.error) throw new Error(productRes.error.message);
    if (skuRes.error) throw new Error(skuRes.error.message);

    return {
      product: (productRes.data as unknown as ProductItemRow) || null,
      variants: [],
      skus: skuRes.data || [],
    };
  }

  /**
   * Resolves orderable products (and their SKUs) directly from the DB so that
   * order prices are always server-authoritative. Only active products are returned.
   */
  async getOrderableProductsByIds(
    productIds: Array<string | number>,
    skuIds: Array<string | number>,
  ): Promise<
    Array<{
      id: number;
      name: string;
      price: number;
      currency: string;
      stock: number;
      status: string;
      product_categories: { name: string } | null;
      skus: Array<{ id: number; price: number; stock: number; label: string }>;
    }>
  > {
    const numericProductIds = productIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);
    const numericSkuIds = skuIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (numericProductIds.length === 0) return [];

    const { data, error } = await this.client
      .from('product_items')
      .select(
        'id, name, price, currency, stock, status, product_categories(name)' +
          (numericSkuIds.length > 0
            ? ', product_skus(id, price, stock, label)'
            : ''),
      )
      .in('id', numericProductIds)
      .eq('status', 'active');

    if (error) throw new Error(error.message);

    type SkuNested = {
      id: number;
      price: number;
      stock: number;
      label: string;
    };
    const rows = (data ?? []) as unknown as Array<{
      id: number;
      name: string;
      price: number;
      currency: string;
      stock: number;
      status: string;
      product_categories: { name: string } | null;
      product_skus?: SkuNested[] | null;
    }>;

    // Return every product with its FULL sku list: which variant applies is
    // a per-order-line decision (the same product can appear in one cart
    // with different skus), so collapsing here would misprice line items.
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      price: row.price,
      currency: row.currency,
      stock: row.stock,
      status: row.status,
      product_categories: row.product_categories,
      skus: row.product_skus ?? [],
    }));
  }

  async createProductOrder(
    dto: CreateProductOrderDto,
    userId?: string,
    requestPayload?: Record<string, unknown>,
    guestAccessTokenHash?: string | null,
  ): Promise<CreateOrderResult> {
    // Atomic RPC (audit 2.2): header + items are inserted in a single DB
    // transaction so a failure can never leave an orphaned order header.
    const customerId = userId && this.isValidUuid(userId) ? userId : null;

    const { data, error } = (await this.client.rpc('create_product_order', {
      p_currency: dto.currency,
      p_subtotal: dto.subtotal,
      p_customer_notes: dto.customerNotes || null,
      p_customer_id: customerId,
      p_recipient: dto.recipient,
      p_items: dto.items.map((item) => ({
        product_id: String(item.productId),
        product_name: item.productName,
        sku_id: item.skuId != null ? String(item.skuId) : null,
        sku_label: item.skuLabel || null,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        final_price: item.finalPrice,
        subtotal: item.subtotal,
      })),
      p_request_id: dto.requestId ?? null,
      p_request_payload: requestPayload ?? null,
      p_guest_access_token_hash: guestAccessTokenHash ?? null,
    })) as { data: unknown; error: { message: string } | null };

    if (error || !data) {
      throw new Error(error?.message || 'Failed to create order');
    }

    return this.toCreateOrderResult(data);
  }

  async getProductOrderReplay(
    requestId: string,
    requestPayload: Record<string, unknown>,
    userId?: string,
    guestAccessTokenHash?: string | null,
  ): Promise<CreateOrderResult | null> {
    const customerId = userId && this.isValidUuid(userId) ? userId : null;
    const { data, error } = (await this.client.rpc('get_product_order_replay', {
      p_request_id: requestId,
      p_customer_id: customerId,
      p_request_payload: requestPayload,
      p_guest_access_token_hash: guestAccessTokenHash ?? null,
    })) as { data: unknown; error: { message: string } | null };

    if (error) throw new Error(error.message);
    return data == null ? null : this.toCreateOrderResult(data);
  }

  private toCreateOrderResult(data: unknown): CreateOrderResult {
    const payload =
      typeof data === 'object' && data !== null
        ? (data as {
            data?: number | string;
            status?: string;
            expires_at?: string;
          })
        : null;
    const orderId = Number(payload?.data ?? data);

    return {
      success: true,
      orderId,
      message: 'Order placed successfully',
      ...(payload?.status ? { status: payload.status } : {}),
      ...(payload?.expires_at ? { expiresAt: payload.expires_at } : {}),
    };
  }

  async getMyOrders(userId: string) {
    if (!this.isValidUuid(userId)) return [];

    const { data, error } = await this.client
      .from('order_headers')
      .select(ProductsRepository.ORDER_SELECT)
      .eq('customer_id', userId)
      .order('created_at', { ascending: false })
      // Bounded until a real pagination need exists.
      .limit(200);

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async getOrderById(orderId: string | number) {
    const numId = Number(orderId);
    const queryId = Number.isNaN(numId) ? orderId : numId;

    const { data, error } = await this.client
      .from('order_headers')
      .select(ProductsRepository.ORDER_SELECT)
      .eq('id', queryId)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116' || error.code === '22P02') return null;
      throw new Error(error.message);
    }
    return data;
  }

  async getOrderByGuestAccess(
    orderId: string | number,
    guestAccessTokenHash: string,
  ) {
    const numId = Number(orderId);
    if (!Number.isSafeInteger(numId) || numId <= 0) return null;

    const { data, error } = await this.client
      .from('order_headers')
      .select(ProductsRepository.ORDER_SELECT)
      .eq('id', numId)
      .eq('guest_access_token_hash', guestAccessTokenHash)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  }

  async getOrdersByIds(orderIds: number[]) {
    if (orderIds.length === 0) return [];
    const { data, error } = await this.client
      .from('order_headers')
      .select(ProductsRepository.ORDER_SELECT)
      .in('id', orderIds);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  // --- Seller (Business Dashboard) ---

  async getMyCatalogItems(sellerId: string): Promise<CatalogItemRow[]> {
    if (!this.isValidUuid(sellerId)) return [];

    const { data, error } = await this.client
      .from('product_items')
      .select(
        'id, name, description, price, currency, stock, status, media, category_id, seller_id, created_at, updated_at',
      )
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async createCatalogItem(
    item: {
      name: string;
      description?: string | null;
      price: number;
      currency: string;
      stock: number;
      media?: Array<{ url: string; type: string }> | null;
      category_id?: number | null;
    },
    sellerId: string,
  ): Promise<CatalogItemRow> {
    const { data, error } = await this.client
      .from('product_items')
      .insert({ ...item, seller_id: sellerId })
      .select(
        'id, name, description, price, currency, stock, status, media, category_id, seller_id, created_at, updated_at',
      )
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateCatalogItem(
    itemId: number,
    updates: Record<string, unknown>,
    sellerId: string,
  ): Promise<CatalogItemRow | null> {
    const { data, error } = await this.client
      .from('product_items')
      .update(updates)
      .eq('id', itemId)
      .eq('seller_id', sellerId)
      .select(
        'id, name, description, price, currency, stock, status, media, category_id, seller_id, created_at, updated_at',
      )
      .maybeSingle();

    if (error) throw new Error(error.message);
    // Empty result means the item does not exist or is not owned by the seller.
    return data;
  }

  async deleteCatalogItem(
    itemId: number,
    sellerId: string,
  ): Promise<{ id: number } | null> {
    const { data, error } = await this.client
      .from('product_items')
      .delete()
      .eq('id', itemId)
      .eq('seller_id', sellerId)
      .select('id')
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
  }

  async getOrdersContainingCatalogItems(catalogItemIds: number[]) {
    if (catalogItemIds.length === 0) return [];

    const { data, error } = await this.client
      .from('order_headers')
      .select(ProductsRepository.SELLER_ORDER_SELECT)
      .in(
        'items.product_id',
        catalogItemIds.map((id) => String(id)),
      )
      .order('created_at', { ascending: false })
      // Bounded until seller-side pagination exists.
      .limit(200);

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async getAllOrders() {
    const { data, error } = await this.client
      .from('order_headers')
      .select(ProductsRepository.ORDER_SELECT)
      .order('created_at', { ascending: false })
      // Bounded until admin pagination exists.
      .limit(200);

    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async sellerOwnsAllCatalogItems(itemIds: string[], sellerId: string) {
    const catalogItemIds = [...new Set(itemIds.map((id) => Number(id)))];
    if (
      catalogItemIds.length === 0 ||
      catalogItemIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
      !this.isValidUuid(sellerId)
    ) {
      return false;
    }

    const { data, error } = await this.client
      .from('product_items')
      .select('id')
      .in('id', catalogItemIds)
      .eq('seller_id', sellerId)
      .limit(catalogItemIds.length);

    if (error) throw new Error(error.message);
    const ownedIds = new Set((data ?? []).map((item) => Number(item.id)));
    return catalogItemIds.every((id) => ownedIds.has(id));
  }

  async updateOrderStatus(
    orderId: number | string,
    status: string,
    expectedCurrentStatus: string,
  ) {
    const { data, error } = (await this.client.rpc(
      'transition_product_order_status',
      {
        p_order_id: Number(orderId),
        p_expected_current_status: expectedCurrentStatus,
        p_new_status: status,
      },
    )) as { data: unknown; error: { message: string } | null };

    if (error) throw new Error(error.message);
    return data;
  }

  async confirmDeliveryQuote(
    orderId: number | string,
    deliveryFee: number,
    deliveryEta: string,
  ) {
    const { data, error } = (await this.client.rpc(
      'confirm_product_order_delivery_quote',
      {
        p_order_id: Number(orderId),
        p_delivery_fee: deliveryFee,
        p_delivery_eta: deliveryEta,
      },
    )) as { data: unknown; error: { message: string } | null };
    if (error) throw new Error(error.message);
    return data;
  }

  async selectManualPayment(orderId: number | string) {
    const { data, error } = (await this.client.rpc(
      'select_product_order_manual_payment',
      { p_order_id: Number(orderId) },
    )) as { data: unknown; error: { message: string } | null };
    if (error) throw new Error(error.message);
    return data;
  }

  async beginOnlinePayment(
    orderId: number | string,
  ): Promise<OnlinePaymentPreparation> {
    const { data, error } = (await this.client.rpc(
      'begin_product_order_online_payment',
      { p_order_id: Number(orderId) },
    )) as {
      data: OnlinePaymentPreparation | null;
      error: { message: string } | null;
    };
    if (error || !data) {
      throw new Error(error?.message || 'Could not start online payment');
    }
    return data;
  }

  async attachOnlinePaymentSession(
    orderId: number | string,
    sessionId: string,
    sessionExpiresAt: string,
  ) {
    const { data, error } = (await this.client.rpc(
      'attach_product_order_checkout_session',
      {
        p_order_id: Number(orderId),
        p_session_id: sessionId,
        p_session_expires_at: sessionExpiresAt,
      },
    )) as { data: unknown; error: { message: string } | null };
    if (error) throw new Error(error.message);
    return data;
  }
}
