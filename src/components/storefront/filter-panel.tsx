import {Icon} from './icon';
// Opens on wide screens during HTML parse, before first paint, so the panel never shifts the grid (CLS).
const OPEN_WIDE="document.currentScript.previousElementSibling.open=matchMedia('(min-width:701px)').matches";
export function FilterPanel({children}:{children:React.ReactNode}){
 // biome-ignore lint/security/noDangerouslySetInnerHtml: constant inline script, no user input.
 return <><details className="filters" suppressHydrationWarning><summary>Filter dan urutan<Icon name="chevron"/></summary>{children}</details><script dangerouslySetInnerHTML={{__html:OPEN_WIDE}}/></>;
}
