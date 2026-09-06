import { IsOptional, IsBoolean, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ProductPaginationQueryDto } from './product-pagination-query.dto';

export class GetShopCatalogQueryDto extends ProductPaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  featured?: boolean;
}
