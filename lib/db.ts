import postgres from "postgres";

type Types = { bigint: bigint; date: string };
export type Sql = postgres.Sql<Types>;
export type Tx = postgres.TransactionSql<Types>;
export type Db = Sql | Tx;

const DATE_OID = 1082;

export function connect(url: string): Sql {
  return postgres(url, {
    types: {
      // Money is BIGINT rial: return JS bigint, never string or number.
      bigint: postgres.BigInt,
      // DATE stays 'YYYY-MM-DD'; turning it into a JS Date would shift it by the timezone.
      date: {
        to: DATE_OID,
        from: [DATE_OID],
        serialize: (x: string) => x,
        parse: (x: string) => x,
      },
    },
    // snake_case in SQL, camelCase in TypeScript.
    transform: postgres.camel,
    connection: { TimeZone: "Asia/Tehran" },
    onnotice: () => {},
  }) as unknown as Sql;
}

/** Runs fn in a transaction, or inside the caller's transaction if it already has one. */
export async function withTx<T>(sql: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if ("savepoint" in sql) return fn(sql as Tx);
  return (await (sql as Sql).begin((tx) => fn(tx))) as T;
}

let appSql: Sql | undefined;

export function db(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  appSql ??= connect(url);
  return appSql;
}
