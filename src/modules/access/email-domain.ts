import { Resolver } from "node:dns/promises";

// S123 (owner 2026-10-25): in the production profile, sign-up and resend refuse an address whose domain
// cannot receive mail (no MX and no A/AAAA, or a null MX per RFC 7505). It fails open: a DNS timeout or
// server error lets the address through, so an outage never blocks sign-up. Local and test profiles skip
// it (handler.ts), so suites stay offline. The refusal is a 400 before any effect: it says something
// about the domain, never about an account.
type Lookup<T> = (domain: string) => Promise<T[]>;
type Resolvers = { mx: Lookup<{ exchange: string }>; a: Lookup<string>; aaaa: Lookup<string> };
// One try with a short per-query timeout, so a lookup the race below gave up on does not keep running.
const dns = new Resolver({ timeout: 1000, tries: 1 });
const system: Resolvers = { mx: (d) => dns.resolveMx(d), a: (d) => dns.resolve4(d), aaaa: (d) => dns.resolve6(d) };
const code = (error: unknown) => (error as { code?: string } | null)?.code ?? "";
const gone = (error: unknown) => ["ENOTFOUND", "ENODATA"].includes(code(error));

export async function domainReceivesMail(domain: string, resolvers: Resolvers = system) {
	try {
		const records = await resolvers.mx(domain);
		if (records.length) return !records.every((record) => record.exchange === "" || record.exchange === ".");
	} catch (error) {
		if (!gone(error)) return true;
		if (code(error) === "ENOTFOUND") return false;
	}
	for (const lookup of [resolvers.a, resolvers.aaaa]) {
		try {
			if ((await lookup(domain)).length) return true;
		} catch (error) {
			if (!gone(error)) return true;
		}
	}
	return false;
}

export async function emailDomainReceives(email: string, timeoutMs = 1500, resolvers?: Resolvers) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			domainReceivesMail(email.slice(email.lastIndexOf("@") + 1).toLowerCase(), resolvers),
			new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), timeoutMs); }),
		]);
	} finally {
		clearTimeout(timer);
	}
}
