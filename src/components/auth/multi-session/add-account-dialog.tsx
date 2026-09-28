"use client"

import { useAuthPlugin } from "@better-auth-ui/react"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useSyncExternalStore } from "react"

import {
  Dialog,
  DialogContent,
  DialogTitle
} from "@/components/auth/ui/dialog"
import { SignIn } from "@/components/auth/sign-in"
import {
  clearAddAccountCookie,
  setAddAccountCookie
} from "@/lib/add-account-cookie"
import { multiSessionPlugin } from "@/lib/auth-ui/multi-session-plugin"
import { useReloadAfterSwitch } from "./use-reload-after-switch"

// The menu that opens the dialog unmounts its items as soon as one is picked,
// so the open state lives outside React and the dialog is mounted once at the root.
let isOpen = false
const listeners = new Set<() => void>()

function setOpen(open: boolean) {
  isOpen = open
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Open the "Add account" sign-in dialog. */
export function openAddAccountDialog() {
  setAddAccountCookie()
  setOpen(true)
}

/**
 * Sign-in dialog for adding another account to this device without leaving
 * the current page. Links that hand off to a full auth page (sign up, forgot
 * password, email code, second factor) close it but keep the add-account
 * cookie, so those pages render for the signed-in user.
 */
export function AddAccountDialog() {
  const open = useSyncExternalStore(subscribe, () => isOpen, () => false)
  const { localization } = useAuthPlugin(multiSessionPlugin)
  const reloadAfterSwitch = useReloadAfterSwitch()

  // Any navigation (a hand-off link, the second-factor challenge) closes the
  // dialog without clearing the cookie the next page needs.
  const pathname = usePathname()
  const lastPathname = useRef(pathname)
  useEffect(() => {
    if (lastPathname.current === pathname) return
    lastPathname.current = pathname
    setOpen(false)
  }, [pathname])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) clearAddAccountCookie()
        setOpen(next)
      }}
    >
      <DialogContent className="p-0">
        <DialogTitle className="sr-only">{localization.addAccount}</DialogTitle>

        <SignIn
          className="max-w-none shadow-none ring-0"
          onSignedIn={() => {
            clearAddAccountCookie()
            reloadAfterSwitch()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
