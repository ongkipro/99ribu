import { headers } from "next/headers";
import { SignOutButton } from "../../../components/storefront/sign-out-button";
import { buttonVariants } from "../../../components/ui/button";
import { getLocalAuth } from "../../../modules/access/auth";

// Sign-in / sign-out entry for the console. Display only: pages and APIs keep their own authorization.
export async function AdminSessionBar() {
	const session = await getLocalAuth()
		.auth.api.getSession({
			headers: await headers(),
			query: { disableCookieCache: true },
		})
		.catch(() => null);
	return (
		<div
			className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 border-b px-4 py-1.5 text-sm md:py-2"
			data-testid="admin-session-bar"
		>
			{session?.user.emailVerified ? (
				<>
					<span className="min-w-0 truncate text-muted-foreground">
						Masuk sebagai{" "}
						<strong className="font-medium text-foreground">
							{session.user.email}
						</strong>
					</span>
					<SignOutButton
						className={buttonVariants({ variant: "outline", size: "sm" })}
						to="/masuk?next=%2Fadmin"
					/>
				</>
			) : (
				<>
					<span className="text-muted-foreground">
						Pratinjau tanpa sesi staf.
					</span>
					{/* Full document navigation: the storefront must not inherit the console stylesheet. */}
					<a
						className={buttonVariants({ size: "sm" })}
						href="/masuk?next=%2Fadmin"
					>
						Masuk sebagai staf
					</a>
				</>
			)}
		</div>
	);
}
