export function OfferPicker({choices,selected,from}:{choices:{id:string;label:string;available:boolean}[];selected:string;from?:string|null}){
 if(choices.length===1){const choice=choices[0],fact=<p className="offer-single">Pilihan lengkap: <strong>{choice.label}</strong>{!choice.available&&<span> · Belum tersedia</span>}</p>;
  return selected===choice.id?fact:<form method="get" className="offer-picker">{from&&<input type="hidden" name="from" value={from}/>}<input type="hidden" name="offer" value={choice.id}/>{fact}<button className="button secondary" type="submit">Lihat pilihan</button></form>;
 }
 return <form method="get" className="offer-picker">{from&&<input type="hidden" name="from" value={from}/>}<fieldset><legend>Pilihan lengkap</legend>{choices.map(v=><label key={v.id}><input type="radio" name="offer" value={v.id} defaultChecked={v.id===selected} required/><span>{v.label}{!v.available&&<small>Belum tersedia</small>}</span></label>)}</fieldset><p className="cart-advisory">Pilih opsi, lalu tekan Lihat pilihan untuk meninjau isi dan stoknya.</p><button className="button secondary" type="submit">Lihat pilihan</button></form>;
}
