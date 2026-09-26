import { createAuthPlugin } from "@better-auth-ui/core"
import {
  type AdminPluginOptions,
  adminPlugin as coreAdminPlugin
} from "@better-auth-ui/core/plugins/admin"

import { AdminMenuItem } from "@/components/auth/admin/admin-menu-item"
import { StopImpersonating } from "@/components/auth/admin/stop-impersonating"

export const adminPlugin = createAuthPlugin(
  coreAdminPlugin.id,
  (options: AdminPluginOptions = {}) => ({
    ...coreAdminPlugin(options),
    userMenuItems: [AdminMenuItem, StopImpersonating]
  })
)
