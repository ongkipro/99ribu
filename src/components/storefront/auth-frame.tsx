import Link from 'next/link';
import {SiteNotice} from './ui/brand';
import {Icon} from './ui/icon';

// Focused sign-in frame (owner 2026-10-30, shop.com login page): no store header, category rail, footer or phone
// dock. One way back to the shop (the close button, top right) and the sign-in column centred in the viewport; the
// sign-up form carries the terms and privacy sentence, so there is no footer.
// Used by /masuk and the signed-out /akun; the intercepted /masuk modal keeps the page under it instead.
export function AuthFrame({children}:{children:React.ReactNode}){
 return <><SiteNotice/>
  <div className="auth-frame">
   <header className="auth-top"><Link href="/" className="auth-back" aria-label="Kembali ke toko"><Icon name="close"/></Link></header>
   <main id="main" className="auth-main">{children}</main>
  </div>
 </>;
}
