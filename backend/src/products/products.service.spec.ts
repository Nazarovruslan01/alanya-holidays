import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsRepository } from './products.repository';
import { UserRolesRepository } from '../common/auth/user-roles.repository';
import { BillingService } from '../billing/billing.service';
import { CreateProductOrderDto } from './dto/create-product-order.dto';
import { CreateProductDto, UpdateProductDto } from './dto/product-write.dto';

describe('ProductsService', () => {
  let service: ProductsService;
  let mockUserRolesRepo: {
    getRole: jest.Mock;
  };
  let mockBillingService: {
    hasActivePremiumAccess: jest.Mock;
    createProductOrderCheckout: jest.Mock;
  };
  let mockRepository: {
    insertProduct: jest.Mock;
    getProducts: jest.Mock;
    getProductById: jest.Mock;
    getProductOwnership: jest.Mock;
    updateProduct: jest.Mock;
    deleteProduct: jest.Mock;
    getProductVariants: jest.Mock;
    insertProductVariant: jest.Mock;
    getVariantProductId: jest.Mock;
    updateProductVariant: jest.Mock;
    deleteProductVariant: jest.Mock;
    getShopCategories: jest.Mock;
    getShopCatalog: jest.Mock;
    getFeaturedProducts: jest.Mock;
    getShopProductDetails: jest.Mock;
    getOrderableProductsByIds: jest.Mock;
    getProductOrderReplay: jest.Mock;
    createProductOrder: jest.Mock;
    getMyOrders: jest.Mock;
    getOrderById: jest.Mock;
    getOrderByGuestAccess: jest.Mock;
    getOrdersByIds: jest.Mock;
    getMyCatalogItems: jest.Mock;
    createCatalogItem: jest.Mock;
    updateCatalogItem: jest.Mock;
    deleteCatalogItem: jest.Mock;
    getOrdersContainingCatalogItems: jest.Mock;
    getAllOrders: jest.Mock;
    sellerOwnsAllCatalogItems: jest.Mock;
    updateOrderStatus: jest.Mock;
    confirmDeliveryQuote: jest.Mock;
    selectManualPayment: jest.Mock;
    beginOnlinePayment: jest.Mock;
    attachOnlinePaymentSession: jest.Mock;
    getProductsAdmin: jest.Mock;
    getCatalogItemAdmin: jest.Mock;
    createCatalogItemAdmin: jest.Mock;
    updateCatalogItemAdmin: jest.Mock;
    deleteCatalogItemAdmin: jest.Mock;
  };

  beforeEach(async () => {
    mockUserRolesRepo = {
      getRole: jest.fn(),
    };
    mockBillingService = {
      hasActivePremiumAccess: jest.fn().mockResolvedValue(true),
      createProductOrderCheckout: jest.fn(),
    };
    mockRepository = {
      insertProduct: jest.fn(),
      getProducts: jest.fn().mockResolvedValue([]),
      getProductById: jest.fn(),
      getProductOwnership: jest.fn(),
      updateProduct: jest.fn().mockResolvedValue({}),
      deleteProduct: jest.fn().mockResolvedValue({}),
      getProductVariants: jest.fn().mockResolvedValue([]),
      insertProductVariant: jest.fn(),
      getVariantProductId: jest.fn(),
      updateProductVariant: jest.fn().mockResolvedValue({}),
      deleteProductVariant: jest.fn().mockResolvedValue({}),
      getShopCategories: jest
        .fn()
        .mockResolvedValue([{ id: 1, name: 'Souvenirs', sort_order: 1 }]),
      getShopCatalog: jest
        .fn()
        .mockResolvedValue({ products: [], categories: [] }),
      getFeaturedProducts: jest.fn().mockResolvedValue([]),
      getShopProductDetails: jest.fn().mockResolvedValue({
        product: { id: 1, name: 'Item' },
        variants: [],
        skus: [],
      }),
      getOrderableProductsByIds: jest.fn().mockResolvedValue([]),
      getProductOrderReplay: jest.fn().mockResolvedValue(null),
      createProductOrder: jest.fn().mockResolvedValue({
        success: true,
        orderId: 77,
        message: 'Order placed successfully',
      }),
      getMyOrders: jest.fn().mockResolvedValue([
        {
          id: 77,
          currency: 'EUR',
          items: [],
        },
      ]),
      getOrderById: jest.fn().mockResolvedValue({
        id: 77,
        currency: 'EUR',
        customer_id: 'user-xyz',
        items: [],
      }),
      getOrderByGuestAccess: jest.fn().mockResolvedValue(null),
      getOrdersByIds: jest.fn().mockResolvedValue([]),
      getMyCatalogItems: jest.fn().mockResolvedValue([]),
      createCatalogItem: jest.fn(),
      updateCatalogItem: jest.fn(),
      deleteCatalogItem: jest.fn(),
      getOrdersContainingCatalogItems: jest.fn().mockResolvedValue([]),
      getAllOrders: jest.fn().mockResolvedValue([]),
      sellerOwnsAllCatalogItems: jest.fn().mockResolvedValue(false),
      updateOrderStatus: jest.fn(),
      confirmDeliveryQuote: jest.fn(),
      selectManualPayment: jest.fn(),
      beginOnlinePayment: jest.fn(),
      attachOnlinePaymentSession: jest.fn(),
      getProductsAdmin: jest.fn(),
      getCatalogItemAdmin: jest.fn(),
      createCatalogItemAdmin: jest.fn(),
      updateCatalogItemAdmin: jest.fn(),
      deleteCatalogItemAdmin: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: ProductsRepository,
          useValue: mockRepository,
        },
        {
          provide: UserRolesRepository,
          useValue: mockUserRolesRepo,
        },
        {
          provide: BillingService,
          useValue: mockBillingService,
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  describe('createProduct', () => {
    it('should assign seller_id and insert product', async () => {
      const mockCreated = { id: 'p1', title: 'Gift Box', seller_id: 'user-1' };
      mockRepository.insertProduct.mockResolvedValueOnce(mockCreated);

      const res = await service.createProduct(
        {
          title: 'Gift Box',
          description: '',
          price: 10,
          stock: 5,
          category: 'souvenirs',
          images: [],
          seller_id: 'attacker',
          status: 'active',
        } as unknown as CreateProductDto,
        'user-1',
      );

      expect(res).toEqual(mockCreated);
      expect(mockRepository.insertProduct).toHaveBeenCalledWith({
        title: 'Gift Box',
        description: '',
        price: 10,
        stock: 5,
        category: 'souvenirs',
        images: [],
        seller_id: 'user-1',
      });
    });

    it('rejects legacy product writes without active premium access', async () => {
      mockUserRolesRepo.getRole.mockResolvedValue('merchant');
      mockBillingService.hasActivePremiumAccess.mockResolvedValue(false);
      const dto = {
        title: 'Gift Box',
        description: '',
        price: 10,
        stock: 5,
        category: 'souvenirs',
        images: [],
      };

      await expect(service.createProduct(dto, 'merchant-1')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        service.updateProduct('product-id', { title: 'Changed' }, 'merchant-1'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.deleteProduct('product-id', 'merchant-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRepository.insertProduct).not.toHaveBeenCalled();
      expect(mockRepository.updateProduct).not.toHaveBeenCalled();
      expect(mockRepository.deleteProduct).not.toHaveBeenCalled();
    });
  });

  describe('admin live catalog CRUD', () => {
    it('maps admin creates to product_items fields and the authenticated admin seller', async () => {
      mockRepository.createCatalogItemAdmin.mockResolvedValue({
        id: 31,
        name: 'Lamp',
      });

      await service.createAdminProduct(
        {
          name: 'Lamp',
          description: 'Copper',
          price: 25,
          currency: 'eur',
          stock: 3,
          media: [{ url: 'https://example.com/lamp.jpg', type: 'image' }],
          category_id: 7,
          status: 'active',
        },
        'admin-1',
      );

      expect(mockRepository.createCatalogItemAdmin).toHaveBeenCalledWith({
        name: 'Lamp',
        description: 'Copper',
        price: 25,
        currency: 'EUR',
        stock: 3,
        media: [{ url: 'https://example.com/lamp.jpg', type: 'image' }],
        category_id: 7,
        status: 'active',
        seller_id: 'admin-1',
      });
    });

    it('uses unrestricted admin catalog update/delete methods and reports missing rows', async () => {
      mockRepository.updateCatalogItemAdmin.mockResolvedValue({
        id: 31,
        stock: 5,
      });
      mockRepository.deleteCatalogItemAdmin.mockResolvedValue({ id: 31 });

      await expect(
        service.updateAdminProduct(31, { stock: 5, currency: 'try' }),
      ).resolves.toEqual({ id: 31, stock: 5 });
      expect(mockRepository.updateCatalogItemAdmin).toHaveBeenCalledWith(31, {
        stock: 5,
        currency: 'TRY',
      });
      await expect(service.deleteAdminProduct(31)).resolves.toEqual({
        success: true,
      });

      mockRepository.deleteCatalogItemAdmin.mockResolvedValueOnce(null);
      await expect(service.deleteAdminProduct(999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getProduct', () => {
    it('should throw NotFoundException if product is missing', async () => {
      mockRepository.getProductById.mockResolvedValueOnce(null);

      await expect(service.getProduct('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateProduct', () => {
    it('should throw UnauthorizedException if user is not seller, artisan, or admin', async () => {
      mockUserRolesRepo.getRole.mockResolvedValueOnce('user');
      mockRepository.getProductOwnership.mockResolvedValueOnce({
        seller_id: 'owner-user',
      });

      await expect(
        service.updateProduct('p1', { title: 'Updated' }, 'random-user'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should update product if caller is owner', async () => {
      mockUserRolesRepo.getRole.mockResolvedValueOnce('user');
      mockRepository.getProductOwnership.mockResolvedValueOnce({
        seller_id: 'owner-user',
      });

      const res = await service.updateProduct(
        'p1',
        {
          title: 'Updated Title',
          seller_id: 'hacked-id',
        } as unknown as UpdateProductDto,
        'owner-user',
      );

      expect(res).toEqual({ success: true });
      expect(mockRepository.updateProduct).toHaveBeenCalledWith('p1', {
        title: 'Updated Title',
      });
    });
  });

  describe('Shop Catalog & Orders Service Methods', () => {
    it('getShopCategories should call repository and return categories', async () => {
      mockRepository.getShopCategories.mockResolvedValueOnce([
        { id: 1, name: 'Souvenirs', sort_order: 1 },
        { id: 9, name: 'Gift Cards', sort_order: 2 },
      ]);
      const res = await service.getShopCategories();
      expect(mockRepository.getShopCategories).toHaveBeenCalled();
      expect(res).toEqual([{ id: 1, name: 'Souvenirs', sort_order: 1 }]);
    });

    it('getShopCatalog should call repository with query options and return catalog', async () => {
      const query = { category: 'souvenirs', featured: true };
      mockRepository.getShopCatalog.mockResolvedValueOnce({
        products: [
          {
            id: 1,
            name: 'Lamp',
            product_categories: { id: 1, name: 'Souvenirs' },
          },
          {
            id: 9,
            name: 'Gift Voucher',
            product_categories: { id: 9, name: 'Gift Cards' },
          },
        ],
        categories: [
          { id: 1, name: 'Souvenirs', sort_order: 1 },
          { id: 9, name: 'Gift Cards', sort_order: 2 },
        ],
      });
      const res = await service.getShopCatalog(query);
      expect(mockRepository.getShopCatalog).toHaveBeenCalledWith(query);
      expect(res).toEqual({
        products: [
          {
            id: 1,
            name: 'Lamp',
            product_categories: { id: 1, name: 'Souvenirs' },
          },
        ],
        categories: [{ id: 1, name: 'Souvenirs', sort_order: 1 }],
      });
    });

    it('getShopProductDetails should return product details when found', async () => {
      const res = await service.getShopProductDetails('1');
      expect(mockRepository.getShopProductDetails).toHaveBeenCalledWith('1');
      expect(res).toEqual({
        product: { id: 1, name: 'Item' },
        variants: [],
        skus: [],
      });
    });

    it('getShopProductDetails should throw NotFoundException if product is missing', async () => {
      mockRepository.getShopProductDetails.mockResolvedValueOnce({
        product: null,
        variants: [],
        skus: [],
      });
      await expect(service.getShopProductDetails('999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('getShopProductDetails should identify a paused gift-card catalog item', async () => {
      mockRepository.getShopProductDetails.mockResolvedValueOnce({
        product: {
          id: 9,
          name: 'Gift Voucher',
          product_categories: { id: 9, name: 'Gift Cards' },
        },
        variants: [],
        skus: [],
      });

      await expect(service.getShopProductDetails('9')).rejects.toThrow(
        'Gift card sales are temporarily unavailable',
      );
    });

    it('createProductOrder should call repository to persist order headers and items', async () => {
      mockRepository.getOrderableProductsByIds.mockResolvedValueOnce([
        {
          id: 1,
          name: 'Handmade Carpet',
          price: 100,
          currency: 'EUR',
          stock: 10,
          status: 'active',
          sku_id: null,
          sku_price: null,
          sku_stock: null,
          sku_label: null,
        },
      ]);
      const dto: CreateProductOrderDto = {
        currency: 'EUR',
        subtotal: 100,
        customerNotes: 'Please ring the bell',
        recipient: {
          name: 'John Smith',
          email: 'john@example.com',
          phone: '+905559876543',
          contact_method: 'phone_call',
        },
        items: [
          {
            productId: 1,
            productName: 'Handmade Carpet',
            quantity: 1,
            unitPrice: 100,
            finalPrice: 100,
            subtotal: 100,
          },
        ],
      };
      const res = await service.createProductOrder(dto, 'user-xyz');
      expect(mockRepository.getOrderableProductsByIds).toHaveBeenCalledWith(
        [1],
        [],
      );
      // Prices must be server-resolved from the DB, not taken from the DTO.
      expect(mockRepository.createProductOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          subtotal: 100,
          items: [
            expect.objectContaining({
              unitPrice: 100,
              finalPrice: 100,
              subtotal: 100,
            }),
          ],
        }),
        'user-xyz',
        undefined,
        null,
      );
      expect(res).toEqual({
        success: true,
        orderId: 77,
        message: 'Order placed successfully',
      });
    });

    it('createProductOrder should return an exact idempotent replay before catalog checks', async () => {
      const dto: CreateProductOrderDto = {
        requestId: '123e4567-e89b-42d3-a456-426614174000',
        guestAccessToken: 'a'.repeat(43),
        currency: 'EUR',
        subtotal: 1,
        recipient: {
          name: 'Guest',
          email: 'guest@example.com',
          phone: '+905551234567',
          contact_method: 'email',
        },
        items: [
          {
            productId: 1,
            productName: 'Client value',
            quantity: 1,
            unitPrice: 1,
            finalPrice: 1,
            subtotal: 1,
          },
        ],
      };
      mockRepository.getProductOrderReplay.mockResolvedValueOnce({
        success: true,
        orderId: 77,
        status: 'pending_payment',
        expiresAt: '2026-09-06T12:00:00.000Z',
        message: 'Order placed successfully',
      });

      await expect(service.createProductOrder(dto)).resolves.toMatchObject({
        orderId: 77,
        status: 'pending_payment',
      });
      expect(mockRepository.getProductOrderReplay).toHaveBeenCalledWith(
        dto.requestId,
        expect.objectContaining({
          subtotal: 1,
          items: [expect.objectContaining({ unitPrice: 1 })],
        }),
        undefined,
        expect.stringMatching(/^[0-9a-f]{64}$/),
      );
      expect(mockRepository.getOrderableProductsByIds).not.toHaveBeenCalled();
      expect(mockRepository.createProductOrder).not.toHaveBeenCalled();
    });

    it('createProductOrder should reject a new gift-card order before persistence', async () => {
      const dto: CreateProductOrderDto = {
        currency: 'EUR',
        subtotal: 50,
        recipient: {
          name: 'Guest',
          email: 'guest@example.com',
          phone: '+905551234567',
          contact_method: 'email',
        },
        items: [
          {
            productId: 9,
            productName: 'Gift Voucher',
            quantity: 1,
            unitPrice: 50,
            finalPrice: 50,
            subtotal: 50,
          },
        ],
      };
      mockRepository.getOrderableProductsByIds.mockResolvedValueOnce([
        {
          id: 9,
          name: 'Gift Voucher',
          price: 50,
          currency: 'EUR',
          stock: 3,
          status: 'active',
          skus: [],
          product_categories: { name: 'Gift Cards' },
        },
      ]);

      await expect(service.createProductOrder(dto)).rejects.toThrow(
        'Gift card sales are temporarily unavailable',
      );
      expect(mockRepository.createProductOrder).not.toHaveBeenCalled();
    });

    it('createProductOrder should return one generic conflict for idempotency mismatch', async () => {
      const dto = {
        requestId: '123e4567-e89b-42d3-a456-426614174000',
        guestAccessToken: 'b'.repeat(43),
        currency: 'EUR',
        subtotal: 25,
        recipient: {
          name: 'Customer',
          email: 'customer@example.com',
          phone: '+905551234567',
          contact_method: 'email' as const,
        },
        items: [
          {
            productId: 1,
            productName: 'Olive Oil',
            quantity: 1,
            unitPrice: 25,
            finalPrice: 25,
            subtotal: 25,
          },
        ],
      };
      mockRepository.getProductOrderReplay.mockRejectedValueOnce(
        new Error('Idempotency key conflict'),
      );

      await expect(
        service.createProductOrder(dto, 'different-owner'),
      ).rejects.toThrow(ConflictException);
      expect(mockRepository.getOrderableProductsByIds).not.toHaveBeenCalled();
    });

    it('createProductOrder should leave keyed stock validation to the atomic RPC', async () => {
      const dto = {
        requestId: '123e4567-e89b-42d3-a456-426614174000',
        guestAccessToken: 'c'.repeat(43),
        currency: 'EUR',
        subtotal: 25,
        recipient: {
          name: 'Customer',
          email: 'customer@example.com',
          phone: '+905551234567',
          contact_method: 'email' as const,
        },
        items: [
          {
            productId: 1,
            productName: 'Olive Oil',
            quantity: 1,
            unitPrice: 25,
            finalPrice: 25,
            subtotal: 25,
          },
        ],
      };
      mockRepository.getOrderableProductsByIds.mockResolvedValueOnce([
        {
          id: 1,
          name: 'Olive Oil',
          price: 25,
          currency: 'EUR',
          stock: 0,
          status: 'active',
          skus: [],
        },
      ]);

      await expect(service.createProductOrder(dto)).resolves.toMatchObject({
        orderId: 77,
      });
      expect(mockRepository.createProductOrder).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: dto.requestId }),
        undefined,
        expect.objectContaining({
          subtotal: 25,
          items: [expect.objectContaining({ unitPrice: 25 })],
        }),
        expect.stringMatching(/^[0-9a-f]{64}$/),
      );
    });

    it('createProductOrder should throw BadRequestException if items array is empty', async () => {
      const dto: CreateProductOrderDto = {
        currency: 'EUR',
        subtotal: 0,
        recipient: {
          name: 'John Smith',
          email: 'john@example.com',
          phone: '+905559876543',
          contact_method: 'email',
        },
        items: [],
      };
      await expect(service.createProductOrder(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('createProductOrder should throw BadRequestException if item subtotal does not match unit price * quantity', async () => {
      const dto: CreateProductOrderDto = {
        currency: 'EUR',
        subtotal: 100,
        recipient: {
          name: 'John Smith',
          email: 'john@example.com',
          phone: '+905559876543',
          contact_method: 'email',
        },
        items: [
          {
            productId: 'prod-1',
            productName: 'Handmade Carpet',
            quantity: 2,
            unitPrice: 50,
            finalPrice: 50,
            subtotal: 80, // Incorrect! Should be 100
          },
        ],
      };
      await expect(service.createProductOrder(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('createProductOrder should throw BadRequestException if header subtotal does not match sum of items', async () => {
      const dto: CreateProductOrderDto = {
        currency: 'EUR',
        subtotal: 90, // Incorrect! Sum of items is 100
        recipient: {
          name: 'John Smith',
          email: 'john@example.com',
          phone: '+905559876543',
          contact_method: 'email',
        },
        items: [
          {
            productId: 'prod-1',
            productName: 'Handmade Carpet',
            quantity: 2,
            unitPrice: 50,
            finalPrice: 50,
            subtotal: 100,
          },
        ],
      };
      await expect(service.createProductOrder(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('getFeaturedProducts should query repository with default limit', async () => {
      mockRepository.getFeaturedProducts.mockResolvedValueOnce([
        {
          id: 1,
          name: 'Lamp',
          product_categories: { id: 1, name: 'Souvenirs' },
        },
        {
          id: 9,
          name: 'Gift Voucher',
          product_categories: { id: 9, name: 'Gift Cards' },
        },
      ]);
      const res = await service.getFeaturedProducts(6);
      expect(mockRepository.getFeaturedProducts).toHaveBeenCalledWith(6);
      expect(res).toEqual([
        {
          id: 1,
          name: 'Lamp',
          product_categories: { id: 1, name: 'Souvenirs' },
        },
      ]);
    });

    it('getMyOrders should query repository for customer orders', async () => {
      const res = await service.getMyOrders('user-xyz');
      expect(mockRepository.getMyOrders).toHaveBeenCalledWith('user-xyz');
      expect(res).toEqual([
        {
          id: 77,
          currency: 'EUR',
          items: [],
        },
      ]);
    });

    it('getOrderById should return order if it belongs to requesting user', async () => {
      mockUserRolesRepo.getRole.mockResolvedValueOnce('user');
      mockRepository.getOrderById.mockResolvedValueOnce({
        id: 77,
        customer_id: 'user-xyz',
      });

      const res = await service.getOrderById('77', 'user-xyz');
      expect(res).toEqual({ id: 77 });
    });

    it('getOrderById should return order if requester is admin', async () => {
      mockUserRolesRepo.getRole.mockResolvedValueOnce('admin');
      mockRepository.getOrderById.mockResolvedValueOnce({
        id: 77,
        customer_id: 'different-user',
      });

      const res = await service.getOrderById('77', 'admin-user');
      expect(res).toEqual({ id: 77, customer_id: 'different-user' });
    });

    it('getOrderById should throw NotFoundException if order does not exist', async () => {
      mockUserRolesRepo.getRole.mockResolvedValueOnce('user');
      mockRepository.getOrderById.mockResolvedValueOnce(null);

      await expect(service.getOrderById('999', 'user-xyz')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('getOrderById should conceal an order belonging to another user', async () => {
      mockUserRolesRepo.getRole.mockResolvedValueOnce('user');
      mockRepository.getOrderById.mockResolvedValueOnce({
        id: 77,
        customer_id: 'other-user',
      });

      await expect(service.getOrderById('77', 'user-xyz')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('Seller (Business Dashboard)', () => {
    it.each([
      ['load', () => service.getMyProducts('seller-1')],
      [
        'create',
        () => service.createMyProduct({ name: 'Mug', price: 12 }, 'seller-1'),
      ],
      ['update', () => service.updateMyProduct(1, { price: 15 }, 'seller-1')],
      ['delete', () => service.deleteMyProduct(1, 'seller-1')],
    ])(
      'rejects %s when the seller has no active premium access',
      async (_action, call) => {
        mockUserRolesRepo.getRole.mockResolvedValueOnce('user');
        mockBillingService.hasActivePremiumAccess.mockResolvedValueOnce(false);

        await expect(call()).rejects.toThrow(ForbiddenException);
        expect(mockRepository.getMyCatalogItems).not.toHaveBeenCalled();
        expect(mockRepository.createCatalogItem).not.toHaveBeenCalled();
        expect(mockRepository.updateCatalogItem).not.toHaveBeenCalled();
      },
    );

    it('preserves admin access without requiring a premium subscription', async () => {
      mockUserRolesRepo.getRole.mockResolvedValueOnce('admin');
      mockRepository.getMyCatalogItems.mockResolvedValueOnce([]);

      await expect(service.getMyProducts('admin-1')).resolves.toEqual([]);
      expect(mockBillingService.hasActivePremiumAccess).not.toHaveBeenCalled();
    });

    it('getMyProducts should return catalog items owned by the seller', async () => {
      const items = [{ id: 1, name: 'Mug', seller_id: 'seller-1' }];
      mockRepository.getMyCatalogItems.mockResolvedValueOnce(items);

      await expect(service.getMyProducts('seller-1')).resolves.toBe(items);
      expect(mockRepository.getMyCatalogItems).toHaveBeenCalledWith('seller-1');
    });

    it('createMyProduct should default currency and stock and pass seller id', async () => {
      mockRepository.createCatalogItem.mockResolvedValueOnce({
        id: 9,
        name: 'Mug',
      });

      await service.createMyProduct({ name: 'Mug', price: 12.5 }, 'seller-1');

      expect(mockRepository.createCatalogItem).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Mug',
          price: 12.5,
          currency: 'EUR',
          stock: 0,
        }),
        'seller-1',
      );
    });

    it('updateMyProduct should throw NotFoundException when item is missing or foreign', async () => {
      mockRepository.updateCatalogItem.mockResolvedValueOnce(null);

      await expect(
        service.updateMyProduct(42, { price: 5 }, 'seller-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deleteMyProduct rejects a forged item id and deletes an owned item', async () => {
      mockRepository.deleteCatalogItem
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 42 });

      await expect(service.deleteMyProduct(42, 'seller-1')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.deleteMyProduct(42, 'seller-1')).resolves.toEqual({
        success: true,
      });
      expect(mockRepository.deleteCatalogItem).toHaveBeenLastCalledWith(
        42,
        'seller-1',
      );
    });

    it('getSellerOrders should return [] when seller has no catalog items', async () => {
      mockRepository.getMyCatalogItems.mockResolvedValueOnce([]);

      await expect(service.getSellerOrders('seller-1')).resolves.toEqual([]);
      expect(
        mockRepository.getOrdersContainingCatalogItems,
      ).not.toHaveBeenCalled();
    });

    it('getSellerOrders should expose only seller lines and fulfillment recipient fields', async () => {
      mockUserRolesRepo.getRole.mockResolvedValueOnce('user');
      mockRepository.getMyCatalogItems.mockResolvedValueOnce([
        { id: 3, name: 'Mug' },
        { id: 5, name: 'Plate' },
      ]);
      mockRepository.getOrdersContainingCatalogItems.mockResolvedValueOnce([
        {
          id: 77,
          currency: 'EUR',
          payment_provider: 'manual',
          status: 'paid',
          subtotal_items: 140,
          customer_notes: 'Private gift message',
          customer_id: 'customer-1',
          recipient: {
            name: 'Ayse',
            email: 'ayse@example.com',
            phone: '+905551234567',
            contact_method: 'phone_call',
          },
          created_at: '2026-08-30T10:00:00.000Z',
          items: [
            {
              id: 1,
              order_id: 77,
              product_id: '3',
              product_name: 'Mug',
              sku_id: '300',
              sku_label: 'Blue',
              quantity: 1,
              unit_price: 40,
              final_price: 40,
              subtotal: 40,
            },
            {
              id: 2,
              product_id: '9',
              product_name: 'Other seller item',
              quantity: 1,
              subtotal: 100,
            },
          ],
          can_manage_order: false,
        },
      ]);

      await expect(service.getSellerOrders('seller-1')).resolves.toEqual([
        {
          id: 77,
          currency: 'EUR',
          status: 'paid',
          recipient: { name: 'Ayse', email: 'ayse@example.com' },
          created_at: '2026-08-30T10:00:00.000Z',
          items: [
            {
              id: 1,
              product_name: 'Mug',
              sku_label: 'Blue',
              quantity: 1,
              subtotal: 40,
            },
          ],
          can_manage_order: false,
        },
      ]);
      expect(
        mockRepository.getOrdersContainingCatalogItems,
      ).toHaveBeenCalledWith([3, 5]);
    });

    it('getSellerOrders should expose quote controls and only fulfillment fields when seller owns every line', async () => {
      mockUserRolesRepo.getRole.mockResolvedValueOnce('user');
      mockRepository.getMyCatalogItems.mockResolvedValueOnce([
        { id: 3, name: 'Mug' },
      ]);
      mockRepository.getOrdersContainingCatalogItems.mockResolvedValueOnce([
        {
          id: 78,
          currency: 'EUR',
          status: 'pending_payment',
          recipient: { name: 'Ayse', email: 'ayse@example.com' },
          created_at: '2026-09-06T10:00:00.000Z',
          items: [
            {
              id: 3,
              product_id: '3',
              product_name: 'Mug',
              quantity: 1,
              subtotal: 40,
            },
          ],
        },
      ]);
      mockRepository.getOrdersByIds.mockResolvedValueOnce([
        {
          id: 78,
          customer_id: 'customer-1',
          customer_notes: 'Private note',
          currency: 'EUR',
          payment_provider: 'unselected',
          payment_reconciliation_status: 'none',
          status: 'pending_payment',
          subtotal_items: 40,
          delivery_fee: null,
          delivery_eta: null,
          delivery_quote_confirmed_at: null,
          total_amount: 40,
          reservation_expires_at: '2026-09-07T10:00:00.000Z',
          recipient: {
            name: 'Ayse',
            email: 'ayse@example.com',
            phone: '+905551234567',
            address: '10 Harbour Road',
            contact_method: 'phone_call',
            private_field: 'hidden',
          },
          created_at: '2026-09-06T10:00:00.000Z',
          items: [{ id: 3, product_id: '3', product_name: 'Mug' }],
        },
      ]);

      const [order] = await service.getSellerOrders('seller-1');

      expect(order).toMatchObject({
        id: 78,
        can_manage_order: true,
        payment_provider: 'unselected',
        total_amount: 40,
        recipient: {
          name: 'Ayse',
          email: 'ayse@example.com',
          phone: '+905551234567',
          address: '10 Harbour Road',
          contact_method: 'phone_call',
        },
      });
      expect(order).not.toHaveProperty('customer_id');
      expect(order).not.toHaveProperty('customer_notes');
      expect((order as Record<string, unknown>).recipient).not.toHaveProperty(
        'private_field',
      );
    });

    it('getSellerOrders should discard rows without an owned catalog line', async () => {
      mockUserRolesRepo.getRole.mockResolvedValueOnce('user');
      mockRepository.getMyCatalogItems.mockResolvedValueOnce([
        { id: 3, name: 'Mug' },
      ]);
      mockRepository.getOrdersContainingCatalogItems.mockResolvedValueOnce([
        {
          id: 77,
          recipient: { name: 'Customer', email: 'customer@example.com' },
          items: [{ id: 2, product_id: '9', product_name: 'Foreign item' }],
        },
      ]);

      await expect(service.getSellerOrders('seller-1')).resolves.toEqual([]);
    });

    it('getSellerOrders should return all orders for admin', async () => {
      mockUserRolesRepo.getRole.mockResolvedValueOnce('admin');
      mockRepository.getAllOrders.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);

      await expect(service.getSellerOrders('admin-1')).resolves.toHaveLength(2);
      expect(mockRepository.getMyCatalogItems).not.toHaveBeenCalled();
    });

    it('updateOrderStatus should apply a valid transition and persist it', async () => {
      mockRepository.getOrderById.mockResolvedValueOnce({
        id: 77,
        status: 'paid',
        items: [{ product_id: '3' }],
      });
      mockUserRolesRepo.getRole.mockResolvedValueOnce('user');
      mockRepository.sellerOwnsAllCatalogItems.mockResolvedValueOnce(true);
      mockRepository.updateOrderStatus.mockResolvedValueOnce({
        id: 77,
        status: 'shipped',
      });

      await expect(
        service.updateOrderStatus('77', 'shipped', 'seller-1'),
      ).resolves.toEqual({ id: 77, status: 'shipped' });
      expect(mockRepository.updateOrderStatus).toHaveBeenCalledWith(
        77,
        'shipped',
        'paid',
      );
    });

    it('updateOrderStatus should reject when a concurrent transition won the race', async () => {
      mockRepository.getOrderById.mockResolvedValueOnce({
        id: 77,
        status: 'paid',
        items: [{ product_id: '3' }],
      });
      mockUserRolesRepo.getRole.mockResolvedValueOnce('user');
      mockRepository.sellerOwnsAllCatalogItems.mockResolvedValueOnce(true);
      // Guarded UPDATE matched 0 rows — status changed concurrently.
      mockRepository.updateOrderStatus.mockResolvedValueOnce(null);

      await expect(
        service.updateOrderStatus('77', 'shipped', 'seller-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('updateOrderStatus should reject invalid transitions', async () => {
      mockRepository.getOrderById.mockResolvedValueOnce({
        id: 77,
        status: 'pending_payment',
        items: [],
      });
      mockUserRolesRepo.getRole.mockResolvedValueOnce('user');

      await expect(
        service.updateOrderStatus('77', 'shipped', 'seller-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('updateOrderStatus should reject sellers who own none of the ordered items', async () => {
      mockRepository.getOrderById.mockResolvedValueOnce({
        id: 77,
        status: 'paid',
        items: [{ product_id: '3' }],
      });
      mockUserRolesRepo.getRole.mockResolvedValueOnce('user');

      await expect(
        service.updateOrderStatus('77', 'shipped', 'intruder-1'),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockRepository.updateOrderStatus).not.toHaveBeenCalled();
    });

    it('updateOrderStatus should reject a seller who owns only some order lines', async () => {
      mockRepository.getOrderById.mockResolvedValueOnce({
        id: 77,
        status: 'paid',
        items: [
          { product_id: '3', sku_id: '300' },
          { product_id: '5', sku_id: '500' },
        ],
      });
      mockUserRolesRepo.getRole.mockResolvedValueOnce('user');
      mockRepository.sellerOwnsAllCatalogItems.mockResolvedValueOnce(false);

      await expect(
        service.updateOrderStatus('77', 'shipped', 'seller-1'),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockRepository.updateOrderStatus).not.toHaveBeenCalled();
    });

    it('updateOrderStatus should check catalog product ids rather than sku ids', async () => {
      mockRepository.getOrderById.mockResolvedValueOnce({
        id: 77,
        status: 'paid',
        items: [
          { product_id: '3', sku_id: '300' },
          { product_id: '5', sku_id: '500' },
        ],
      });
      mockUserRolesRepo.getRole.mockResolvedValueOnce('user');
      mockRepository.sellerOwnsAllCatalogItems.mockResolvedValueOnce(true);
      mockRepository.updateOrderStatus.mockResolvedValueOnce({
        id: 77,
        status: 'shipped',
      });

      await service.updateOrderStatus('77', 'shipped', 'seller-1');

      expect(mockRepository.sellerOwnsAllCatalogItems).toHaveBeenCalledWith(
        ['3', '5'],
        'seller-1',
      );
    });

    it('updateOrderStatus should reject empty orders for sellers', async () => {
      mockRepository.getOrderById.mockResolvedValueOnce({
        id: 77,
        status: 'paid',
        items: [],
      });
      mockUserRolesRepo.getRole.mockResolvedValueOnce('user');

      await expect(
        service.updateOrderStatus('77', 'shipped', 'seller-1'),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockRepository.sellerOwnsAllCatalogItems).not.toHaveBeenCalled();
      expect(mockRepository.updateOrderStatus).not.toHaveBeenCalled();
    });

    it('updateOrderStatus should skip ownership check for admin', async () => {
      mockRepository.getOrderById.mockResolvedValueOnce({
        id: 88,
        status: 'pending_payment',
        items: [],
      });
      mockUserRolesRepo.getRole.mockResolvedValueOnce('admin');
      mockRepository.updateOrderStatus.mockResolvedValueOnce({
        id: 88,
        status: 'cancelled',
      });

      await expect(
        service.updateOrderStatus('88', 'cancelled', 'admin-1'),
      ).resolves.toEqual({ id: 88, status: 'cancelled' });
      expect(mockRepository.sellerOwnsAllCatalogItems).not.toHaveBeenCalled();
    });

    describe.each([
      ['pending_payment', 'paid', true],
      ['pending_payment', 'cancelled', true],
      ['pending_payment', 'shipped', false],
      ['paid', 'shipped', true],
      ['paid', 'cancelled', true],
      ['paid', 'completed', false],
      ['shipped', 'completed', true],
      ['shipped', 'cancelled', false],
      ['completed', 'cancelled', false],
      ['cancelled', 'paid', false],
    ])('transition %s -> %s', (fromStatus, toStatus, allowed) => {
      it(`${allowed ? 'persists' : 'rejects'} the transition`, async () => {
        mockRepository.getOrderById.mockResolvedValueOnce({
          id: 50,
          status: fromStatus,
          items: [],
        });
        mockUserRolesRepo.getRole.mockResolvedValueOnce('admin');
        if (allowed) {
          mockRepository.updateOrderStatus.mockResolvedValueOnce({
            id: 50,
            status: toStatus,
          });
        }

        const call = () =>
          service.updateOrderStatus('50', toStatus as never, 'admin-1');

        if (allowed) {
          await expect(call()).resolves.toEqual({ id: 50, status: toStatus });
        } else {
          await expect(call()).rejects.toThrow(BadRequestException);
          expect(mockRepository.updateOrderStatus).not.toHaveBeenCalled();
        }
      });
    });

    it('updateOrderStatus should throw NotFoundException for unknown orders', async () => {
      mockRepository.getOrderById.mockResolvedValueOnce(null);

      await expect(
        service.updateOrderStatus('999', 'paid', 'seller-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delivery confirmation and payment access', () => {
    it('requires a distinct secure capability before creating a guest order', async () => {
      const dto = {
        requestId: '123e4567-e89b-42d3-a456-426614174000',
        currency: 'EUR',
        subtotal: 10,
        recipient: {
          name: 'Guest',
          email: 'guest@example.com',
          phone: '+905551234567',
          address: '10 Harbour Road',
          contact_method: 'email' as const,
        },
        items: [
          {
            productId: 1,
            productName: 'Tea',
            quantity: 1,
            unitPrice: 10,
            finalPrice: 10,
            subtotal: 10,
          },
        ],
      };

      await expect(service.createProductOrder(dto)).rejects.toThrow(
        'A secure guest access token is required',
      );
      expect(mockRepository.getProductOrderReplay).not.toHaveBeenCalled();
    });

    it('does not reveal a known sequential order id to the wrong guest token', async () => {
      mockRepository.getOrderById.mockResolvedValueOnce({
        id: 77,
        customer_id: null,
      });
      mockRepository.getOrderByGuestAccess.mockResolvedValueOnce(null);

      await expect(
        service.getOrderById('77', undefined, 'x'.repeat(43)),
      ).rejects.toThrow(NotFoundException);
      expect(mockRepository.getOrderByGuestAccess).toHaveBeenCalledWith(
        '77',
        expect.stringMatching(/^[0-9a-f]{64}$/),
      );
    });

    it('lets only an all-lines seller confirm one immutable quote through the RPC', async () => {
      mockRepository.getOrderById.mockResolvedValueOnce({
        id: 77,
        items: [{ product_id: '3' }, { product_id: '5' }],
      });
      mockUserRolesRepo.getRole.mockResolvedValueOnce('merchant');
      mockRepository.sellerOwnsAllCatalogItems.mockResolvedValueOnce(true);
      mockRepository.confirmDeliveryQuote.mockResolvedValueOnce({
        delivery_fee: 8.5,
        total_amount: 58.5,
      });

      await expect(
        service.confirmDeliveryQuote(
          '77',
          { deliveryFee: 8.5, deliveryEta: 'Tomorrow 10:00–12:00' },
          'seller-1',
        ),
      ).resolves.toMatchObject({ total_amount: 58.5 });
      expect(mockRepository.sellerOwnsAllCatalogItems).toHaveBeenCalledWith(
        ['3', '5'],
        'seller-1',
      );
    });

    it('creates online checkout from locked server quote and attaches its session', async () => {
      mockRepository.getOrderById.mockResolvedValueOnce({
        id: 77,
        customer_id: 'buyer-1',
      });
      mockUserRolesRepo.getRole.mockResolvedValueOnce('user');
      mockRepository.beginOnlinePayment.mockResolvedValueOnce({
        id: 77,
        currency: 'EUR',
        total_amount: 58.5,
        recipient: { email: 'buyer@example.com' },
        delivery_quote_confirmed_at: '2026-09-06T10:00:00.000Z',
        checkout_expires_at: '2026-09-06T11:00:00.000Z',
      });
      mockBillingService.createProductOrderCheckout.mockResolvedValueOnce({
        url: 'https://checkout.stripe.test/cs_77',
        sessionId: 'cs_77',
        expiresAt: '2026-09-06T11:00:00.000Z',
      });

      await expect(
        service.createOnlinePayment('77', 'buyer-1'),
      ).resolves.toEqual({ url: 'https://checkout.stripe.test/cs_77' });
      expect(
        mockBillingService.createProductOrderCheckout,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 77, amount: 58.5 }),
      );
      expect(mockRepository.attachOnlinePaymentSession).toHaveBeenCalledWith(
        77,
        'cs_77',
        '2026-09-06T11:00:00.000Z',
      );
    });
  });
});
