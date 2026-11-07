/**
 * Family Hub's fixed budget categories (v1.5), grouped like the owner's
 * expense-sharing app. Stored in budget_entries / recurring_expenses /
 * budget_limits.category as these stable keys; the app translates them and
 * draws each with its icon tile (client/src/familyhub/budgetCategories.tsx).
 */
export const BUDGET_CATEGORY_GROUPS = {
    food: ['restaurants', 'groceries', 'drinks', 'coffee', 'fast-food', 'bar'],
    entertainment: ['movies', 'sports', 'games', 'music', 'books', 'active-arts'],
    home: ['rent', 'mortgage', 'electricity', 'home-gas', 'water', 'internet', 'phone', 'television', 'maintenance', 'housekeeping', 'furniture'],
    transport: ['car', 'fuel', 'parking', 'rideshare', 'transit', 'flight', 'bicycle'],
    life: ['medical', 'pets', 'insurance', 'taxes', 'childcare', 'clothing', 'gifts', 'electronics', 'general'],
} as const;

export type BudgetCategory = (typeof BUDGET_CATEGORY_GROUPS)[keyof typeof BUDGET_CATEGORY_GROUPS][number];
export const BUDGET_CATEGORIES: readonly string[] = Object.values(BUDGET_CATEGORY_GROUPS).flat();
export const DEFAULT_BUDGET_CATEGORY: BudgetCategory = 'general';

export const isBudgetCategory = (value: unknown): value is BudgetCategory =>
    typeof value === 'string' && BUDGET_CATEGORIES.includes(value);

/**
 * OpenFamily's default budget categories (French keys) and where they move.
 * Each maps to a different key, so budget_limits' UNIQUE(user_id, category,
 * month, year) cannot collide. Categories a family invented stay as they are
 * and show as "General / Other" until edited.
 */
export const LEGACY_BUDGET_CATEGORIES: Readonly<Record<string, BudgetCategory>> = {
    Logement: 'rent',
    Alimentation: 'groceries',
    Transport: 'car',
    'Santé': 'medical',
    Loisirs: 'active-arts',
    Abonnements: 'television',
    Assurance: 'insurance',
    Enfants: 'childcare',
    Maison: 'maintenance',
    Autre: 'general',
};
