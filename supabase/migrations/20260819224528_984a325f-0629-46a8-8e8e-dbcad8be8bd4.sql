ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS image_path text;

ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS menu_items_pricing_type_check;

ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_pricing_type_check
  CHECK (pricing_type IN ('fixed', 'weight', 'manual', 'size', 'inch', 'both'));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS categories_updated_at ON public.categories;
CREATE TRIGGER categories_updated_at
BEFORE UPDATE ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS menu_items_updated_at ON public.menu_items;
CREATE TRIGGER menu_items_updated_at
BEFORE UPDATE ON public.menu_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();