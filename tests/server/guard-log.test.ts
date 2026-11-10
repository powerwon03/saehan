import { afterEach, describe, expect, test, vi } from 'vitest';
import { withApi } from '@/server/auth/guard';

afterEach(() => vi.restoreAllMocks());

/** Shaped like drizzle-orm's DrizzleQueryError: message embeds the SQL and its bound params. */
class FakeDrizzleQueryError extends Error {
  constructor(
    public query: string,
    public params: unknown[],
    public override cause?: unknown,
  ) {
    super(`Failed query: ${query}\nparams: ${params.join(',')}`);
    this.name = 'DrizzleQueryError';
  }
}

async function logged(err: unknown): Promise<{ status: number; text: string }> {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const res = await withApi(async () => {
    throw err;
  })(new Request('http://localhost/api/x'));
  const text = spy.mock.calls.map((c) => JSON.stringify(c)).join('\n');
  return { status: res.status, text };
}

describe('withApi 서버 로그', () => {
  test('DB 오류 로그에 SQL 파라미터(비밀번호 해시·이름·전화)가 남지 않는다', async () => {
    const cause = Object.assign(new Error('duplicate key value violates unique constraint "accounts_login_uq"'), {
      code: '23505',
    });
    const err = new FakeDrizzleQueryError(
      'insert into "accounts" ("secret_hash", "name", "phone") values ($1, $2, $3)',
      ['scrypt$16384$8$1$SECRETSALT$SECRETHASH', '홍길동', '010-1234-5678'],
      cause,
    );
    const { status, text } = await logged(err);
    expect(status).toBe(500);
    expect(text).not.toContain('SECRETHASH');
    expect(text).not.toContain('홍길동');
    expect(text).not.toContain('010-1234-5678');
    expect(text).toContain('insert into');
    expect(text).toContain('23505');
  });

  test('메시지에 params: 가 붙은 다른 오류도 파라미터 부분을 잘라 낸다', async () => {
    const { text } = await logged(new Error('Failed query: select 1\nparams: SECRET-VALUE'));
    expect(text).not.toContain('SECRET-VALUE');
    expect(text).toContain('select 1');
  });
});
