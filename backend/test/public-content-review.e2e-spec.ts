jest.mock('sanitize-html', () => jest.fn((dirty: string) => dirty || ''));

import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminController } from '../src/admin/admin.controller';
import { AdminRepository } from '../src/admin/admin.repository';
import { AdminService } from '../src/admin/admin.service';
import { ModerationAuditService } from '../src/admin/moderation-audit.service';
import { AuthTokenService } from '../src/auth/auth-token.service';
import { UserRolesRepository } from '../src/common/auth/user-roles.repository';
import { BlogController } from '../src/blog/blog.controller';
import { BlogService } from '../src/blog/blog.service';

describe('Public content review HTTP boundary', () => {
  let app: INestApplication;
  const repository = {
    reviewPublicContent: jest.fn(),
    getPublicContentQueue: jest.fn(),
  };
  const audit = { logAction: jest.fn() };
  const blog = { approveBlogSubmission: jest.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminController, BlogController],
      providers: [
        { provide: AdminService, useValue: {} },
        { provide: BlogService, useValue: blog },
        { provide: AdminRepository, useValue: repository },
        { provide: ModerationAuditService, useValue: audit },
        {
          provide: UserRolesRepository,
          useValue: {
            getRole: (id: string) => (id === 'admin' ? 'admin' : 'guest'),
          },
        },
        {
          provide: AuthTokenService,
          useValue: {
            authenticateRequest: (context: ExecutionContext) => {
              const req = context.switchToHttp().getRequest<{
                headers: { authorization?: string };
                user?: { id: string };
              }>();
              const token = req.headers.authorization?.replace('Bearer ', '');
              if (!token) throw new UnauthorizedException();
              req.user = { id: token };
              return true;
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    repository.reviewPublicContent.mockImplementation(
      (input: { revision: number }) => {
        if (input.revision !== 7)
          throw new Error('Content changed; reload the review');
        return {
          id: 'post-1',
          moderation_status: 'approved',
          moderation_revision: 7,
        };
      },
    );
  });
  afterAll(async () => {
    await app.close();
  });
  const payload = {
    type: 'forum_posts',
    id: 'post-1',
    revision: 7,
    approve: true,
  };
  it('requires the editorial preview revision and forwards it with the authenticated administrator', async () => {
    await request(app.getHttpServer())
      .patch('/blog/submissions/submission-1/approve')
      .set('Authorization', 'Bearer admin')
      .send({})
      .expect(400);
    expect(blog.approveBlogSubmission).not.toHaveBeenCalled();
    blog.approveBlogSubmission.mockResolvedValueOnce({
      id: 'published-1',
      moderation_status: 'approved',
    });
    await request(app.getHttpServer())
      .patch('/blog/submissions/submission-1/approve')
      .set('Authorization', 'Bearer admin')
      .send({ revision: 8 })
      .expect(200);
    expect(blog.approveBlogSubmission).toHaveBeenCalledWith(
      'submission-1',
      'admin',
      8,
    );
  });
  it.each([undefined, 'member'])(
    'denies queue mutation for %s',
    async (token) => {
      const call = request(app.getHttpServer()).patch(
        '/admin/public-content/review',
      );
      if (token) call.set('Authorization', `Bearer ${token}`);
      await call.send(payload).expect(401);
      expect(repository.reviewPublicContent).not.toHaveBeenCalled();
    },
  );
  it('validates the table allowlist and requires a reviewed revision', async () => {
    await request(app.getHttpServer())
      .patch('/admin/public-content/review')
      .set('Authorization', 'Bearer admin')
      .send({ ...payload, type: 'profiles' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/admin/public-content/review')
      .set('Authorization', 'Bearer admin')
      .send({ type: 'forum_posts', id: 'post-1', approve: true })
      .expect(400);
    expect(repository.reviewPublicContent).not.toHaveBeenCalled();
  });
  it('rejects stale approval without a success audit', async () => {
    await request(app.getHttpServer())
      .patch('/admin/public-content/review')
      .set('Authorization', 'Bearer admin')
      .send({ ...payload, revision: 6 })
      .expect(409);
    expect(audit.logAction).not.toHaveBeenCalled();
  });
  it('forwards the exact reviewed revision and server actor, then records approval', async () => {
    await request(app.getHttpServer())
      .patch('/admin/public-content/review')
      .set('Authorization', 'Bearer admin')
      .send(payload)
      .expect(200);
    expect(repository.reviewPublicContent).toHaveBeenCalledWith(
      expect.objectContaining(payload),
      'admin',
    );
    expect(audit.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_id: 'post-1',
        admin_id: 'admin',
        action: 'approve',
      }),
    );
  });
});
