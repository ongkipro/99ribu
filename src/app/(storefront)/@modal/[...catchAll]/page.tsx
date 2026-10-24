// A client navigation away from the open modal (e.g. its "Akun" link) must clear the slot: an unmatched
// slot keeps its last state on soft navigation.
export default function CatchAll() {
	return null;
}
