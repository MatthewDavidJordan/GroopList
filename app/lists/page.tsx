"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { db, auth, onAuthStateChanged } from "@/lib/firebase"
import { collection, doc, getDoc, onSnapshot, deleteDoc } from "firebase/firestore"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

interface UserHousehold {
  householdId: string
  name: string
  role: "owner" | "member"
  joinedAt?: any
  unreadCount?: number
}

export default function YourListsPage() {
  const router = useRouter()
  const [uid, setUid] = useState<string | null>(null)
  const [items, setItems] = useState<UserHousehold[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid || null)
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!uid) return
    setLoading(true)
    const ref = collection(db, "users", uid, "households")
    const unsub = onSnapshot(ref, (snap) => {
      const list: UserHousehold[] = snap.docs.map((d) => ({
        householdId: (d.data() as any).householdId,
        name: (d.data() as any).name,
        role: (d.data() as any).role,
        joinedAt: (d.data() as any).joinedAt,
        unreadCount: (d.data() as any).unreadCount || 0,
      }))
      setItems(list)
      setLoading(false)
    }, (e) => {
      setErr(e?.message || String(e))
      setLoading(false)
    })
    return () => unsub()
  }, [uid])

  const openHousehold = async (householdId: string) => {
    if (!uid) return
    try {
      // Read household info and member name
      const hhSnap = await getDoc(doc(db, "households", householdId))
      const memberSnap = await getDoc(doc(db, "households", householdId, "members", uid))
      const hhData = hhSnap.data() as any
      const memberData = memberSnap.data() as any

      // Persist to localStorage for the GroceryApp to pick up on next render
      const user = {
        id: uid,
        name: memberData?.name || "",
        householdId,
      }
      const household = {
        id: householdId,
        name: hhData?.name || "",
        members: [],
        createdAt: new Date().toISOString(),
      }
      localStorage.setItem("groceryApp_user", JSON.stringify(user))
      localStorage.setItem("groceryApp_household", JSON.stringify(household))

      router.push("/")
    } catch (e) {
      setErr((e as any)?.message || String(e))
    }
  }

  const leaveHousehold = async (householdId: string) => {
    if (!uid) return
    try {
      await deleteDoc(doc(db, "households", householdId, "members", uid))
      await deleteDoc(doc(db, "users", uid, "households", householdId))
      // No need to change route; onSnapshot will update the list
    } catch (e) {
      setErr((e as any)?.message || String(e))
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950 p-4">
      <div className="max-w-3xl mx-auto pt-10 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">Your Lists</h1>
          <Link href="/" className="text-emerald-700 hover:underline text-sm">Back</Link>
        </div>

        {err && (
          <div className="text-sm text-red-600">{err}</div>
        )}

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <Card className="border-emerald-200 dark:border-emerald-800">
            <CardHeader>
              <CardTitle>No households yet</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Create or join a household from the home page.</p>
              <div className="mt-3">
                <Link href="/" className="text-emerald-700 hover:underline text-sm">Go to Get Started</Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {items.map((h) => (
              <Card key={h.householdId} className="border-emerald-200 dark:border-emerald-800">
                <CardContent className="py-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-emerald-900 dark:text-emerald-100">{h.name || h.householdId}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <span>Code:</span>
                      <Badge variant="secondary">{h.householdId}</Badge>
                      <span>•</span>
                      <span className="capitalize">{h.role}</span>
                      {h.unreadCount && h.unreadCount > 0 && (
                        <>
                          <span>•</span>
                          <Badge className="bg-emerald-600">{h.unreadCount} unread</Badge>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => openHousehold(h.householdId)}>Open</Button>
                    <Button size="sm" variant="outline" onClick={() => leaveHousehold(h.householdId)}>Leave</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
