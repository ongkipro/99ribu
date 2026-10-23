import {serializeJsonLd} from '../../modules/storefront/seo';

// Server-rendered structured data; serializeJsonLd escapes "<" so catalog text cannot end the script.
export function JsonLd({data}:{data:object}){
 // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD must be raw script text; input is escaped by serializeJsonLd.
 return <script type="application/ld+json" dangerouslySetInnerHTML={{__html:serializeJsonLd(data)}}/>;
}
