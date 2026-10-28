import type {DescriptionBlock} from '../../../modules/storefront/description';

// Plain-text catalog description as paragraphs and real lists (hanging indent); see modules/storefront/description.ts.
export function ProductDescription({blocks}:{blocks:readonly DescriptionBlock[]}){
 return <div className="detail-description">{blocks.map(block=>{
  const gap=block.gap?'desc-gap':undefined;
  if(block.kind==='text')return <p key={block.id} className={gap}>{block.text}</p>;
  if(block.kind==='bullets')return <ul key={block.id} className={gap}>{block.items.map(item=><li key={item.id}>{item.text}</li>)}</ul>;
  return <ol key={block.id} className={gap}>{block.items.map(item=><li key={item.id} value={item.value}>{item.text}</li>)}</ol>;
 })}</div>;
}
