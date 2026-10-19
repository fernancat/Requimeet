import { IsInt, Min, IsOptional, IsIn, IsString, Length, ValidateIf } from 'class-validator';

export class UpdateRequirementDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsIn(['reopen', 'discard', 'restore']) action?: 'reopen' | 'discard' | 'restore';
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 5000)
  text?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['PENDING', 'CORRECTED', 'APPROVED'])
  status?: 'PENDING' | 'CORRECTED' | 'APPROVED';
}