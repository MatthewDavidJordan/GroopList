"use client"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [canInstall, setCanInstall] = useState(false)

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setCanInstall(true)
    }
    window.addEventListener("beforeinstallprompt", handler)
    return () => window.removeEventListener("beforeinstallprompt", handler)
  }, [])

  const onInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
    setCanInstall(false)
  }

  if (!canInstall) return null
  return (
    <div className="fixed bottom-4 inset-x-0 mx-auto max-w-md bg-white dark:bg-gray-900 border rounded-lg p-3 shadow">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm">Install GroopList?</div>
        <Button size="sm" onClick={onInstall} className="bg-emerald-600 hover:bg-emerald-700">Install</Button>
      </div>
    </div>
  )
}
