-- Migration 10: Reset all user data (transactions, quotes, stock)
-- Keeps the materials and prices catalog intact.
-- Leaves the app clean as if never used.

-- 1. Delete all saved quotes
DELETE FROM public.quotes;

-- 2. Delete all stock transactions
DELETE FROM public.transactions;

-- 3. Reset all material stock to 0
UPDATE public.materials SET current_stock = 0;
