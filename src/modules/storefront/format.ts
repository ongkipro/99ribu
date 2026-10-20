export const rupiah=(amount:number)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(amount).replace(/\s+/g,'');
