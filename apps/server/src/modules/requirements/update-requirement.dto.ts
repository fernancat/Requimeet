import { IsIn, IsString, Length, ValidateIf } from 'class-validator';

export class UpdateRequirementDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 5000)
  text?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['PENDING', 'CORRECTED', 'APPROVED'])
  status?: 'PENDING' | 'CORRECTED' | 'APPROVED';
}