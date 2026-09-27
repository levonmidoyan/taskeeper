"use client"

import type {
  ListDeviceSession,
  MultiSessionAuthClient
} from "@better-auth-ui/core/plugins/multi-session"
import { useAuth } from "@better-auth-ui/react"
import { useSetActiveSession } from "@better-auth-ui/react/plugins/multi-session"

import { DropdownMenuItem } from "@/components/auth/ui/dropdown-menu"
import { Spinner } from "@/components/auth/ui/spinner"
import { UserView } from "@/components/auth/user/user-view"
import { useReloadAfterSwitch } from "./use-reload-after-switch"

export type SwitchAccountSubmenuItemProps = {
  deviceSession: ListDeviceSession
}

/**
 * Render a dropdown menu item for switching to a different authenticated session.
 *
 * @param deviceSession - The device session to display and switch to when selected
 * @returns The switch account dropdown menu item as a JSX element
 */
export function SwitchAccountSubmenuItem({
  deviceSession
}: SwitchAccountSubmenuItemProps) {
  const { authClient } = useAuth<MultiSessionAuthClient>()
  const reloadAfterSwitch = useReloadAfterSwitch()
  const { mutate: setActiveSession, isPending } = useSetActiveSession(
    authClient,
    { onSuccess: reloadAfterSwitch }
  )

  return (
    <DropdownMenuItem
      disabled={isPending}
      onClick={() =>
        setActiveSession({ sessionToken: deviceSession.session.token })
      }
    >
      <UserView user={deviceSession.user} />

      {isPending && <Spinner className="ml-auto size-4" />}
    </DropdownMenuItem>
  )
}
