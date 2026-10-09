import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class CreateMeetingDto {
  @IsString()
  @Length(1, 120)
  title!: string;
}

export class CreateJoinRequestDto {
  @IsString()
  @Length(1, 80)
  displayName!: string;
}

export class ListJoinRequestsQuery {
  @IsOptional()
  @IsIn(['pending', 'accepted', 'rejected', 'cancelled'])
  status?: 'pending' | 'accepted' | 'rejected' | 'cancelled';
}
