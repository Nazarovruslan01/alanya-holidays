import { ProductsRepository } from './products.repository';
import { SupabaseService } from '../supabase/supabase.service';

describe('ProductsRepository pagination', () => {
  const uuid = '123e4567-e89b-12d3-a456-426614174000';

  const builder = (terminal: Record<string, unknown>) => {
    const query: Record<string, jest.Mock> = {};
    for (const method of ['select', 'eq', 'or', 'order']) {
      query[method] = jest.fn().mockReturnValue(query);
    }
    query.range = jest.fn().mockResolvedValue(terminal);
    query.in = jest.fn().mockResolvedValue(terminal);
    return query;
  };

  it('applies the requested inclusive ranges to products and variants', async () => {
    const products = builder({ data: [], error: null });
    const variants = builder({ data: [], error: null });
    const client = {
      from: jest.fn((table: string) =>
        table === 'products' ? products : variants,
      ),
    };
    const repository = new ProductsRepository({
      getClient: () => client,
    } as unknown as SupabaseService);

    await repository.getProducts('food', 3, 10);
    await repository.getProductVariants(uuid, 2, 25);

    expect(products.order.mock.calls).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(variants.order.mock.calls).toEqual([
      ['created_at', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(products.range).toHaveBeenCalledWith(20, 29);
    expect(variants.range).toHaveBeenCalledWith(25, 49);
  });

  it('returns a counted searchable admin page beyond the first 20 products', async () => {
    const products = builder({
      data: [{ id: 21, name: 'Copper Lamp' }],
      error: null,
      count: 21,
    });
    products.or = jest.fn().mockReturnValue(products);
    const client = { from: jest.fn().mockReturnValue(products) };
    const repository = new ProductsRepository({
      getClient: () => client,
    } as unknown as SupabaseService);

    await expect(
      repository.getProductsAdmin(7, 2, 20, 'copper'),
    ).resolves.toEqual({
      items: [{ id: 21, name: 'Copper Lamp' }],
      page: 2,
      limit: 20,
      total: 21,
    });
    expect(products.or).toHaveBeenCalledWith(
      'name.ilike.%copper%,description.ilike.%copper%',
    );
    expect(products.eq).toHaveBeenCalledWith('category_id', 7);
    expect(client.from).toHaveBeenCalledWith('product_items');
    expect(products.range).toHaveBeenCalledWith(20, 39);
  });

  it('performs admin catalog create, update, get, and delete against product_items', async () => {
    const query: Record<string, jest.Mock> = {};
    for (const method of ['insert', 'update', 'delete', 'select', 'eq']) {
      query[method] = jest.fn().mockReturnValue(query);
    }
    query.single = jest.fn().mockResolvedValue({
      data: { id: 31, name: 'Lamp' },
      error: null,
    });
    query.maybeSingle = jest.fn().mockResolvedValue({
      data: { id: 31, name: 'Lamp' },
      error: null,
    });
    const client = { from: jest.fn().mockReturnValue(query) };
    const repository = new ProductsRepository({
      getClient: () => client,
    } as unknown as SupabaseService);

    await repository.createCatalogItemAdmin({ name: 'Lamp', status: 'active' });
    await repository.getCatalogItemAdmin(31);
    await repository.updateCatalogItemAdmin(31, { stock: 8 });
    await repository.deleteCatalogItemAdmin(31);

    expect(client.from).toHaveBeenCalledTimes(4);
    expect(client.from).toHaveBeenNthCalledWith(1, 'product_items');
    expect(client.from).toHaveBeenNthCalledWith(2, 'product_items');
    expect(client.from).toHaveBeenNthCalledWith(3, 'product_items');
    expect(client.from).toHaveBeenNthCalledWith(4, 'product_items');
    expect(query.insert).toHaveBeenCalledWith({
      name: 'Lamp',
      status: 'active',
    });
    expect(query.update).toHaveBeenCalledWith({ stock: 8 });
    expect(query.delete).toHaveBeenCalledTimes(1);
  });

  it('pages catalog products before restricting variants to current page IDs', async () => {
    const products = builder({
      data: [{ id: 21 }, { id: 22 }],
      error: null,
    });
    const categories = builder({ data: [], error: null });
    categories.order.mockResolvedValue({ data: [], error: null });
    const skus = builder({
      data: [{ product_id: 21 }, { product_id: 21 }],
      error: null,
    });
    const client = {
      from: jest.fn((table: string) => {
        if (table === 'product_items') return products;
        if (table === 'product_categories') return categories;
        return skus;
      }),
    };
    const repository = new ProductsRepository({
      getClient: () => client,
    } as unknown as SupabaseService);

    const result = await repository.getShopCatalog({ page: 3, limit: 10 });

    expect(products.order.mock.calls).toEqual([
      ['created_at', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(products.range).toHaveBeenCalledWith(20, 29);
    expect(client.from).toHaveBeenCalledWith('product_skus');
    expect(client.from).not.toHaveBeenCalledWith('product_variants');
    expect(skus.in).toHaveBeenCalledWith('product_id', [21, 22]);
    expect(result.products).toEqual([
      { id: 21, variant_count: 2 },
      { id: 22, variant_count: undefined },
    ]);
  });

  it('excludes the authoritative gift-card category before catalog pagination', async () => {
    const products = builder({
      data: [
        { id: 21, category_id: null },
        { id: 22, category_id: 7 },
      ],
      error: null,
    });
    const categories = builder({
      data: [
        { id: 7, name: 'Souvenirs', sort_order: 1 },
        { id: 9, name: 'Gift Cards', sort_order: 2 },
      ],
      error: null,
    });
    categories.order.mockResolvedValue({
      data: [
        { id: 7, name: 'Souvenirs', sort_order: 1 },
        { id: 9, name: 'Gift Cards', sort_order: 2 },
      ],
      error: null,
    });
    const skus = builder({ data: [], error: null });
    const client = {
      from: jest.fn((table: string) => {
        if (table === 'product_items') return products;
        if (table === 'product_categories') return categories;
        return skus;
      }),
    };
    const repository = new ProductsRepository({
      getClient: () => client,
    } as unknown as SupabaseService);

    const result = await repository.getShopCatalog({ page: 2, limit: 10 });

    expect(products.or).toHaveBeenCalledWith(
      'category_id.is.null,category_id.neq.9',
    );
    expect(products.or.mock.invocationCallOrder[0]).toBeLessThan(
      products.range.mock.invocationCallOrder[0],
    );
    expect(products.range).toHaveBeenCalledWith(10, 19);
    expect(result.products.map((product) => product.id)).toEqual([21, 22]);
  });

  it('excludes the gift-card category before applying the featured limit', async () => {
    const products = builder({
      data: [{ id: 7, category_id: null }],
      error: null,
    });
    products.limit = jest.fn().mockReturnValue(products);
    products.order.mockResolvedValue({
      data: [{ id: 7, category_id: null }],
      error: null,
    });
    const categories = builder({ data: [], error: null });
    categories.order.mockResolvedValue({
      data: [{ id: 9, name: 'Gift Cards', sort_order: 2 }],
      error: null,
    });
    const client = {
      from: jest.fn((table: string) =>
        table === 'product_items' ? products : categories,
      ),
    };
    const repository = new ProductsRepository({
      getClient: () => client,
    } as unknown as SupabaseService);

    await expect(repository.getFeaturedProducts(6)).resolves.toEqual([
      { id: 7, category_id: null },
    ]);

    expect(products.or).toHaveBeenCalledWith(
      'category_id.is.null,category_id.neq.9',
    );
    expect(products.limit).toHaveBeenCalledWith(6);
  });

  it('returns authoritative categories with orderable products', async () => {
    const query = {
      select: jest.fn(),
      in: jest.fn(),
      eq: jest.fn().mockResolvedValue({
        data: [
          {
            id: 9,
            name: 'Gift Voucher',
            price: 50,
            currency: 'EUR',
            stock: 3,
            status: 'active',
            product_categories: { name: 'Gift Cards' },
          },
        ],
        error: null,
      }),
    };
    query.select.mockReturnValue(query);
    query.in.mockReturnValue(query);
    const client = { from: jest.fn().mockReturnValue(query) };
    const repository = new ProductsRepository({
      getClient: () => client,
    } as unknown as SupabaseService);

    const result = await repository.getOrderableProductsByIds([9], []);

    expect(query.select).toHaveBeenCalledWith(
      expect.stringContaining('product_categories(name)'),
    );
    expect(result[0]?.product_categories).toEqual({ name: 'Gift Cards' });
  });

  it('loads numeric catalog item details without querying UUID product variants', async () => {
    const product = {
      select: jest.fn(),
      eq: jest.fn(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { id: 1, name: 'Catalog item' },
        error: null,
      }),
    };
    product.select.mockReturnValue(product);
    product.eq.mockReturnValue(product);

    const skus = {
      select: jest.fn(),
      eq: jest.fn(),
      order: jest.fn().mockResolvedValue({
        data: [{ id: 10, product_id: 1, label: 'Standard' }],
        error: null,
      }),
    };
    skus.select.mockReturnValue(skus);
    skus.eq.mockReturnValue(skus);

    const client = {
      from: jest.fn((table: string) =>
        table === 'product_items' ? product : skus,
      ),
    };
    const repository = new ProductsRepository({
      getClient: () => client,
    } as unknown as SupabaseService);

    const result = await repository.getShopProductDetails(1);

    expect(client.from).not.toHaveBeenCalledWith('product_variants');
    expect(skus.eq).toHaveBeenCalledWith('product_id', 1);
    expect(result).toEqual({
      product: { id: 1, name: 'Catalog item' },
      variants: [],
      skus: [{ id: 10, product_id: 1, label: 'Standard' }],
    });
  });

  it('constructs an inner-embedded seller order query without private header fields', async () => {
    const query: Record<string, jest.Mock> = {};
    for (const method of ['select', 'in', 'order']) {
      query[method] = jest.fn().mockReturnValue(query);
    }
    query.limit = jest.fn().mockResolvedValue({ data: [], error: null });
    const client = { from: jest.fn().mockReturnValue(query) };
    const repository = new ProductsRepository({
      getClient: () => client,
    } as unknown as SupabaseService);

    await repository.getOrdersContainingCatalogItems([3, 5]);

    const select = String(query.select.mock.calls[0][0]);
    expect(select).toContain('items:order_items!inner');
    expect(select).not.toMatch(
      /payment_provider|subtotal_items|customer_notes|customer_id/,
    );
    expect(query.in).toHaveBeenCalledWith('items.product_id', ['3', '5']);
  });

  it('requires ownership of every distinct catalog item in an order', async () => {
    const query: Record<string, jest.Mock> = {};
    for (const method of ['select', 'in', 'eq']) {
      query[method] = jest.fn().mockReturnValue(query);
    }
    query.limit = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ id: 3 }], error: null })
      .mockResolvedValueOnce({ data: [{ id: 3 }, { id: 5 }], error: null });
    const client = { from: jest.fn().mockReturnValue(query) };
    const repository = new ProductsRepository({
      getClient: () => client,
    } as unknown as SupabaseService);

    await expect(
      repository.sellerOwnsAllCatalogItems(['3', '3', '5'], uuid),
    ).resolves.toBe(false);
    await expect(
      repository.sellerOwnsAllCatalogItems(['3', '3', '5'], uuid),
    ).resolves.toBe(true);
    expect(query.in).toHaveBeenLastCalledWith('id', [3, 5]);
    expect(query.limit).toHaveBeenLastCalledWith(2);
  });
});
