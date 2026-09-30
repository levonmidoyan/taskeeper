import { IconHome, type Icon } from '@tabler/icons-react';

export type Crumb = {
  label: string;
  /** Omitted on the last crumb, the current page. */
  href?: string;
  icon?: Icon;
  /** Icon-only crumb; the label is kept for screen readers. */
  iconOnly?: boolean;
};

/** First crumb on in-app pages: the workspace home, drawn as an icon. */
export function homeCrumb(workspaceSlug: string): Crumb {
  return { label: 'Home', href: `/${workspaceSlug}`, icon: IconHome, iconOnly: true };
}

export function workspaceSettingsCrumbs(workspaceSlug: string, page: string): Crumb[] {
  return [
    homeCrumb(workspaceSlug),
    // No settings index; General is where the switcher's first entry lands.
    { label: 'Workspace settings', href: `/${workspaceSlug}/settings/general` },
    { label: page },
  ];
}
