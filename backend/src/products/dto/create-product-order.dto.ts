import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
  IsIn,
  IsEmail,
  Min,
  IsNotEmpty,
  IsInt,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OrderRecipientDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  address?: string;

  @IsIn(['whatsapp', 'phone_call', 'email'])
  contact_method!: 'whatsapp' | 'phone_call' | 'email';
}

export class CreateOrderItemDto {
  @IsNotEmpty()
  productId!: string | number;

  @IsString()
  @IsNotEmpty()
  productName!: string;

  @IsOptional()
  skuId?: string | number | null;

  @IsOptional()
  @IsString()
  skuLabel?: string | null;

  @IsNumber()
  @IsInt()
  @Min(1)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsNumber()
  @Min(0)
  finalPrice!: number;

  @IsNumber()
  @Min(0)
  subtotal!: number;
}

export class CreateProductOrderDto {
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  guestAccessToken?: string;

  @IsString()
  @IsNotEmpty()
  currency!: string;

  @IsNumber()
  @Min(0)
  subtotal!: number;

  @IsOptional()
  @IsString()
  customerNotes?: string | null;

  @ValidateNested()
  @Type(() => OrderRecipientDto)
  recipient!: OrderRecipientDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
