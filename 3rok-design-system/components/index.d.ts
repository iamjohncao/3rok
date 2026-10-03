// 3rok components, exported on window.Rok
type Status = 'nominal' | 'caution' | 'critical';
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'solid' | 'ghost' | 'quiet'; size?: 'sm'; href?: string; arrow?: boolean }
export interface NavBarProps { brand?: string; homeHref?: string; links: { label: string; href?: string }[]; active?: string; action?: React.ReactNode }
export interface HeroProps { eyebrow?: string; title: string; text?: string; children?: React.ReactNode }
export interface PanelProps { eyebrow?: string; title?: string; children?: React.ReactNode }
export interface StatProps { label: string; value: string | number; unit?: string; delta?: React.ReactNode; status?: Status }
export interface StatusBadgeProps { status?: Status; children?: React.ReactNode }
export interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> { label: string; hint?: string; error?: string; mono?: boolean }
export interface TabsProps { tabs: { value: string; label: string }[]; value: string; onChange?: (value: string) => void }
export interface DataTableProps { columns: { key: string; label: string; numeric?: boolean; render?: (value: any, row: any) => React.ReactNode }[]; rows: Record<string, any>[] }
export interface ProgressBarProps { label: string; value: number; display?: string; tone?: 'caution' | 'critical' }
export interface PlacementMapProps { chips: { id: string; col: number; row: number; heat: number }[]; cols?: number; rows?: number; cell?: number; selected?: string; onSelect?: (id: string) => void; label?: string }
