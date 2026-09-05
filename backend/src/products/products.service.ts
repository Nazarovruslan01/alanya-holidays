import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ProductsRepository,
  ProductCategoryRow,
  ProductItemRow,
  ProductSkuRow,
  ShopCatalogResult,
  CreateOrderResult,
} from './products.repository';
import { UserRolesRepository } from '../common/auth/user-roles.repository';
import { CreateProductOrderDto } from './dto/create-product-order.dto';
import { GetShopCatalogQueryDto } from './dto/get-shop-catalog-query.dto';
import {
  CreateSellerProductDto,
  UpdateSellerProductDto,
} from './dto/seller-product.dto';
import type { SellerOrderStatus } from './dto/update-order-status.dto';
import {
  CreateProductDto,
  CreateProductVariantDto,
  UpdateProductDto,
  UpdateProductVariantDto,
} from './dto/product-write.dto';
import { Money } from '../common/domain/value-objects/money.vo';
import { BillingService } from '../billing/billing.service';
import { ConfirmDeliveryQuoteDto } from './dto/confirm-delivery-quote.dto';
import {
  CreateAdminProductDto,
  UpdateAdminProductDto,
} from './dto/admin-product.dto';

export interface Product {
  id?: string;
  title: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  images: string[];
  seller_id?: string;
  created_at?: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  size_label: string;
  price: number;
  stock: number;
  sku: string | null;
  created_at: string;
}

export interface ShopProductDetailResult {
  product: ProductItemRow;
  variants: unknown[];
  skus: ProductSkuRow[];
}

@Injectable()
export class ProductsService {
  private static readonly PAUSED_GIFT_CARD_CATEGORY = 'Gift Cards';

  // Allowed seller fulfillment transitions; terminal states map to no exits.
  private static readonly ORDER_STATUS_TRANSITIONS: Record<
    string,
    readonly string[]
  > = {
    pending_payment: ['paid', 'cancelled'],
    paid: ['shipped', 'cancelled'],
    shipped: ['completed'],
    completed: [],
    cancelled: [],
  };

