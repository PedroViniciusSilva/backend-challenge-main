import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

class InitialBalanceDto {
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  amount!: string;

  @IsString()
  @Length(3, 3)
  currency!: string;
}

export class OpenWalletDto {
  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => InitialBalanceDto)
  initialBalance?: InitialBalanceDto;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message:
      "initialAmount deve ser um valor monetário positivo com no máximo 2 casas decimais",
  })
  initialAmount?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}
