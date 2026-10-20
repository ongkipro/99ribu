// No brand favicon has been supplied. Avoid an implicit browser404 without
// inventing a logo; an approved asset can replace this response later.
export const dynamic='force-dynamic';
export function GET(){return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});}
