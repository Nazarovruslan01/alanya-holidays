import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ProductsRepository, CreateOrderResult } from './products.repository';
import { UserRolesRepository } from '../common/auth/user-roles.repository';
import { BillingService } from '../billing/billing.service';
import { Money } from '../common/domain/value-objects/money.vo';
import { CreateProductOrderDto } from './dto/create-product-order.dto';
import { ConfirmDeliveryQuoteDto } from './dto/confirm-delivery-quote.dto';
import type { SellerOrderStatus } from './dto/update-order-status.dto';
import { isPausedGiftCard } from './product-sales-policy';

@Injectable()
export class ProductOrdersService {
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

  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly userRolesRepo: UserRolesRepository,
    private readonly billingService: BillingService,
  ) {}

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
    if (dbProducts.some((product) => isPausedGiftCard(product))) {
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

  async getAdminOrders(userId: string) {
    if ((await this.userRolesRepo.getRole(userId)) !== 'admin') {
      throw new UnauthorizedException('Not authorized');
    }
    const orders = await this.productsRepository.getAllOrders();
    return orders.map((order: Record<string, unknown>) => ({
      ...order,
      can_manage_order: true,
    }));
  }

  async getSellerOrders(sellerId: string) {
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
      ProductOrdersService.ORDER_STATUS_TRANSITIONS[order.status] ?? [];
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
