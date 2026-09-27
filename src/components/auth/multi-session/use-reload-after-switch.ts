"use client"

import { useAuth } from "@better-auth-ui/react"
import { useCallback } from "react"

/**
 * Full reload into `redirectTo` once the active account changes.
 *
 * Switching only refreshes better-auth-ui's session query. Server-rendered
 * pages and the app's own query cache still hold the previous user's
 * workspaces, and the current URL may be a workspace the new user cannot
 * open, so start over from the landing route.
 */
export function useReloadAfterSwitch() {
  const { redirectTo } = useAuth()

  return useCallback(() => window.location.assign(redirectTo), [redirectTo])
}
