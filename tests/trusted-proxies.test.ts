import { expect, test } from "vitest";
import { getTrustedProxies } from "../api/src/lib/trusted-proxies";

test("production requires an explicit proxy decision", () => {
  expect(() => getTrustedProxies(undefined, true)).toThrow();
  expect(getTrustedProxies("", true)).toBe(false);
  expect(getTrustedProxies(undefined, false)).toBe(false);
  expect(getTrustedProxies("127.0.0.1, ::1, 192.0.2.0/24", true)).toEqual(["127.0.0.1", "::1", "192.0.2.0/24"]);
});

test.each(["true", "0.0.0.0/0", "::/0", "localhost", "192.0.2.1/99", "::1/-1", "192.0.2.1/24/1"])("rejects unsafe or invalid proxy entry %s", (value) => {
  expect(() => getTrustedProxies(value, true)).toThrow();
});


test.each([
  "::ffff:0.0.0.0/96", "::ffff:c000:0201/96", "::ffff:0.0.0.0/95", "::/1",
  "0.0.0.0/1,128.0.0.0/1", "::ffff:0.0.0.0/97,::ffff:8000:0/97",
  "0.0.0.0/1,::ffff:8000:0/97",
])("rejects universal ranges including mapped and combined CIDRs: %s", (value) => {
  expect(() => getTrustedProxies(value, true)).toThrow();
});

test("allows specific mapped ranges", () => {
  expect(getTrustedProxies("::ffff:192.0.2.0/120,2001:db8::/32", true)).toEqual([
    "::ffff:192.0.2.0/120", "2001:db8::/32",
  ]);
});
