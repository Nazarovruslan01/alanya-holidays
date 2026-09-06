import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UsersRepository } from './users.repository';
import { SupabaseService } from '../supabase/supabase.service';
import { ProductsRepository } from '../products/products.repository';
import { ForumRepository } from '../forum/forum.repository';
import { BlogRepository } from '../blog/blog.repository';
import { PublicMembersQueryDto } from './dto/public-members-query.dto';
import { GetShopCatalogQueryDto } from '../products/dto/get-shop-catalog-query.dto';
import { GetForumPostsQueryDto } from '../forum/dto/forum-posts.dto';

function fixture() {
  const query: Record<string, jest.Mock> = {};
  for (const method of [
    'select',
    'eq',
    'ilike',
    'or',
    'order',
    'range',
    'limit',
  ]) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  query.then = jest.fn((resolve: (value: unknown) => unknown) =>
    resolve({ data: [], count: 0, error: null }),
  );
  const service = {
    getClient: () => ({ from: jest.fn().mockReturnValue(query) }),
  } as unknown as SupabaseService;
  return { query, service };
}

describe('Public search boundaries', () => {
  it.each(['latest', 'popular'])(
    'gives discussion pages a unique tie-breaker for %s',
    async (sort) => {
      const { query, service } = fixture();
      await new ForumRepository(service).getPosts(
        { search: 'Alanya', sort },
        20,
        20,
      );
      expect(query.order.mock.calls.at(-1)).toEqual([
        'id',
        { ascending: true },
      ]);
      expect(query.range).toHaveBeenCalledWith(20, 39);
      expect(query.order.mock.invocationCallOrder.at(-1)).toBeLessThan(
        query.range.mock.invocationCallOrder[0],
      );
    },
  );

  it('bounds public discussion search to 200 characters', async () => {
    expect(
      await validate(
        plainToInstance(GetForumPostsQueryDto, { search: 'a'.repeat(200) }),
      ),
    ).toHaveLength(0);
    for (const length of [201, 10000]) {
      const errors = await validate(
        plainToInstance(GetForumPostsQueryDto, { search: 'a'.repeat(length) }),
      );
      expect(
        errors.some(
          (error) =>
            error.property === 'search' && error.constraints?.maxLength,
        ),
      ).toBe(true);
    }
  });

  it('searches member names before pagination and retains only public fields', async () => {
    const { query, service } = fixture();
    await new UsersRepository(service).getForumMembers(20, '  Alex_%  ', 40);
    expect(query.ilike).toHaveBeenCalledWith('full_name', '%Alex\\_\\%%');
    expect(query.range).toHaveBeenCalledWith(40, 59);
    expect(query.ilike.mock.invocationCallOrder[0]).toBeLessThan(
      query.range.mock.invocationCallOrder[0],
    );
    const projection = query.select.mock.calls[0][0] as string;
    expect(projection).not.toMatch(
      /\*|email|phone|iban|bank_name|crypto_wallet/,
    );
    expect(query.order).toHaveBeenCalledWith('id', { ascending: true });
  });

  it('keeps product visibility and gift-card exclusion before search pagination', async () => {
    const { query, service } = fixture();
    const repository = new ProductsRepository(service);
    jest
      .spyOn(repository, 'getShopCategories')
      .mockResolvedValue([{ id: 9, name: 'Gift Cards', sort_order: 0 }]);
    await repository.getShopCatalog({
      search: 'Cafe (100%)',
      page: 2,
      limit: 20,
    });
    expect(query.eq).toHaveBeenCalledWith('status', 'active');
    expect(query.or).toHaveBeenCalledWith(
      'category_id.is.null,category_id.neq.9',
    );
    expect(query.ilike).toHaveBeenCalledWith('name', '%Cafe (100\\%)%');
    expect(query.range).toHaveBeenCalledWith(20, 39);
    expect(query.or.mock.invocationCallOrder[0]).toBeLessThan(
      query.range.mock.invocationCallOrder[0],
    );
  });

  it('paginates events while retaining the published filter', async () => {
    const { query, service } = fixture();
    await new ForumRepository(service).getEvents({
      search: 'Meet_up',
      limit: 20,
      offset: 40,
    });
    expect(query.eq).toHaveBeenCalledWith('is_published', true);
    expect(query.ilike).toHaveBeenCalledWith('title', '%Meet\\_up%');
    expect(query.range).toHaveBeenCalledWith(40, 59);
  });

  it('keeps published blog search explicit even for an admin and quotes filter grammar', async () => {
    const { query, service } = fixture();
    const search = 'Cafe ),status.eq.draft,"';
    await new BlogRepository(service).getBlogPosts(
      { search, status: 'published', content_type: 'blog' },
      20,
      0,
      'admin',
      'admin-id',
    );
    expect(query.eq).toHaveBeenCalledWith('status', 'published');
    const value = JSON.stringify(`%${search}%`);
    expect(query.or).toHaveBeenCalledWith(
      `title.ilike.${value},content.ilike.${value}`,
    );
  });

  it('validates public query length, page size and offset', async () => {
    const valid = plainToInstance(PublicMembersQueryDto, {
      search: 'Аланья',
      limit: '20',
      offset: '40',
    });
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.offset).toBe(40);
    for (const payload of [
      { search: 'a'.repeat(201) },
      { limit: 101 },
      { offset: -1 },
      { offset: 0.5 },
    ]) {
      expect(
        (await validate(plainToInstance(PublicMembersQueryDto, payload)))
          .length,
      ).toBeGreaterThan(0);
    }
    expect(
      (
        await validate(
          plainToInstance(GetShopCatalogQueryDto, { search: 'a'.repeat(201) }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});
