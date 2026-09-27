"use client"

import type {
  ListDeviceSession,
  MultiSessionAuthClient
} from "@better-auth-ui/core/plugins/multi-session"
import { useAuth, useAuthPlugin, useSession } from "@better-auth-ui/react"
import {
  useRevokeMultiSession,
  useSetActiveSession
} from "@better-auth-ui/react/plugins/multi-session"
import {
  IconArrowsLeftRight as ArrowLeftRight,
  IconLogout as LogOut,
  IconDots as MoreHorizontal
} from "@tabler/icons-react"
import { toast } from "sonner"

import { Button, buttonVariants } from "@/components/auth/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/auth/ui/dropdown-menu"
import { Item, ItemActions } from "@/components/auth/ui/item"
import { Spinner } from "@/components/auth/ui/spinner"
import { UserView } from "@/components/auth/user/user-view"
import { multiSessionPlugin } from "@/lib/auth-ui/multi-session-plugin"
import { cn } from "@/utils/cn"
import { useReloadAfterSwitch } from "./use-reload-after-switch"

export type ManageAccountProps = {
  deviceSession?: ListDeviceSession | null
  isPending?: boolean
}

/**
 * Render a single account row with user info and switch/revoke controls.
 *
 * Shows the user's avatar and info. For the active session, shows a sign-out button.
 * For non-active sessions, shows a dropdown menu with switch and sign-out options.
 *
 * @param deviceSession - The device session object containing session and user data
 * @param isPending - Whether the device session is pending
 * @returns A JSX element containing the account row
 */
export function ManageAccount({
  deviceSession,
  isPending
}: ManageAccountProps) {
  const { authClient, localization } = useAuth<MultiSessionAuthClient>()
  const { localization: multiSessionLocalization } =
    useAuthPlugin(multiSessionPlugin)
  const { data: session } = useSession(authClient)
  const reloadAfterSwitch = useReloadAfterSwitch()

  const isActive = deviceSession?.session.userId === session?.session.userId

  const { mutate: setActiveSession, isPending: isSwitching } =
    useSetActiveSession(authClient, { onSuccess: reloadAfterSwitch })

  const { mutate: revokeSession, isPending: isRevoking } =
    useRevokeMultiSession(authClient, {
      onSuccess: () => {
        // Revoking the active account makes the server switch to another one
        // on this device (or sign out), so the page must start over.
        if (isActive) reloadAfterSwitch()
        else toast.success(localization.settings.revokeSessionSuccess)
      }
    })

  const isBusy = isSwitching || isRevoking

  return (
    <Item>
      <UserView
        className="flex-1"
        user={deviceSession?.user}
        isPending={isPending}
      />
      <ItemActions>
        {deviceSession && isActive && (
          <Button
            className="shrink-0"
            variant="outline"
            size="sm"
            onClick={() =>
              revokeSession({ sessionToken: deviceSession.session.token })
            }
            disabled={isBusy}
          >
            {isRevoking ? <Spinner /> : <LogOut />}
            {localization.auth.signOut}
          </Button>
        )}

        {deviceSession && !isActive && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon-sm" }),
                "shrink-0"
              )}
              disabled={isBusy}
            >
              {isBusy ? <Spinner /> : <MoreHorizontal />}
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="min-w-fit">
              <DropdownMenuItem
                onClick={() =>
                  setActiveSession({
                    sessionToken: deviceSession.session.token
                  })
                }
              >
                <ArrowLeftRight />
                {multiSessionLocalization.switchAccount}
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() =>
                  revokeSession({
                    sessionToken: deviceSession.session.token
                  })
                }
              >
                <LogOut />
                {localization.auth.signOut}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </ItemActions>
    </Item>
  )
}
