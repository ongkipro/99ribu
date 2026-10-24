import type {LocalAuth} from '../access/auth.ts';
import {photosById} from './department-photos.ts';

// Home promo banners (coordinator decision, round 50): the shop.com editorial rail of 410x520
// photo-led cards, at least three, each linking to a real destination. Content is dummy but true
// (no invented prices, savings or promises) and data-backed: a banner shows only while its photo is
// still published and its destination has content (a published mixed bundle, or the department in
// the current department list). An admin-managed source (S110) can replace this list later.
// Photos were picked by eye from contact sheets (round 51): item photos that are no product's cover,
// no hero, tile or department pick (so nothing repeats the sections above), high contrast, with no
// percentage, price, discount, claim or badge overlay (product labels only): Kopi Bali fragrance
// packs, a car dent puller, a men's sunglasses collage.
// `tint`: a cut-out product photo on white sits contained on that brand tint (the pill/tile tokens);
// without it the photo fills the media area edge to edge.
export type HomeBanner={id:string;title:string;body:string;href:string;action:string;photo:string;tint?:'amber'|'slate'|'rose'|'blue'|'green'|'violet'|'teal';needs:'bundles'|{department:string}};
export const HOME_BANNERS:readonly HomeBanner[]=[
 {id:'paket-campuran',title:'Paket campuran',body:'Misalnya pengharum mobil dan pengharum ruangan dalam satu pilihan lengkap Rp99.000.',href:'/promo',action:'Lihat paket',photo:'a9955ea80ee2',tint:'amber',needs:'bundles'},
 {id:'otomotif',title:'Rawat kendaraan sendiri',body:'Perlengkapan otomotif, setiap pilihan lengkap Rp99.000.',href:'/kategori/otomotif',action:'Lihat Otomotif',photo:'c6f35ee579a6',tint:'slate',needs:{department:'otomotif'}},
 {id:'fashion-pria',title:'Gaya pria sehari-hari',body:'Fashion pria, setiap pilihan lengkap Rp99.000.',href:'/kategori/fashion-pria',action:'Lihat Fashion Pria',photo:'0f510b5d7bd5',needs:{department:'fashion-pria'}},
];
export async function homeBanners(identity:LocalAuth,context:{bundles:number;departments:readonly {slug:string}[]}){
 const photos=await photosById(identity,HOME_BANNERS.map(b=>b.photo));
 const byId=new Map(HOME_BANNERS.map(b=>[b.photo,photos.find(p=>p.url.includes(`-${b.photo}.webp`)||p.url.includes(`/${b.photo}`))]));
 return HOME_BANNERS.flatMap(b=>{
  const photo=byId.get(b.photo);
  const needs=b.needs,live=needs==='bundles'?context.bundles>0:context.departments.some(d=>d.slug===needs.department);
  return photo&&live?[{...b,image:photo}]:[];
 });
}
