"use client"

import type { AdminAuthClient } from "@better-auth-ui/core/plugins/admin"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { useAdminPermission } from "@better-auth-ui/react/plugins/admin"
import { IconShieldLock } from "@tabler/icons-react"

import { DropdownMenuItem } from "@/components/auth/ui/dropdown-menu"
import { adminPlugin } from "@/lib/auth-ui/admin-plugin"

/**
 * Link to the admin screen in the `UserButton` menu, shown only to users the
 * server grants `user:list` — the same check the users table makes.
 */
export function AdminMenuItem() {
  const { authClient, basePaths, viewPaths, navigate } = useAuth()
  const { localization } = useAuthPlugin(adminPlugin)
  const permission = useAdminPermission(authClient as AdminAuthClient, {
    user: ["list"]
  })

  if (!permission.data?.success) return null

  return (
    <DropdownMenuItem
      onClick={() =>
        navigate({ to: `${basePaths.admin}/${viewPaths.admin.users}` })
      }
    >
      <IconShieldLock />
      {localization.admin}
    </DropdownMenuItem>
  )
}
