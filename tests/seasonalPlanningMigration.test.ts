import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bin = process.env.POSTGRES_BIN ?? "/opt/homebrew/opt/postgresql@14/bin";
test("seasonal migration is repeatable, preserves catalog, defaults off and isolates classification caches", {
  skip: !existsSync(join(bin, "initdb")), timeout: 60_000
}, t => {
  const root = mkdtempSync(join(tmpdir(), "seasonal-db-test-"));
  const data = join(root, "data"); const socket = join(root, "socket");
  mkdirSync(socket);
  let started = false;
  t.after(() => {
    if (started) execFileSync(join(bin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    rmSync(root, { recursive: true, force: true });
  });
  execFileSync(join(bin, "initdb"), ["-D", data, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"], { stdio: "ignore" });
  execFileSync(join(bin, "pg_ctl"), ["-D", data, "-l", join(root, "postgres.log"), "-o", `-F -h '' -k ${socket} -p 55486`, "-w", "start"], { stdio: "ignore" });
  started = true;
  const env = { ...process.env, PGHOST: socket, PGPORT: "55486", PGUSER: "postgres", PGDATABASE: "postgres" };
  const sql = (statement: string) => execFileSync(join(bin, "psql"), ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const alice = "00000000-0000-4000-8000-000000000001";
  const bob = "00000000-0000-4000-8000-000000000002";
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create table admin_users(id uuid primary key); insert into admin_users values('${alice}'),('${bob}');
    create table etsy_listings(id bigint primary key, title text); insert into etsy_listings values(42,'Original product');`);
  const migration = readFileSync(new URL("../supabase/migrations/0026_seasonal_planning.sql", import.meta.url), "utf8");
  sql(migration); sql(migration);
  assert.equal(sql("select title || ':' || cardinality(tags) from etsy_listings where id=42"), "Original product:0");
  sql(`insert into seasonal_planning_settings(user_id) values('${alice}')`);
  assert.equal(sql(`select enabled || ':' || lead_time_days from seasonal_planning_settings where user_id='${alice}'`), "false:14");
  assert.throws(() => sql(`update seasonal_planning_settings set lead_time_days=-1 where user_id='${alice}'`));
  for (const user of [alice, bob]) {
    sql(`insert into listing_event_classifications(user_id,etsy_listing_id,input_hash,classifier_version,model,classification)
      values('${user}',42,repeat('a',64),'v1','model','{"kind":"review"}')`);
  }
  assert.equal(sql("select count(*) from listing_event_classifications"), "2");
  assert.equal(sql("select relrowsecurity from pg_class where relname='listing_event_classifications'"), "t");
  assert.equal(sql("select has_table_privilege('anon','listing_event_classifications','select')"), "f");
  assert.equal(sql("select has_table_privilege('authenticated','seasonal_planning_settings','update')"), "f");
  assert.equal(sql(`set role service_role; select count(*) from listing_event_classifications where user_id='${alice}'`), "1");
  sql(`delete from admin_users where id='${alice}'`);
  assert.equal(sql("select count(*) from listing_event_classifications"), "1");
});
