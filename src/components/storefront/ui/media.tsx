// Catalog photos are stored as originals (about 1000px webp). Every storefront <img> asks Next's
// built-in image optimizer (next.config `images.localPatterns` allows /media/catalog/** only) for
// resized candidates, so a 36px pill or a 160px card no longer downloads the full photo.
// Plain <img> + srcset keeps these server-rendered (next/image would add a client component).
const WIDTHS=[64,96,128,256,320,384,640,828,1080] as const;
export const optimizedUrl=(src:string,width:number)=>`/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=60`;
// `min`/`max` bound the candidates to what the slot can use, which also keeps the HTML small.
function responsiveImage(src:string,sizes:string,max=1080,min=64):{src:string;srcSet?:string;sizes?:string}{
 if(!src.startsWith('/media/catalog/')) return {src};
 const widths=WIDTHS.filter(width=>width<=max&&width>=min);
 return {src:optimizedUrl(src,widths[widths.length-1]),srcSet:widths.map(width=>`${optimizedUrl(src,width)} ${width}w`).join(', '),sizes};
}
// A catalog photo with its resized candidates; every other <img> attribute passes through.
export function CatalogImage({src,sizes,max,min,alt,...img}:{src:string;sizes:string;max?:number;min?:number;alt:string}&Omit<React.ImgHTMLAttributes<HTMLImageElement>,'src'|'sizes'|'srcSet'|'alt'>){
 // biome-ignore lint/performance/noImgElement: same native local media everywhere; next/image would add a client component.
 return <img {...responsiveImage(src,sizes,max,min)} alt={alt} {...img}/>;
}
