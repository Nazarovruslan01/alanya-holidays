import {
  IsNumber,
  IsString,
  MaxLength,
  Min,
  IsNotEmpty,
} from 'class-validator';

export class ConfirmDeliveryQuoteDto {
  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 2 })
  @Min(0)
  deliveryFee!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  deliveryEta!: string;
}
