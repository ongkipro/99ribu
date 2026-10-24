import assert from "node:assert/strict";
import type { APIRequestContext } from "@playwright/test";
import type { Sql } from "postgres";

// S123 (owner decision 2026-10-25): sign-up over HTTP takes name and email only; the account gets its
// password through the emailed set-password link, which also verifies the email. HTTP suites that need a
// signed-in synthetic account follow that link here (local delivery row, Better Auth redirect, reset).
export async function activateOverHttp(sql: Sql, request: APIRequestContext, email: string, password: string, origin = "http://127.0.0.1:3099") {
	const [message] = await sql`select url from app.local_delivery where recipient=${email} and kind='password_reset' order by created_at desc, id desc limit 1`;
	assert.ok(message, "Sign-up queued a set-password link");
	const landing = await request.get(message.url, { maxRedirects: 0 });
	assert.equal(landing.status(), 302);
	const token = new URL(landing.headers().location ?? "", origin).searchParams.get("token");
	assert.ok(token, "The link lands on /masuk/atur-sandi with its token");
	const reset = await request.post(`${origin}/api/auth/reset-password`, { headers: { origin }, data: { token, newPassword: password } });
	assert.equal(reset.status(), 200);
}
