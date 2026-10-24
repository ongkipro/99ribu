import type {Sql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {catalogMediaFileName} from '../../storage/catalog-media.ts';
import {photosById} from './department-photos.ts';

// Home promo banners (coordinator decision, round 50): the shop.com editorial rail of 410x520
// photo-led cards, at least three, each linking to a real destination. Content is dummy but true
// (no invented prices, savings or promises) and data-backed: a banner shows only while its photo is
// still published and its destination has content (a published mixed bundle, or the department in
// the current department list). S110: once staff have created any admin-managed banner, the home rail
// shows only the current admin banners (homeRailBanners below) and this list is no longer used.
// Photos were picked by eye from contact sheets (round 51): item photos that are no product's cover,
// no hero, tile or department pick (so nothing repeats the sections above), high contrast, with no
// percentage, price, discount, claim or badge overlay (product labels only): a reed diffuser
// still life (round 62 replaced the soft Kopi Bali packs), a car dent puller, a men's sunglasses collage.
// `tint`: a cut-out product photo on white sits contained on that brand tint (the pill/tile tokens);
// without it the photo fills the media area edge to edge.
export type HomeBanner={id:string;title:string;body:string;href:string;action:string;photo:string;tint?:'amber'|'slate'|'rose'|'blue'|'green'|'violet'|'teal';needs:'bundles'|{department:string}};
export const HOME_BANNERS:readonly HomeBanner[]=[
 {id:'paket-campuran',title:'Paket campuran',body:'Misalnya pengharum mobil dan pengharum ruangan dalam satu pilihan lengkap Rp99.000.',href:'/promo',action:'Lihat paket',photo:'5e496b28d84b',needs:'bundles'},
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

// S110 public projection: the current version of every admin-managed banner that is active, not retired and
// inside its window at `now` (starts_at inclusive, ends_at exclusive), in rail order. Only public fields leave
// this function (no actor, reason or audit data). `configured` is true once any banner identity exists, even
// retired or expired, so an empty result then hides the rail instead of bringing the defaults back.
export type CurrentBanner={id:string;title:string;subtitle:string|null;action_label:string;href:string;tint:string|null;image:{src:string;width:number;height:number;alt:string}};
export async function currentHomeBanners(sql:Sql,now=new Date()):Promise<{configured:boolean;banners:CurrentBanner[]}>{
 const at=now.toISOString();
 const [rows,[head]]=await Promise.all([
  sql`select h.id,v.title,v.subtitle,v.action_label,v.href,v.tint,v.image_sha256,v.image_width,v.image_height,v.image_alt
   from app.home_banner h join app.home_banner_version v on v.banner_id=h.id and v.revision=h.revision
   where v.active and not v.retired and v.starts_at<=${at}::timestamptz and v.ends_at>${at}::timestamptz
   order by v.position,h.created_at,h.id limit 24`,
  sql`select exists(select 1 from app.home_banner) as configured`,
 ]);
 return {configured:Boolean(head?.configured),banners:rows.map(row=>({id:String(row.id),title:String(row.title),subtitle:row.subtitle===null?null:String(row.subtitle),
  action_label:String(row.action_label),href:String(row.href),tint:row.tint===null?null:String(row.tint),
  image:{src:`/media/catalog/${catalogMediaFileName(String(row.title),String(row.image_sha256))}`,width:Number(row.image_width),height:Number(row.image_height),alt:String(row.image_alt)}}))};
}
