import {Icon} from '../ui/icon';
// No-JS filter form (inside <noscript>): a closed disclosure with the native GET form.
export function FilterPanel({children}:{children:React.ReactNode}){
 return <details className="filters"><summary>Filter dan urutan<Icon name="down"/></summary>{children}</details>;
}
