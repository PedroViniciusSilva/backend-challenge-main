import { Type } from "class-transformer";
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from "class-validator";
import { WagerTransactionKind } from "../../../domain/models/WagerTransaction";

class MoneyDto {
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  amount!: string;

  @IsString()
  @IsNotEmpty()
  currency!: string;
}

export class ProcessWagerDto {
  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @IsString()
  @IsNotEmpty()
  externalTransactionId!: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsString()
  @IsNotEmpty()
  walletId!: string;

  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @IsString()
  @IsNotEmpty()
  roundId!: string;

  @IsString()
  @IsNotEmpty()
  gameId!: string;

  @IsIn(["BET", "WIN", "LOSS", "REFUND", "ROLLBACK"], {
    message: "kind deve ser BET, WIN, LOSS, REFUND ou ROLLBACK",
  })
  kind!: WagerTransactionKind;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message:
      "amount deve ser um valor monetario positivo com no maximo 2 casas decimais",
  })
  amount!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  currency!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyDto)
  money?: MoneyDto;

  @IsOptional()
  @IsString()
  referenceExternalTransactionId?: string;
}
