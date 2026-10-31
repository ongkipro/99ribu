import {StaticPageView,staticPageMetadata} from '../../../components/storefront/static-page';
// S-C1: content from admin "Halaman"; the noindex placeholder until the first version is saved.
export const dynamic='force-dynamic';
export function generateMetadata(){return staticPageMetadata('syarat');}
export default function Page(){return <StaticPageView slug="syarat"/>;}
