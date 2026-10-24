import { SignInModal } from "../../../../components/storefront/sign-in-modal";
import { SignInPanel } from "../../../../components/storefront/sign-in-panel";

// /masuk reached by client navigation from a storefront page: the same sign-in content in a modal.
export default async function SignInModalPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
	return (
		<SignInModal>
			<SignInPanel params={await searchParams} modal />
		</SignInModal>
	);
}
