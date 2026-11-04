// The unit badge on a header cart icon; the count is already in the link's accessible name.
export function CartCount({count}:{count:number}){
 return count>0?<b className="cart-count utility-count" aria-hidden="true">{count}</b>:null;
}
