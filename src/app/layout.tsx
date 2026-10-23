import type {Metadata,Viewport} from 'next';
import {siteConfig} from '../config/site';
import {rootMetadata} from '../modules/storefront/seo';
import './globals.css';

// Safe default: every route is noindex until it opts in through publicMetadata (seo.ts routePolicy).
export function generateMetadata():Metadata{return rootMetadata(siteConfig());}
export const viewport:Viewport={themeColor:'#5b35d5'};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="id-ID"><body>{children}</body></html>;
}
