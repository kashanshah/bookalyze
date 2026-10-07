-- Income, expense and equity categories take amounts in any currency; only assets and
-- liabilities (bank, card, clearing accounts…) can be kept to one. Categories saved with a
-- currency (the add-account form carried the bank default over) are freed. No amount changes.
UPDATE "accounts" SET "currency" = NULL
WHERE "type" IN ('income', 'expense', 'equity') AND "currency" IS NOT NULL;
