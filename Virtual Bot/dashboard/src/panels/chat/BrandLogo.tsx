import { Sparkle } from 'lucide-react';
import { BRAND_ICONS } from '@/vendor/lobe-icons';
import { cn } from '@/lib/cn';
import { brandOf, type CatalogModel } from './modelCatalog';

/**
 * The maker's logo for a model, or a neutral mark when the maker is unknown.
 *
 * The markup is the vendored lobe-icons set — static strings shipped with
 * the bundle, never model or network data — so injecting it is safe.
 */
export function BrandLogo({ model, className }: { model: CatalogModel; className?: string }) {
  const brand = brandOf(model);
  if (!brand) return <Sparkle aria-hidden="true" className={cn('size-4 shrink-0 text-ink-3', className)} />;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      fillRule="evenodd"
      className={cn('size-4 shrink-0', className)}
      dangerouslySetInnerHTML={{ __html: BRAND_ICONS[brand] }}
    />
  );
}
