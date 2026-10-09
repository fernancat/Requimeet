import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { HostPrincipal } from './auth.types';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { HostAuthGuard } from './host-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(HostAuthGuard)
  me(@Req() req: Request & { user: HostPrincipal }) {
    return this.authService.getById(req.user.hostUserId);
  }
}
