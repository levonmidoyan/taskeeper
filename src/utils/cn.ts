import clsx, { type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { alignRadii, alignShadows, alignTexts } from '@/utils/align-tokens';

export { type ClassValue } from 'clsx';

export const twMergeConfig = {
  extend: {
    classGroups: {
      'font-size': [{ text: [...alignTexts] }],
      shadow: [{ shadow: [...alignShadows] }],
      rounded: [{ rounded: [...alignRadii] }],
    },
  },
};

const customTwMerge = extendTailwindMerge(twMergeConfig);

/** clsx plus a tailwind-merge that knows Align's custom scales. */
export function cn(...classes: ClassValue[]) {
  return customTwMerge(clsx(...classes));
}
