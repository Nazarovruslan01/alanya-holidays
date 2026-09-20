import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ProductsRepository,
  ProductCategoryRow,
  ProductItemRow,
  ProductSkuRow,
  ShopCatalogResult,
} from './products.repository';
import { UserRolesRepository } from '../common/auth/user-roles.repository';
import { GetShopCatalogQueryDto } from './dto/get-shop-catalog-query.dto';
import {
  CreateSellerProductDto,
  UpdateSellerProductDto,
} from './dto/seller-product.dto';
import {
  CreateProductDto,
  CreateProductVariantDto,
  UpdateProductDto,
  UpdateProductVariantDto,
} from './dto/product-write.dto';
import {
  PAUSED_GIFT_CARD_CATEGORY,
  isPausedGiftCard,
} from './product-sales-policy';
import { BillingService } from '../billing/billing.service';
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
    return products.filter((product) => !isPausedGiftCard(product));
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

  // --- Shop Catalog ---

  async getShopCategories(): Promise<ProductCategoryRow[]> {
    const categories = await this.productsRepository.getShopCategories();
    return categories.filter(
      (category) => category.name !== PAUSED_GIFT_CARD_CATEGORY,
    );
  }

  async getShopCatalog(
    query?: GetShopCatalogQueryDto,
  ): Promise<ShopCatalogResult> {
    const catalog = await this.productsRepository.getShopCatalog(query);
    return {
      products: catalog.products.filter(
        (product) => !isPausedGiftCard(product),
      ),
      categories: catalog.categories.filter(
        (category) => category.name !== PAUSED_GIFT_CARD_CATEGORY,
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
    if (isPausedGiftCard(result.product)) {
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
        media: dto.media ?? [],
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
}
