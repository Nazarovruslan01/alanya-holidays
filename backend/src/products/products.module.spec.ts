import { Test } from '@nestjs/testing';
import { ProductsModule } from './products.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductOrdersService } from './product-orders.service';
import { SupabaseService } from '../supabase/supabase.service';
import { RedisService } from '../common/redis/redis.service';
import { PAYMENT_GATEWAY } from '../webhooks/domain/payment-gateway.interface';

it('assembles catalog and order services through the real ProductsModule', async () => {
  const module = await Test.createTestingModule({ imports: [ProductsModule] })
    .overrideProvider(SupabaseService)
    .useValue({ getClient: jest.fn() })
    .overrideProvider(RedisService)
    .useValue({})
    .overrideProvider(PAYMENT_GATEWAY)
    .useValue({})
    .compile();

  try {
    expect(module.get(ProductsController)).toBeInstanceOf(ProductsController);
    expect(module.get(ProductsService)).toBeInstanceOf(ProductsService);
    expect(module.get(ProductOrdersService)).toBeInstanceOf(
      ProductOrdersService,
    );
  } finally {
    await module.close();
  }
});
