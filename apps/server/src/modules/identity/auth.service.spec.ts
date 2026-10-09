import {
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';

const baseUser = {
  id: 'host-1',
  email: 'ana@example.com',
  passwordHash: '$2a$10$fakehashfakehashfakehashfakehashfakehashfakehashfa',
  displayName: 'Ana',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function buildService(prisma: Partial<PrismaService>) {
  const config = new ConfigService({ JWT_HOST_SECRET: 'test-secret' });
  return new AuthService(prisma as PrismaService, config);
}

describe('AuthService', () => {
  it('register hashea la password y no la devuelve', async () => {
    const create = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({ ...baseUser, ...data }),
    );
    const prisma = {
      hostUser: { findUnique: jest.fn().mockResolvedValue(null), create },
    };
    const service = buildService(prisma as unknown as PrismaService);

    const result = await service.register({
      email: 'ana@example.com',
      password: 'supersecreta',
      displayName: 'Ana',
    });

    const data = create.mock.calls[0][0].data;
    expect(data.passwordHash).not.toBe('supersecreta');
    expect(data.passwordHash).toMatch(/^\$2[ab]\$/);
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user.email).toBe('ana@example.com');
    expect(result.accessToken).toBeTruthy();
  });

  it('login con password incorrecta lanza Unauthorized', async () => {
    const prisma = {
      hostUser: {
        findUnique: jest.fn().mockResolvedValue({
          ...baseUser,
          passwordHash: await import('bcryptjs').then((b) =>
            b.hash('correcta123', 10),
          ),
        }),
      },
    };
    const service = buildService(prisma as unknown as PrismaService);

    await expect(
      service.login({ email: 'ana@example.com', password: 'incorrecta' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('email duplicado lanza Conflict', async () => {
    const prisma = {
      hostUser: {
        findUnique: jest.fn().mockResolvedValue(baseUser),
        create: jest.fn(),
      },
    };
    const service = buildService(prisma as unknown as PrismaService);

    await expect(
      service.register({
        email: 'ana@example.com',
        password: 'supersecreta',
        displayName: 'Ana',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.hostUser.create).not.toHaveBeenCalled();
  });
});
