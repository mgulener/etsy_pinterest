import assert from "node:assert/strict";
import test from "node:test";
import { createReadRetryFetch } from "../lib/supabase/readRetry";
import { createOptionalReader } from "../lib/utils/optionalRead";

test("future-issued JWT read retries and recovers", async () => {
  let calls = 0;
  const delays: number[] = [];
  const request = createReadRetryFetch(async () => ++calls === 1
    ? new Response('{"message":"JWT issued at future"}', { status: 401 })
    : new Response("ok"), async ms => { delays.push(ms); });
  assert.equal(await (await request("https://example.com")).text(), "ok");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [500]);
});

test("persistent gateway errors stop after three attempts", async () => {
  let calls = 0;
  const request = createReadRetryFetch(async () => { calls++; return new Response("busy", {status:503}); }, async () => {});
  assert.equal((await request("https://example.com", {method:"HEAD"})).status, 503);
  assert.equal(calls, 3);
});

test("mutations and ordinary authorization errors never retry", async () => {
  for (const method of ["POST", "PATCH", "DELETE", "PUT", "GET"]) {
    let calls=0;
    const request=createReadRetryFetch(async () => {calls++; return new Response("Invalid JWT", {status:401});}, async () => {});
    await request("https://example.com", {method});
    assert.equal(calls,1);
  }
  let calls=0;
  const request=createReadRetryFetch(async () => {calls++;return new Response("JWT issued at future",{status:401});},async()=>{});
  await request(new Request("https://example.com",{method:"POST"}));
  assert.equal(calls,1);
});

test("read network failures retry but aborted reads do not", async () => {
  let calls=0;
  const request=createReadRetryFetch(async () => {if(++calls<3)throw new TypeError("fetch failed");return new Response("ok");},async()=>{});
  assert.equal((await request("https://example.com")).status,200);
  const controller=new AbortController();controller.abort();calls=0;
  const aborting=createReadRetryFetch(async()=>{calls++;throw new TypeError("aborted");},async()=>{});
  await assert.rejects(aborting("https://example.com",{signal:controller.signal}));
  assert.equal(calls,1);
});

test("optional reads preserve zero and false and expose failures as unavailable", async () => {
  const reader=createOptionalReader();
  assert.equal(await reader.read("count",Promise.resolve(0),null),0);
  assert.equal(await reader.read("bootstrap",Promise.resolve(false),null),false);
  assert.equal(await reader.read("progress",Promise.reject(new Error("private provider response")),null),null);
  assert.deepEqual(reader.failures,["progress"]);
});
