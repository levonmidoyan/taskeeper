/**
 * Align's custom scale names, so tailwind-merge can group them. The starter repo imported
 * these from tailwind.config.ts, which a Tailwind v4 CSS-first project does not have.
 */
export const alignTexts = [
  'doc-label', 'doc-paragraph',
  'label-2xs', 'label-xs', 'label-sm', 'label-md', 'label-lg', 'label-xl',
  'paragraph-xs', 'paragraph-sm', 'paragraph-md', 'paragraph-lg', 'paragraph-xl',
  'subheading-2xs', 'subheading-xs', 'subheading-sm', 'subheading-md',
  'title-h1', 'title-h2', 'title-h3', 'title-h4', 'title-h5', 'title-h6',
] as const;

export const alignShadows = [
  'button-error-focus', 'button-important-focus', 'button-primary-focus',
  'colored-gray', 'complex', 'complex-2', 'complex-4', 'complex-5', 'complex-6', 'complex-7',
  'complex-8', 'complex-9', 'complex-10', 'complex-11', 'complex-12',
  'custom-input', 'custom-input-2', 'custom-input-3', 'custom-input-4', 'custom-input-active',
  'custom-xs', 'custom-sm', 'custom-md', 'custom-lg',
  'fancy-buttons-error', 'fancy-buttons-neutral', 'fancy-buttons-primary', 'fancy-buttons-stroke',
  'gray-shadow', 'gray-shadow-4', 'regular-xs', 'regular-sm', 'regular-md',
  'switch-thumb', 'toggle-switch', 'tooltip',
] as const;

export const alignRadii = ['10', '20'] as const;
