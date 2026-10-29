'use server';

import { parseSetCookieHeader } from 'better-auth/cookies';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getLocalAuth } from '../../../modules/access/auth';
import { reorderAccountOrder, reorderFormInput, type ReorderState } from '../../../modules/accounts/reorder';
import { storefrontRequest } from '../../../modules/storefront/browser';

export async function reorderOrder(_previous: ReorderState, data: FormData): Promise<ReorderState> {
  let orderId: string;
  try { orderId = reorderFormInput(data); }
  catch { return { phase: 'error', message: 'Pesanan tidak valid. Muat ulang halaman dan coba kembali.', skipped: [] }; }
  const reply = await reorderAccountOrder(await storefrontRequest('POST'), getLocalAuth(), orderId);
  try {
    const store = await cookies();
    for (const raw of reply.cookies) for (const [name, attributes] of parseSetCookieHeader(raw)) {
      if (attributes.path !== '/' || attributes.httponly !== true || attributes.samesite !== 'lax' || typeof attributes['max-age'] !== 'number') throw new Error('Unexpected storefront cookie attributes');
      store.set(name, attributes.value, { path: '/', httpOnly: true, sameSite: 'lax', secure: attributes.secure === true, maxAge: attributes['max-age'] });
    }
  } catch { return { phase: 'error', message: 'Hasil tindakan belum diketahui. Periksa keranjang sebelum mencoba lagi.', skipped: reply.state.skipped }; }
  if (reply.added || reply.cookies.length) revalidatePath('/', 'layout');
  // A partial result stays on the page so the buyer sees what was not added.
  if (reply.added && !reply.unknown && !reply.state.skipped.length) redirect('/keranjang');
  return reply.state;
}
