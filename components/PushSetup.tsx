"use client"
import { useEffect, useState } from "react"
import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging"
import { db, auth } from "@/lib/firebase"
import { doc, setDoc } from "firebase/firestore"
import { Button } from "@/components/ui/button"

interface Props {
  householdId?: string
  uid?: string | null
}

export default function PushSetup({ householdId, uid }: Props) {
  const [permission, setPermission] = useState<NotificationPermission>(typeof window !== "undefined" && "Notification" in window ? Notification.permission : "default")
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const supported = await isSupported()
        if (!supported) return
        if (!("serviceWorker" in navigator)) return
        await navigator.serviceWorker.register("/firebase-messaging-sw.js")
        setReady(true)
      } catch (e) {
        if (active) setError("Service worker registration failed")
      }
    })()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!ready || !householdId || !uid) return
    ;(async () => {
      try {
        const supported = await isSupported()
        if (!supported) return
        const registration = await navigator.serviceWorker.getRegistration()
        if (!registration) return

        const messaging = getMessaging()
        // VAPID public key from Firebase Console → Cloud Messaging → Web Push certificates
        const vapidKey = process.env.NEXT_PUBLIC_FCM_VAPID_KEY
        if (!vapidKey) {
          console.warn("NEXT_PUBLIC_FCM_VAPID_KEY is not set. Skipping FCM token fetch.")
          return
        }
        const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration })
        if (token) {
          await setDoc(doc(db, "households", householdId, "members", uid, "tokens", token), { token, updatedAt: new Date().toISOString() })
        }
        onMessage(messaging, (payload) => {
          // Optional foreground toast/notification behavior
          if (payload?.notification?.title) {
            // Rely on your in-app notification system or show a small toast
            console.log("Foreground notification:", payload.notification.title)
          }
        })
      } catch (e: any) {
        setError(e?.message || "Push setup failed")
      }
    })()
  }, [ready, householdId, uid])

  const requestPermission = async () => {
    if (!("Notification" in window)) return
    const res = await Notification.requestPermission()
    setPermission(res)
  }

  if (!ready) return null
  if (permission !== "granted") {
    return (
      <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 bg-white dark:bg-gray-900 border rounded-lg p-3 shadow">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">Enable push notifications?</div>
          <Button size="sm" onClick={requestPermission} className="bg-emerald-600 hover:bg-emerald-700">Enable</Button>
        </div>
        {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
      </div>
    )
  }

  return null
}
