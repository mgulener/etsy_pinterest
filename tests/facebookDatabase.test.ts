import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, execFile } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const bin = process.env.POSTGRES_BIN ?? "/opt/homebrew/opt/postgresql@14/bin";
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const row = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

test("Facebook migration and database publication safeguards", { skip: !existsSync(join(bin, "initdb")), timeout: 60_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "facebook-db-test-"));
  const data = join(root, "data"); const socket = join(root, "socket");
  mkdirSync(socket);
  const env = { ...process.env, PGHOST: socket, PGPORT: "55483", PGUSER: "postgres", PGDATABASE: "postgres" };
  let started = false;
  t.after(() => {
    if (started) execFileSync(join(bin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    rmSync(root, { recursive: true, force: true });
  });
  execFileSync(join(bin, "initdb"), ["-D", data, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"], { stdio: "ignore" });
  execFileSync(join(bin, "pg_ctl"), ["-D", data, "-l", join(root, "postgres.log"), "-o", `-F -h '' -k ${socket} -p 55483`, "-w", "start"], { stdio: "ignore" });
  started = true;
  const sql = (statement: string) => execFileSync(join(bin, "psql"), ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.admin_users(id uuid primary key);`);
  sql(readFileSync(new URL("../supabase/migrations/0023_facebook_channel.sql", import.meta.url), "utf8"));
  sql(readFileSync(new URL("../supabase/migrations/0024_facebook_five_minute_interval.sql", import.meta.url), "utf8"));
  sql(`insert into admin_users values ('${owner}'),('${other}');
    insert into facebook_settings(user_id,page_id,page_name,page_access_token,api_version,verified_at)
      values ('${owner}','123','Test Page','test-token','v24.0',now()),('${other}','999','Other Page','other-token','v24.0',now());
    insert into facebook_queue(id,user_id,page_id,etsy_listing_id,title,image_url,destination_url,message,scheduled_at)
      values ('${row}','${owner}','123',456,'Halloween','https://i.etsystatic.com/image.jpg','https://www.etsy.com/listing/456','Draft',now()-interval '1 minute');`);
  const claim = `select id from claim_facebook_post('${owner}','123',false);`;
  await t.test("migration works without legacy helpers and timestamps advance on updates", () => {
    assert.equal(sql("select to_regprocedure('public.set_user_settings_updated_at()') is null"), "t");
    for (const table of ["facebook_settings", "facebook_queue"]) {
      const previous = sql(`select updated_at from ${table} where user_id='${owner}'`);
      sql(`update ${table} set updated_at='2000-01-01T00:00:00Z' where user_id='${owner}'`);
      assert.equal(sql(`select updated_at > '${previous}'::timestamptz from ${table} where user_id='${owner}'`), "t");
    }
  });
  await t.test("five minutes allowed and shorter intervals rejected", () => {
    sql(`update facebook_settings set interval_minutes=5 where user_id='${owner}'`);
    for (const interval of [0, 1, 4, 1441]) assert.throws(() => sql(`update facebook_settings set interval_minutes=${interval} where user_id='${owner}'`));
  });
  await t.test("defaults off and unprivileged API access denied", () => {
    assert.equal(sql(claim), "");
    assert.throws(() => sql(`set role anon; select * from facebook_settings`));
    assert.throws(() => sql(`set role authenticated; ${claim}`));
    assert.equal(sql(`select enabled || ',' || automatic_enabled from facebook_settings where user_id='${owner}'`), "false,false");
  });
  await t.test("automatic opt-out, wrong Page and wrong owner cannot claim", () => {
    sql(`update facebook_settings set enabled=true where user_id='${owner}'`);
    assert.equal(sql(`select id from claim_facebook_post('${owner}','123',true)`), "");
    assert.equal(sql(`select id from claim_facebook_post('${owner}','999',false)`), "");
    assert.equal(sql(`select id from claim_facebook_post('${other}','123',false)`), "");
  });
  await t.test("two simultaneous workers claim exactly once and durable intent blocks repeats", async () => {
    const run = promisify(execFile);
    sql(`update facebook_settings set automatic_enabled=true where user_id='${owner}'`);
    const requests = [false, true].map(automatic => run(join(bin, "psql"), ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", `select id from claim_facebook_post('${owner}','123',${automatic});`], { env }));
    const results = await Promise.all(requests);
    assert.equal(results.filter(result => result.stdout.trim() === row).length, 1);
    assert.equal(sql(`select status || ',' || attempt_count || ',' || (request_started_at is not null) from facebook_queue where id='${row}'`), "processing,1,true");
    assert.equal(sql(claim), "");
    sql(`update facebook_queue set status='needs_review' where id='${row}'`);
    assert.equal(sql(claim), "");
  });
  await t.test("receipt required for publication and interval enforced across rows", () => {
    assert.throws(() => sql(`update facebook_queue set status='published' where id='${row}'`));
    sql(`update facebook_queue set status='published',facebook_post_id='123_789',published_at=now() where id='${row}';
      insert into facebook_queue(user_id,page_id,etsy_listing_id,title,image_url,destination_url,message,scheduled_at)
      values ('${owner}','123',457,'Christmas','https://i.etsystatic.com/image.jpg','https://www.etsy.com/listing/457','Second draft',now()-interval '1 minute');`);
    assert.equal(sql(claim), "");
    sql(`update facebook_queue set published_at=now()-interval '6 minutes' where id='${row}'`);
    assert.ok(sql(claim));
  });
  await t.test("deduplication survives cancellation, and only pending unlocked current versions reschedule", () => {
    sql(`update facebook_queue set status='cancelled' where etsy_listing_id=457`);
    assert.throws(() => sql(`insert into facebook_queue(user_id,page_id,etsy_listing_id,title,image_url,destination_url,message)
      values ('${owner}','123',457,'Duplicate','image','url','text')`));
    const update = JSON.stringify([{ id: row, scheduled_at: "2030-01-01T00:00:00Z", updated_at: sql(`select updated_at from facebook_queue where id='${row}'`) }]);
    assert.equal(sql(`select schedule_facebook_posts('${owner}','123','${update}')`), "0");
    sql(`update facebook_queue set status='pending',schedule_locked=true where etsy_listing_id=457`);
    const pending = JSON.parse(sql(`select row_to_json(x) from (select id,updated_at,'2030-01-01T00:00:00Z' scheduled_at from facebook_queue where etsy_listing_id=457) x`));
    assert.equal(sql(`select schedule_facebook_posts('${owner}','123','${JSON.stringify([pending])}')`), "0");
    sql(`update facebook_queue set schedule_locked=false where etsy_listing_id=457`);
    assert.equal(sql(`select schedule_facebook_posts('${owner}','123','${JSON.stringify([pending])}')`), "0");
    pending.updated_at = sql(`select updated_at from facebook_queue where etsy_listing_id=457`);
    assert.equal(sql(`select schedule_facebook_posts('${other}','123','${JSON.stringify([pending])}')`), "0");
    assert.equal(sql(`select schedule_facebook_posts('${owner}','123','${JSON.stringify([pending])}')`), "1");
    assert.equal(sql(claim), "");
  });
});
