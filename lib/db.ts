import postgres from "postgres";

// BIGINT columns hold money in rial. Return them as JS bigint, never as string or number.
export function connect(url: string) {
  return postgres(url, {
    types: { bigint: postgres.BigInt },
    connection: { TimeZone: "Asia/Tehran" },
  });
}

let appSql: ReturnType<typeof connect> | undefined;

export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  appSql ??= connect(url);
  return appSql;
}
