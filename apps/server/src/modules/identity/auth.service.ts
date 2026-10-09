import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { HostUser } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { StringValue } from 'ms';
import { PrismaService } from '../../prisma/prisma.service';
import { HostTokenPayload } from './auth.types';
import { LoginDto, RegisterDto } from './dto/auth.dto';

export interface SafeHostUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
}

export interface AuthResult {
  user: SafeHostUser;
  accessToken: string;
}

@Injectable()
export class AuthService {
  private readonly jwt: JwtService;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.jwt = new JwtService({
      secret: config.get<string>('JWT_HOST_SECRET', 'dev-host-secret'),
      signOptions: {
        expiresIn: config.get<string>('JWT_HOST_TTL', '12h') as StringValue,
      },
    });
  }

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.prisma.hostUser.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('email already registered');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.hostUser.create({
      data: {
        email: dto.email,
        passwordHash,
        displayName: dto.displayName,
      },
    });
    return { user: this.toSafe(user), accessToken: this.issueToken(user) };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.hostUser.findUnique({
      where: { email: dto.email },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('invalid credentials');
    }
    return { user: this.toSafe(user), accessToken: this.issueToken(user) };
  }

  async getById(id: string): Promise<SafeHostUser> {
    const user = await this.prisma.hostUser.findUnique({ where: { id } });
    if (!user) {
      throw new UnauthorizedException('host not found');
    }
    return this.toSafe(user);
  }

  verifyHostToken(token: string): HostTokenPayload {
    const payload = this.jwt.verify<HostTokenPayload>(token);
    if (payload.kind !== 'host') {
      throw new UnauthorizedException('not a host token');
    }
    return payload;
  }

  private issueToken(user: HostUser): string {
    return this.jwt.sign({ sub: user.id, kind: 'host' });
  }

  private toSafe(user: HostUser): SafeHostUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
    };
  }
}