  private isPausedGiftCard(product: {
    product_categories?: { name: string } | null;
  }): boolean {
    return (
      product.product_categories?.name ===
      ProductsService.PAUSED_GIFT_CARD_CATEGORY
    );
  }

  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly userRolesRepo: UserRolesRepository,
    private readonly billingService: BillingService,
  ) {}

  private async requirePremiumMerchantAccess(userId: string): Promise<void> {
    const role = await this.userRolesRepo.getRole(userId);
    if (role === 'admin') return;

    const hasAccess = await this.billingService.hasActivePremiumAccess(userId);
    if (!hasAccess) {
      throw new ForbiddenException(
        'An active premium subscription is required to manage products',
      );
    }
  }

  private throwOrderPersistenceError(error: unknown): never {
    if (error instanceof Error) {
      if (error.message === 'Idempotency key conflict') {
        throw new ConflictException('Idempotency key conflict');
      }
      if (
        /^(Invalid order|Product unavailable|SKU unavailable|Insufficient stock|Delivery quote|Payment|Cannot cancel|Order reservation)/.test(
          error.message,
        )
      ) {
        throw new BadRequestException(error.message);
      }
    }
    throw error;
  }

  private hashGuestAccessToken(token?: string): string | null {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return createHash('sha256').update(token).digest('hex');
  }

  async createProduct(data: CreateProductDto, requestUserId: string) {
    await this.requirePremiumMerchantAccess(requestUserId);
    const insertData = {
      title: data.title,
      description: data.description,
      price: data.price,
      stock: data.stock,
      category: data.category,
      images: data.images,
      seller_id: requestUserId,
    };
    const product = await this.productsRepository.insertProduct(insertData);
    return product as Product;
  }

  async getProducts(category?: string, page = 1, limit = 20) {
    const data = await this.productsRepository.getProducts(
      category,
      page,
      limit,
    );
    return data as Product[];
  }

  async getProductsAdmin(
    categoryId?: number,
    page = 1,
    limit = 20,
    search?: string,
  ) {
    return this.productsRepository.getProductsAdmin(
      categoryId,
      page,
      limit,
      search,
    );
  }

  async getAdminProduct(itemId: number) {
    const item = await this.productsRepository.getCatalogItemAdmin(itemId);
    if (!item) throw new NotFoundException('Product not found');
    return item;
  }

  async createAdminProduct(data: CreateAdminProductDto, adminId: string) {
    return this.productsRepository.createCatalogItemAdmin({
      name: data.name,
      description: data.description ?? null,
      price: data.price,
      currency: (data.currency || 'EUR').toUpperCase(),
      stock: data.stock ?? 0,
      media: data.media ?? [],
      category_id: data.category_id ?? null,
      status: data.status ?? 'active',
      seller_id: adminId,
    });
  }

  async updateAdminProduct(itemId: number, data: UpdateAdminProductDto) {
    const updates: Record<string, unknown> = {};
    for (const key of [
      'name',
      'description',
      'price',
      'stock',
      'media',
      'category_id',
      'status',
    ] as const) {
      if (data[key] !== undefined) updates[key] = data[key];
    }
    if (data.currency !== undefined) {
      updates.currency = data.currency.toUpperCase();
    }

    const item = await this.productsRepository.updateCatalogItemAdmin(
      itemId,
      updates,
    );
    if (!item) throw new NotFoundException('Product not found');
    return item;
  }

  async deleteAdminProduct(itemId: number) {
    const deleted =
      await this.productsRepository.deleteCatalogItemAdmin(itemId);
    if (!deleted) throw new NotFoundException('Product not found');
    return { success: true };
  }

  async getFeaturedProducts(limit = 8) {
    const products = await this.productsRepository.getFeaturedProducts(limit);
    return products.filter((product) => !this.isPausedGiftCard(product));
  }

  async getProduct(id: string) {
    const data = await this.productsRepository.getProductById(id);
    if (!data) throw new NotFoundException('Product not found');
    return data as Product;
  }

  private async checkOwnership(productId: string, userId: string) {
    const role = await this.userRolesRepo.getRole(userId);
    const existingProduct =
      await this.productsRepository.getProductOwnership(productId);

    if (!existingProduct) throw new NotFoundException('Product not found');

    if (
      existingProduct.seller_id !== userId &&
      existingProduct.artisan_id !== userId &&
      role !== 'admin'
    ) {
      throw new UnauthorizedException('Not authorized');
    }
    return existingProduct;
  }

  async updateProduct(
    id: string,
    updates: UpdateProductDto,
    requestUserId: string,
  ) {
    await this.requirePremiumMerchantAccess(requestUserId);
    await this.checkOwnership(id, requestUserId);
    const safeUpdates = this.mapProductUpdates(updates);
    await this.productsRepository.updateProduct(id, safeUpdates);
    return { success: true };
  }

  private mapProductUpdates(updates: UpdateProductDto) {
    const payload: Record<string, unknown> = {};
    if (updates.title !== undefined) payload.title = updates.title;
    if (updates.description !== undefined)
      payload.description = updates.description;
    if (updates.price !== undefined) payload.price = updates.price;
    if (updates.stock !== undefined) payload.stock = updates.stock;
    if (updates.category !== undefined) payload.category = updates.category;
    if (updates.images !== undefined) payload.images = updates.images;
    return payload;
  }

  async deleteProduct(id: string, requestUserId: string) {
    await this.requirePremiumMerchantAccess(requestUserId);
    await this.checkOwnership(id, requestUserId);
    await this.productsRepository.deleteProduct(id);
    return { success: true };
  }

  // Variants
  async getProductVariants(productId: string, page = 1, limit = 20) {
    const data = await this.productsRepository.getProductVariants(
      productId,
      page,
      limit,
    );
    return data as ProductVariant[];
  }

  async createProductVariant(
    productId: string,
    data: CreateProductVariantDto,
    requestUserId: string,
  ) {
    await this.checkOwnership(productId, requestUserId);
    const variant = await this.productsRepository.insertProductVariant({
      size_label: data.size_label,
      price: data.price,
      stock: data.stock,
      sku: data.sku ?? null,
      product_id: productId,
    });
    return variant as ProductVariant;
  }

  async updateProductVariant(
    variantId: string,
    updates: UpdateProductVariantDto,
    requestUserId: string,
  ) {
    const productId =
      await this.productsRepository.getVariantProductId(variantId);
    if (!productId) throw new NotFoundException('Variant not found');

    await this.checkOwnership(productId, requestUserId);

    const safeUpdates: Record<string, unknown> = {};
    if (updates.size_label !== undefined)
      safeUpdates.size_label = updates.size_label;
    if (updates.price !== undefined) safeUpdates.price = updates.price;
    if (updates.stock !== undefined) safeUpdates.stock = updates.stock;
    if (updates.sku !== undefined) safeUpdates.sku = updates.sku;
    await this.productsRepository.updateProductVariant(variantId, safeUpdates);
    return { success: true };
  }

  async deleteProductVariant(variantId: string, requestUserId: string) {
    const productId =
      await this.productsRepository.getVariantProductId(variantId);
    if (!productId) throw new NotFoundException('Variant not found');

    await this.checkOwnership(productId, requestUserId);
    await this.productsRepository.deleteProductVariant(variantId);
    return { success: true };
  }

  // --- Shop Catalog & Orders Methods ---

  async getShopCategories(): Promise<ProductCategoryRow[]> {
    const categories = await this.productsRepository.getShopCategories();
    return categories.filter(
      (category) => category.name !== ProductsService.PAUSED_GIFT_CARD_CATEGORY,
    );
  }

  async getShopCatalog(
    query?: GetShopCatalogQueryDto,
  ): Promise<ShopCatalogResult> {
    const catalog = await this.productsRepository.getShopCatalog(query);
    return {
      products: catalog.products.filter(
        (product) => !this.isPausedGiftCard(product),
      ),
      categories: catalog.categories.filter(
        (category) =>
          category.name !== ProductsService.PAUSED_GIFT_CARD_CATEGORY,
      ),
    };
  }

  async getShopProductDetails(
    productId: string | number,
  ): Promise<ShopProductDetailResult> {
    const result =
      await this.productsRepository.getShopProductDetails(productId);
    if (!result.product) {
      throw new NotFoundException('Product not found');
    }
    if (this.isPausedGiftCard(result.product)) {
      throw new BadRequestException(
        'Gift card sales are temporarily unavailable',
      );
    }
    return {
      product: result.product,
      variants: result.variants,
      skus: result.skus,
    };
  }

  async createProductOrder(
    dto: CreateProductOrderDto,
    userId?: string,
  ): Promise<CreateOrderResult> {
    const guestAccessTokenHash = userId
      ? null
      : this.hashGuestAccessToken(dto.guestAccessToken);
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Order must contain at least one item');
    }
    if (
      dto.items.some(
        (item) => !Number.isInteger(item.quantity) || item.quantity <= 0,
      )
    ) {
      throw new BadRequestException(
        'Order item quantities must be positive integers',
      );
    }

    const requestPayload = dto.requestId
      ? {
          currency: dto.currency,
          subtotal: dto.subtotal,
          customerNotes: dto.customerNotes ?? null,
          recipient: { ...dto.recipient },
          items: dto.items.map((item) => ({ ...item })),
        }
      : undefined;

    if (dto.requestId && requestPayload) {
      if (!userId && !guestAccessTokenHash) {
        throw new BadRequestException(
          'A secure guest access token is required for guest orders',
        );
      }
      try {
        const replay = await this.productsRepository.getProductOrderReplay(
          dto.requestId,
          requestPayload,
          userId,
          guestAccessTokenHash,
        );
        if (replay) {
          return userId
            ? replay
            : { ...replay, guestAccessToken: dto.guestAccessToken };
        }
      } catch (error) {
        this.throwOrderPersistenceError(error);
      }
    }

    const currency = dto.currency || 'EUR';

    // Server-authoritative pricing (audit 2.1): resolve prices from the DB,
    // never trust client-supplied unitPrice/finalPrice/subtotal.
    const dbProducts = await this.productsRepository.getOrderableProductsByIds(
      dto.items.map((item) => item.productId),
      dto.items
        .map((item) => item.skuId)
        .filter((id): id is string | number => id != null),
    );
    if (dbProducts.some((product) => this.isPausedGiftCard(product))) {
      throw new BadRequestException(
        'Gift card sales are temporarily unavailable',
      );
    }
    const dbByProductId = new Map(dbProducts.map((p) => [Number(p.id), p]));

    let calculatedSubtotal = Money.zero(currency);

    for (const item of dto.items) {
      const dbProduct = dbByProductId.get(Number(item.productId));
      if (!dbProduct) {
        throw new BadRequestException(
          `Product "${item.productName}" is not available for ordering`,
        );
      }

      if (dbProduct.currency.toUpperCase() !== currency.toUpperCase()) {
        throw new BadRequestException(
          `Currency mismatch for product "${dbProduct.name}": expected ${currency}, got ${dbProduct.currency}`,
        );
      }

      // Resolve the variant PER ORDER LINE: the same product can appear in
      // one cart under different skus, so pricing/stock must follow the
      // item's own skuId, not "any sku of this product".
      const requestedSkuId = item.skuId != null ? Number(item.skuId) : null;
      let unitPriceFromDb = dbProduct.price;
      let stockFromDb = dbProduct.stock;
      if (requestedSkuId !== null && !Number.isNaN(requestedSkuId)) {
        const sku = (dbProduct.skus ?? []).find((s) => s.id === requestedSkuId);
        if (!sku) {
          throw new BadRequestException(
            `SKU "${item.skuId}" is not available for product "${dbProduct.name}"`,
          );
        }
        unitPriceFromDb = sku.price;
        stockFromDb = sku.stock;
        item.skuId = sku.id;
      }

      if (!dto.requestId && stockFromDb < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for product "${dbProduct.name}": requested ${item.quantity}, available ${stockFromDb}`,
        );
      }

      const itemSubtotal = Money.fromDecimal(unitPriceFromDb, currency)
        .multiply(item.quantity)
        .toDatabaseDecimal();

      // Overwrite client values with server-resolved ones before persisting.
      item.productName = dbProduct.name;
      item.unitPrice = unitPriceFromDb;
      item.finalPrice = unitPriceFromDb;
      item.subtotal = itemSubtotal;

      calculatedSubtotal = calculatedSubtotal.add(
        Money.fromDecimal(itemSubtotal, currency),
      );
    }

    dto.subtotal = calculatedSubtotal.toDatabaseDecimal();

    if (!userId && !guestAccessTokenHash) {
      throw new BadRequestException(
        'A secure guest access token is required for guest orders',
      );
    }

    try {
      const result = await this.productsRepository.createProductOrder(
        dto,
        userId,
        requestPayload,
        guestAccessTokenHash,
      );
      return userId
        ? result
        : { ...result, guestAccessToken: dto.guestAccessToken };
    } catch (error) {
      this.throwOrderPersistenceError(error);
    }
  }

  async getMyOrders(userId: string) {
    const orders = await this.productsRepository.getMyOrders(userId);
    return orders.map((order: Record<string, unknown>) =>
      this.toBuyerOrder(order),
    );
  }

  private toBuyerOrder(order: Record<string, unknown>) {
    const safeOrder = { ...order };
    delete safeOrder.customer_id;
    return safeOrder;
  }

  async getOrderById(
    orderId: string | number,
    userId?: string,
    guestAccessToken?: string,
  ) {
    const order = await this.productsRepository.getOrderById(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (userId) {
      const role = await this.userRolesRepo.getRole(userId);
      if (role === 'admin') return order;
      if (order.customer_id === userId) return this.toBuyerOrder(order);
    }

    const guestAccessTokenHash = this.hashGuestAccessToken(guestAccessToken);
    if (guestAccessTokenHash) {
      const guestOrder = await this.productsRepository.getOrderByGuestAccess(
        orderId,
        guestAccessTokenHash,
      );
      if (guestOrder) return this.toBuyerOrder(guestOrder);
    }

    throw new NotFoundException('Order not found');
  }

  private async requireOrderManager(orderId: string | number, userId: string) {
    const order = (await this.productsRepository.getOrderById(orderId)) as {
      id: number;
      items?: Array<{ product_id: string | number }> | null;
    } | null;
    if (!order) throw new NotFoundException('Order not found');

    const role = await this.userRolesRepo.getRole(userId);
    if (role !== 'admin') {
      const itemIds = [
        ...new Set((order.items ?? []).map((item) => String(item.product_id))),
      ];
      if (
        itemIds.length === 0 ||
        !(await this.productsRepository.sellerOwnsAllCatalogItems(
          itemIds,
          userId,
        ))
      ) {
        throw new UnauthorizedException('Not authorized to manage this order');
      }
    }
    return order;
  }

  async confirmDeliveryQuote(
    orderId: string | number,
    dto: ConfirmDeliveryQuoteDto,
    userId: string,
  ) {
    await this.requireOrderManager(orderId, userId);
    try {
      return await this.productsRepository.confirmDeliveryQuote(
        orderId,
        dto.deliveryFee,
        dto.deliveryEta.trim(),
      );
    } catch (error) {
      this.throwOrderPersistenceError(error);
    }
  }

  private async requireBuyerAccess(
    orderId: string | number,
    userId?: string,
    guestAccessToken?: string,
  ) {
    return this.getOrderById(orderId, userId, guestAccessToken);
  }

  async selectManualPayment(
    orderId: string | number,
    userId?: string,
    guestAccessToken?: string,
  ) {
    await this.requireBuyerAccess(orderId, userId, guestAccessToken);
    try {
      return await this.productsRepository.selectManualPayment(orderId);
    } catch (error) {
      this.throwOrderPersistenceError(error);
    }
  }

  async createOnlinePayment(
    orderId: string | number,
    userId?: string,
    guestAccessToken?: string,
  ) {
    await this.requireBuyerAccess(orderId, userId, guestAccessToken);
    try {
      const order = await this.productsRepository.beginOnlinePayment(orderId);
      const checkout = await this.billingService.createProductOrderCheckout({
        orderId: order.id,
        amount: Number(order.total_amount),
        currency: order.currency,
        customerEmail: order.recipient?.email,
        quoteConfirmedAt: order.delivery_quote_confirmed_at,
        expiresAt: order.checkout_expires_at,
      });
      await this.productsRepository.attachOnlinePaymentSession(
        order.id,
        checkout.sessionId,
        checkout.expiresAt,
      );
      return { url: checkout.url };
    } catch (error) {
      this.throwOrderPersistenceError(error);
    }
  }

  // --- Seller (Business Dashboard) ---

  async getMyProducts(sellerId: string) {
    await this.requirePremiumMerchantAccess(sellerId);
    return this.productsRepository.getMyCatalogItems(sellerId);
  }

  async createMyProduct(dto: CreateSellerProductDto, sellerId: string) {
    await this.requirePremiumMerchantAccess(sellerId);
    return this.productsRepository.createCatalogItem(
      {
        name: dto.name,
        description: dto.description ?? null,
        price: dto.price,
        currency: dto.currency || 'EUR',
        stock: dto.stock ?? 0,
        media: dto.media ?? null,
        category_id: dto.category_id ?? null,
      },
      sellerId,
    );
  }

  async updateMyProduct(
    itemId: number,
    dto: UpdateSellerProductDto,
    sellerId: string,
  ) {
    await this.requirePremiumMerchantAccess(sellerId);
    const updates: Record<string, unknown> = {};
    for (const key of [
      'name',
      'description',
      'price',
      'currency',
      'stock',
      'media',
      'category_id',
      'status',
    ] as const) {
      if (dto[key] !== undefined) updates[key] = dto[key];
    }

    const updated = await this.productsRepository.updateCatalogItem(
      itemId,
      updates,
      sellerId,
    );
    // Repository scopes the update by seller_id, so a miss means "not yours".
    if (!updated) throw new NotFoundException('Product not found');
    return updated;
  }

  async deleteMyProduct(itemId: number, sellerId: string) {
    await this.requirePremiumMerchantAccess(sellerId);
    const deleted = await this.productsRepository.deleteCatalogItem(
      itemId,
      sellerId,
    );
    if (!deleted) throw new NotFoundException('Product not found');
    return { success: true };
  }

  async getSellerOrders(sellerId: string) {
    const role = await this.userRolesRepo.getRole(sellerId);
    if (role === 'admin') {
      const orders = await this.productsRepository.getAllOrders();
      return orders.map((order: Record<string, unknown>) => ({
        ...order,
        can_manage_order: true,
      }));
    }

    const items = await this.productsRepository.getMyCatalogItems(sellerId);
    if (items.length === 0) return [];

    const ownedCatalogItemIds = new Set(items.map((item) => item.id));
    const orders =
      (await this.productsRepository.getOrdersContainingCatalogItems([
        ...ownedCatalogItemIds,
      ])) as unknown as Array<{
        id: number;
        currency: string;
        status: string;
        recipient?: Record<string, unknown> | null;
        created_at: string;
        items?: Array<{
          id: number;
          product_id: string | number;
          product_name: string;
          sku_label?: string | null;
          quantity: number;
          subtotal: number;
        }> | null;
      }>;

    const fullOrders = (await this.productsRepository.getOrdersByIds(
      orders.map((order) => order.id),
    )) as Array<Record<string, unknown>>;
    const fullById = new Map(
      fullOrders.map((order) => [Number(order.id), order]),
    );

    return orders.flatMap((order): Array<Record<string, unknown>> => {
      const sellerItems = (order.items ?? [])
        .filter((item) => {
          const productId = Number(item.product_id);
          return (
            Number.isSafeInteger(productId) &&
            ownedCatalogItemIds.has(productId)
          );
        })
        .map((item) => ({
          id: item.id,
          product_name: item.product_name,
          sku_label: item.sku_label,
          quantity: item.quantity,
          subtotal: item.subtotal,
        }));

      if (sellerItems.length === 0) return [];

      const fullOrder = fullById.get(Number(order.id));
      const fullItems = Array.isArray(fullOrder?.items)
        ? (fullOrder.items as Array<{ product_id: string | number }>)
        : [];
      const canManageOrder =
        fullItems.length > 0 &&
        fullItems.every((item) => {
          const productId = Number(item.product_id);
          return (
            Number.isSafeInteger(productId) &&
            ownedCatalogItemIds.has(productId)
          );
        });
      const recipient = order.recipient;
      if (canManageOrder && fullOrder) {
        const rawRecipient =
          fullOrder.recipient && typeof fullOrder.recipient === 'object'
            ? (fullOrder.recipient as Record<string, unknown>)
            : null;
        const fullRecipient = rawRecipient
          ? {
              ...(typeof rawRecipient.name === 'string'
                ? { name: rawRecipient.name }
                : {}),
              ...(typeof rawRecipient.email === 'string'
                ? { email: rawRecipient.email }
                : {}),
              ...(typeof rawRecipient.phone === 'string'
                ? { phone: rawRecipient.phone }
                : {}),
              ...(typeof rawRecipient.address === 'string'
                ? { address: rawRecipient.address }
                : {}),
              ...(typeof rawRecipient.contact_method === 'string'
                ? { contact_method: rawRecipient.contact_method }
                : {}),
            }
          : null;
        return [
          {
            id: fullOrder.id,
            currency: fullOrder.currency,
            payment_provider: fullOrder.payment_provider,
            payment_reconciliation_status:
              fullOrder.payment_reconciliation_status,
            status: fullOrder.status,
            subtotal_items: fullOrder.subtotal_items,
            delivery_fee: fullOrder.delivery_fee,
            delivery_eta: fullOrder.delivery_eta,
            delivery_quote_confirmed_at: fullOrder.delivery_quote_confirmed_at,
            total_amount: fullOrder.total_amount,
            reservation_expires_at: fullOrder.reservation_expires_at,
            recipient: fullRecipient,
            created_at: fullOrder.created_at,
            items: fullOrder.items,
            can_manage_order: true,
          },
        ];
      }

      return [
        {
          id: order.id,
          currency: order.currency,
          status: order.status,
          recipient:
            recipient && typeof recipient === 'object'
              ? {
                  ...(typeof recipient.name === 'string'
                    ? { name: recipient.name }
                    : {}),
                  ...(typeof recipient.email === 'string'
                    ? { email: recipient.email }
                    : {}),
                }
              : null,
          created_at: order.created_at,
          items: sellerItems,
          can_manage_order: false,
        },
      ];
    });
  }

  async updateOrderStatus(
    orderId: string | number,
    nextStatus: SellerOrderStatus,
    userId: string,
  ) {
    const order = (await this.productsRepository.getOrderById(orderId)) as {
      id: number;
      status: string;
      items?: Array<{ product_id: string | number }> | null;
    } | null;

    if (!order) throw new NotFoundException('Order not found');

    const allowed =
      ProductsService.ORDER_STATUS_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(nextStatus)) {
      throw new BadRequestException(
        `Cannot change order status from '${order.status}' to '${nextStatus}'`,
      );
    }

    const role = await this.userRolesRepo.getRole(userId);
    if (role !== 'admin') {
      const itemIds = [
        ...new Set((order.items ?? []).map((item) => String(item.product_id))),
      ];
      if (itemIds.length === 0) {
        throw new UnauthorizedException('Not authorized to update this order');
      }
      const ownsEveryItem =
        await this.productsRepository.sellerOwnsAllCatalogItems(
          itemIds,
          userId,
        );
      if (!ownsEveryItem) {
        throw new UnauthorizedException('Not authorized to update this order');
      }
    }

    // The UPDATE is guarded on the status validated above; a concurrent
    // transition makes it match 0 rows and surfaces as a conflict.
    const updated = (await this.productsRepository.updateOrderStatus(
      order.id,
      nextStatus,
      order.status,
    )) as { id: number; status: string } | null;

    if (!updated) {
      throw new ConflictException(
        `Order ${order.id} was already modified — current status differs from '${order.status}'`,
      );
    }
    return updated;
  }
}
