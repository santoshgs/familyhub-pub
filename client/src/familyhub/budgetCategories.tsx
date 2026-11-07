import {
    Baby, Beer, Bike, BookOpen, Building2, Bus, Car, CarTaxiFront, Clapperboard, Coffee, Droplets, Flame, Fuel, Gamepad2, Gift,
    House, Landmark, Laptop, Music, Palette, PawPrint, Plane, Receipt, Sandwich, Shirt, ShieldCheck, ShoppingCart, Smartphone,
    Sofa, SprayCan, SquareParking, Stethoscope, Trophy, Tv, Utensils, Wifi, Wine, Wrench, Zap, type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Family Hub's fixed budget categories (v1.5), grouped like an expense-sharing
 * app: a line icon on a pastel tile, one colour per group. Keep the keys in
 * sync with server/src/lib/budgetCategories.ts.
 */
export const CATEGORY_GROUPS = [
    { key: 'food', tile: '#dcebdd', ink: '#2f5a37', items: [['restaurants', Utensils], ['groceries', ShoppingCart], ['drinks', Wine], ['coffee', Coffee], ['fast-food', Sandwich], ['bar', Beer]] },
    { key: 'entertainment', tile: '#e6e0f4', ink: '#4c3d7a', items: [['movies', Clapperboard], ['sports', Trophy], ['games', Gamepad2], ['music', Music], ['books', BookOpen], ['active-arts', Palette]] },
    { key: 'home', tile: '#d3e6ef', ink: '#264f63', items: [['rent', Building2], ['mortgage', House], ['electricity', Zap], ['home-gas', Flame], ['water', Droplets], ['internet', Wifi], ['phone', Smartphone], ['television', Tv], ['maintenance', Wrench], ['housekeeping', SprayCan], ['furniture', Sofa]] },
    { key: 'transport', tile: '#f1d8e0', ink: '#7a2c45', items: [['car', Car], ['fuel', Fuel], ['parking', SquareParking], ['rideshare', CarTaxiFront], ['transit', Bus], ['flight', Plane], ['bicycle', Bike]] },
    { key: 'life', tile: '#f0eecb', ink: '#5e5916', items: [['medical', Stethoscope], ['pets', PawPrint], ['insurance', ShieldCheck], ['taxes', Landmark], ['childcare', Baby], ['clothing', Shirt], ['gifts', Gift], ['electronics', Laptop], ['general', Receipt]] },
] as const satisfies ReadonlyArray<{ key: string; tile: string; ink: string; items: ReadonlyArray<readonly [string, LucideIcon]> }>;

export type CategoryGroupKey = (typeof CATEGORY_GROUPS)[number]['key'];
export const BUDGET_CATEGORY_KEYS: string[] = CATEGORY_GROUPS.flatMap((group) => group.items.map(([key]) => key));
export const DEFAULT_CATEGORY = 'general';

const lookup = new Map<string, { icon: LucideIcon; tile: string; ink: string; group: CategoryGroupKey }>(
    CATEGORY_GROUPS.flatMap((group) => group.items.map(([key, icon]) => [key, { icon, tile: group.tile, ink: group.ink, group: group.key }] as const)),
);
/** Older or invented categories show with the "General / Other" look. */
export const categoryStyle = (key: string) => lookup.get(key) ?? lookup.get(DEFAULT_CATEGORY)!;
export const isKnownCategory = (key: string) => lookup.has(key);

export function useCategoryLabel() {
    const { t } = useTranslation('budget');
    return (key: string) => t(`categories.${key}`, { defaultValue: key });
}

/** The pastel square with the category's line icon. */
export function CategoryTile({ category, size = 40 }: { category: string; size?: number }) {
    const style = categoryStyle(category);
    const Icon = style.icon;
    return <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center rounded-md"
        style={{ width: size, height: size, background: style.tile, color: style.ink }}>
        <Icon size={Math.round(size * 0.55)} strokeWidth={1.6} />
    </span>;
}
