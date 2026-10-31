import type {Metadata} from 'next';
import {siteConfig} from '../../config/site';
import {getLocalAuth} from '../../modules/access/auth';
import {publicMetadata} from '../../modules/storefront/seo';
import {pageBlocks,readStaticPage,STATIC_PAGES,type StaticSlug} from '../../modules/storefront/static-pages';
import {PlaceholderPage} from './placeholder-page';
import {Shell} from './shell';

// S-C1: a store page written in admin "Halaman". Until it has a version it stays the noindex placeholder.
const date=new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Jakarta'});
const summary=(body:string)=>{const text=pageBlocks(body).flatMap(b=>b.kind==='list'?b.items.map(i=>i.text):[b.text]).join(' ');return text.length>155?`${text.slice(0,152).replace(/\s+\S*$/,'')}…`:text;};

export async function staticPageMetadata(slug:StaticSlug):Promise<Metadata>{
 const page=await readStaticPage(getLocalAuth().sql,slug);
 if(!page) return {title:STATIC_PAGES[slug],robots:{index:false,follow:true}};
 return publicMetadata(siteConfig(),{path:`/${slug}`,title:page.title,description:summary(page.body)});
}

export async function StaticPageView({slug}:{slug:StaticSlug}){
 const page=await readStaticPage(getLocalAuth().sql,slug);
 if(!page) return <PlaceholderPage title={STATIC_PAGES[slug]}/>;
 return <Shell active="none"><main id="main" className="wrap help-main static-page">
  <h1>{page.title}</h1>
  <p className="help-lead">Diperbarui {date.format(new Date(page.updated_at))}</p>
  {pageBlocks(page.body).map((block)=>block.kind==='heading'?<h2 key={block.key}>{block.text}</h2>
   :block.kind==='list'?<ul key={block.key}>{block.items.map((item)=><li key={item.key}>{item.text}</li>)}</ul>
   :<p key={block.key}>{block.text}</p>)}
 </main></Shell>;
}
