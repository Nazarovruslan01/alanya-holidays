import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsObject,
  IsArray,
  IsUUID,
} from 'class-validator';

export class CreateItineraryDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsArray()
  itinerary!: unknown[];
}
