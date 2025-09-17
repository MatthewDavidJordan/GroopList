"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Users, ShoppingCart, MapPin, Plus, Trash2, Navigation, Bell, X, ChevronDown, ChevronRight, RefreshCcw } from "lucide-react"
import { db, auth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "@/lib/firebase"
import Link from "next/link"
import { signOut } from "firebase/auth"
import InstallPrompt from "@/components/InstallPrompt"
import PushSetup from "@/components/PushSetup"
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore"

interface User {
  id: string
  name: string
  householdId: string
}

interface Household {
  id: string
  name: string
  members: User[]
  createdAt: string
}

interface GroceryItem {
  id: string
  name: string
  addedBy: string
  addedAt: string
  completed: boolean
  completedBy?: string
  completedAt?: string
}

interface GroceryStore {
  id: string
  name: string
  lat: number
  lng: number
  address: string
}

interface LocationData {
  lat: number
  lng: number
  timestamp: number
}

interface Notification {
  id: string
  type: "store_proximity" | "member_shopping"
  title: string
  message: string
  timestamp: number
  read: boolean
  userId?: string
  storeName?: string
}

const GROCERY_STORES: GroceryStore[] = [
  { id: "1", name: "Whole Foods Market", lat: 37.7749, lng: -122.4194, address: "123 Market St, San Francisco, CA" },
  { id: "2", name: "Safeway", lat: 37.7849, lng: -122.4094, address: "456 Mission St, San Francisco, CA" },
  { id: "3", name: "Trader Joe's", lat: 37.7649, lng: -122.4294, address: "789 Castro St, San Francisco, CA" },
  { id: "4", name: "Target", lat: 37.7549, lng: -122.4394, address: "321 Valencia St, San Francisco, CA" },
]

const PROXIMITY_THRESHOLD = 0.5 // 0.5 miles

export default function GroceryApp() {
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [household, setHousehold] = useState<Household | null>(null)
  const [uid, setUid] = useState<string | null>(null)
  const [userName, setUserName] = useState("")
  const [householdName, setHouseholdName] = useState("")
  const [householdCode, setHouseholdCode] = useState("")
  const [groceryList, setGroceryList] = useState<GroceryItem[]>([])
  const [newItemName, setNewItemName] = useState("")
  const [locationEnabled, setLocationEnabled] = useState(false)
  const [currentLocation, setCurrentLocation] = useState<LocationData | null>(null)
  const [nearbyStores, setNearbyStores] = useState<GroceryStore[]>([])
  const [locationError, setLocationError] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [lastNotifiedStores, setLastNotifiedStores] = useState<Set<string>>(new Set())
  const [completedListExpanded, setCompletedListExpanded] = useState(false)
  const [members, setMembers] = useState<User[]>([])
  const [memberLocations, setMemberLocations] = useState<Record<string, LocationData>>({})
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [pullStartY, setPullStartY] = useState<number | null>(null)
  const [pullDistance, setPullDistance] = useState(0)

  // Utility: convert timestamps to a friendly "last seen" label
  const formatLastSeen = (ts?: number) => {
    if (!ts) return "unknown"
    const delta = Date.now() - ts
    const mins = Math.floor(delta / 60000)
    if (mins < 1) return "just now"
    if (mins === 1) return "1 min ago"
    if (mins < 60) return `${mins} mins ago`
    const hrs = Math.floor(mins / 60)
    if (hrs === 1) return "1 hr ago"
    if (hrs < 24) return `${hrs} hrs ago`
    const days = Math.floor(hrs / 24)
    return days === 1 ? "1 day ago" : `${days} days ago`
  }

  // Ensure a Firebase auth session exists
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUid(user.uid)
        // Prefill userName from Google profile if not set yet
        if (!userName && user.displayName) setUserName(user.displayName)
      } else {
        setUid(null)
      }
    })
    return () => unsub()
  }, [])

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider()
    await signInWithPopup(auth, provider)
  }

  // Manual refetch of items (useful if user wants to force sync)
  const refetchGroceryList = async () => {
    if (!household?.id) return
    try {
      setRefreshing(true)
      const itemsRef = collection(db, "households", household.id, "items")
      const q = query(itemsRef, orderBy("addedAt", "asc"))
      const snap = await getDocs(q)
      const items: GroceryItem[] = snap.docs.map((d) => {
        const data = d.data() as any
        return {
          id: d.id,
          name: data.name || "",
          addedBy: data.addedByName || data.addedBy || "",
          addedAt: (data.addedAt?.toDate?.() || new Date()).toISOString(),
          completed: !!data.completed,
          completedBy: data.completedByName,
          completedAt: data.completedAt ? (data.completedAt.toDate?.() || new Date()).toISOString() : undefined,
        }
      })
      setGroceryList(items)
    } catch (e) {
      console.warn("Manual refresh failed", e)
    } finally {
      setRefreshing(false)
    }
  }

  // Ensure the current signed-in user is enrolled as a household member (for security rules)
  useEffect(() => {
    const enroll = async () => {
      try {
        if (!uid || !household?.id || !userName.trim()) return
        await setDoc(doc(db, "households", household.id, "members", uid), {
          uid,
          name: userName,
          role: "member",
          joinedAt: serverTimestamp(),
        }, { merge: true })
      } catch (e) {
        // ignore; will surface on actual write attempts
      }
    }
    enroll()
  }, [db, uid, household?.id, userName])

  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) {
      alert("This browser does not support notifications")
      return false
    }

    if (Notification.permission === "granted") {
      return true
    }

    if (Notification.permission !== "denied") {
      const permission = await Notification.requestPermission()
      return permission === "granted"
    }

    return false
  }

  const createNotification = async (notification: Omit<Notification, "id" | "timestamp" | "read">) => {
    if (!household?.id) return
    // Persist to Firestore
    await addDoc(collection(db, "households", household.id, "notifications"), {
      type: notification.type,
      title: notification.title,
      message: notification.message,
      userId: notification.userId || null,
      storeName: notification.storeName || null,
      timestamp: serverTimestamp(),
      readBy: [],
    })

    // Optionally mirror to UI immediately (onSnapshot will also update)
    if (notificationsEnabled && typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      new Notification(notification.title, {
        body: notification.message,
        icon: "/favicon.ico",
        tag: notification.type,
      })
    }
  }

  const markNotificationAsRead = async (notificationId: string) => {
    if (!household?.id || !uid) return
    const nref = doc(db, "households", household.id, "notifications", notificationId)
    await updateDoc(nref, { readBy: arrayUnion(uid) })
  }

  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 3959 // Earth's radius in miles
    const dLat = (lat2 - lat1) * (Math.PI / 180)
    const dLng = (lng2 - lng1) * (Math.PI / 180)
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  const updateLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported by this browser")
      return
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const newLocation: LocationData = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          timestamp: Date.now(),
        }
        setCurrentLocation(newLocation)
        setLocationError(null)

        // Find nearby stores
        const nearby = GROCERY_STORES.filter((store) => {
          const distance = calculateDistance(newLocation.lat, newLocation.lng, store.lat, store.lng)
          return distance <= PROXIMITY_THRESHOLD
        })
        setNearbyStores(nearby)

        if (currentUser && household && groceryList.some((item) => !item.completed)) {
          nearby.forEach((store) => {
            if (!lastNotifiedStores.has(store.id)) {
              // Create a single household notification; clients filter by read state
              createNotification({
                type: "member_shopping",
                title: `${currentUser.name} is near ${store.name}!`,
                message: `${currentUser.name} is close to ${store.name}. Perfect time to coordinate shopping!`,
                userId: currentUser.id,
                storeName: store.name,
              })

              setLastNotifiedStores((prev) => new Set([...prev, store.id]))
            }
          })

          // Remove stores that are no longer nearby from the notification set
          const nearbyStoreIds = new Set(nearby.map((store) => store.id))
          setLastNotifiedStores((prev) => new Set([...prev].filter((id) => nearbyStoreIds.has(id))))
        }

        // Store location for household members to see (Firestore)
        if (household?.id && uid) {
          await setDoc(doc(db, "households", household.id, "locations", uid), {
            uid,
            lat: newLocation.lat,
            lng: newLocation.lng,
            timestamp: serverTimestamp(),
          }, { merge: true })
        }
      },
      (error) => {
        setLocationError(`Location error: ${error.message}`)
        console.error("Location error:", error)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000, // 5 minutes
      },
    )
  }

  const toggleLocationTracking = () => {
    if (!locationEnabled) {
      setLocationEnabled(true)
      updateLocation()
      // Update location every 2 minutes when enabled
      const interval = setInterval(updateLocation, 120000)
      localStorage.setItem("groceryApp_locationInterval", interval.toString())
    } else {
      setLocationEnabled(false)
      setCurrentLocation(null)
      setNearbyStores([])
      setLocationError(null)
      setLastNotifiedStores(new Set())
      const interval = localStorage.getItem("groceryApp_locationInterval")
      if (interval) {
        clearInterval(Number.parseInt(interval))
        localStorage.removeItem("groceryApp_locationInterval")
      }
    }
  }

  const toggleNotifications = async () => {
    if (!notificationsEnabled) {
      const granted = await requestNotificationPermission()
      if (granted) {
        setNotificationsEnabled(true)
        createNotification({
          type: "member_shopping",
          title: "Notifications enabled!",
          message: "You'll now receive alerts when group members are near grocery stores.",
        })
      }
    } else {
      setNotificationsEnabled(false)
    }
  }

  useEffect(() => {
    // Load user and household from localStorage for compatibility
    const savedUser = localStorage.getItem("groceryApp_user")
    const savedHousehold = localStorage.getItem("groceryApp_household")
    if (savedUser) setCurrentUser(JSON.parse(savedUser))
    if (savedHousehold) setHousehold(JSON.parse(savedHousehold))
  }, [])

  // Firestore realtime sync for grocery items when a household is active
  useEffect(() => {
    if (!household?.id) return
    const itemsRef = collection(db, "households", household.id, "items")
    const q = query(itemsRef, orderBy("addedAt", "asc"))
    const unsub = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
      const items: GroceryItem[] = snap.docs.map((d) => {
        const data = d.data() as any
        return {
          id: d.id,
          name: data.name || "",
          addedBy: data.addedByName || data.addedBy || "",
          addedAt: (data.addedAt?.toDate?.() || new Date()).toISOString(),
          completed: !!data.completed,
          completedBy: data.completedByName,
          completedAt: data.completedAt ? (data.completedAt.toDate?.() || new Date()).toISOString() : undefined,
        }
      })
      setGroceryList(items)
    })
    return () => unsub()
  }, [db, household?.id])

  // Firestore realtime members list for the active household
  useEffect(() => {
    if (!household?.id) return
    const mref = collection(db, "households", household.id, "members")
    const unsub = onSnapshot(mref, (snap) => {
      const list: User[] = snap.docs.map((d) => {
        const data = d.data() as any
        return { id: d.id, name: data.name || "", householdId: household.id }
      })
      setMembers(list)
    })
    return () => unsub()
  }, [db, household?.id])

  // Firestore realtime member locations for the active household
  useEffect(() => {
    if (!household?.id) return
    const lref = collection(db, "households", household.id, "locations")
    const unsub = onSnapshot(lref, (snap) => {
      const locs: Record<string, LocationData> = {}
      snap.forEach((d) => {
        const data = d.data() as any
        locs[d.id] = {
          lat: data.lat,
          lng: data.lng,
          timestamp: data.timestamp?.toDate?.()?.getTime?.() ?? Date.now(),
        }
      })
      setMemberLocations(locs)
    })
    return () => unsub()
  }, [db, household?.id])

  useEffect(() => {
    return () => {
      const interval = localStorage.getItem("groceryApp_locationInterval")
      if (interval) {
        clearInterval(Number.parseInt(interval))
      }
    }
  }, [])

  const saveGroceryList = (list: GroceryItem[]) => {
    // Kept for compatibility; state is now driven by Firestore onSnapshot
    if (household) setGroceryList(list)
  }

  const addGroceryItem = async () => {
    setErrorBanner(null)
    if (!newItemName.trim() || !currentUser || !household?.id) return
    try {
      // Ensure membership (in case of race conditions)
      if (uid) {
        await setDoc(doc(db, "households", household.id, "members", uid), {
          uid,
          name: currentUser.name || userName,
          role: "member",
          joinedAt: serverTimestamp(),
        }, { merge: true })
      }
      // Optimistic insert for instant UI feedback
      const optimisticItem: GroceryItem = {
        id: `temp-${Math.random().toString(36).slice(2)}`,
        name: newItemName.trim(),
        addedBy: currentUser.name,
        addedAt: new Date().toISOString(),
        completed: false,
      }
      setGroceryList((prev) => [...prev, optimisticItem])

      const itemsRef = collection(db, "households", household.id, "items")
      await addDoc(itemsRef, {
        name: newItemName.trim(),
        addedById: uid || null,
        addedByName: currentUser.name,
        addedAt: serverTimestamp(),
        addedAtClient: Date.now(),
        completed: false,
      })
      setNewItemName("")
      // Snapshot will replace the optimistic state when the server confirms
    } catch (e: any) {
      const msg = e?.message || String(e)
      setErrorBanner(`Failed to add item: ${msg}`)
    }
  }

  const toggleItemCompletion = async (itemId: string) => {
    setErrorBanner(null)
    if (!currentUser || !household?.id) return
    try {
      const itemRef = doc(db, "households", household.id, "items", itemId)
      const existing = groceryList.find((i) => i.id === itemId)
      if (!existing) return
      const willComplete = !existing.completed
      await updateDoc(itemRef, {
        completed: willComplete,
        completedById: willComplete ? uid || null : null,
        completedByName: willComplete ? currentUser.name : null,
        completedAt: willComplete ? serverTimestamp() : null,
      })
    } catch (e: any) {
      setErrorBanner(`Failed to update item: ${e?.message || String(e)}`)
    }
  }

  const deleteGroceryItem = async (itemId: string) => {
    setErrorBanner(null)
    if (!household?.id) return
    try {
      const itemRef = doc(db, "households", household.id, "items", itemId)
      await deleteDoc(itemRef)
    } catch (e: any) {
      setErrorBanner(`Failed to delete item: ${e?.message || String(e)}`)
    }
  }

  const createUser = (name: string, householdId: string) => {
    const user: User = {
      id: uid || Math.random().toString(36).substr(2, 9),
      name,
      householdId,
    }
    setCurrentUser(user)
    localStorage.setItem("groceryApp_user", JSON.stringify(user))
    return user
  }

  const createHousehold = async () => {
    if (!userName.trim() || !householdName.trim()) return

    const newHousehold: Household = {
      id: Math.random().toString(36).substr(2, 6).toUpperCase(),
      name: householdName,
      members: [],
      createdAt: new Date().toISOString(),
    }

    const user = createUser(userName, newHousehold.id)
    newHousehold.members.push(user)

    setHousehold(newHousehold)
    localStorage.setItem("groceryApp_household", JSON.stringify(newHousehold))

    // Persist to Firestore: household doc and member doc
    await setDoc(doc(db, "households", newHousehold.id), {
      id: newHousehold.id,
      name: newHousehold.name,
      createdAt: serverTimestamp(),
      createdBy: uid || null,
    })
    if (uid) {
      await setDoc(doc(db, "households", newHousehold.id, "members", uid), {
        uid,
        name: userName,
        role: "owner",
        joinedAt: serverTimestamp(),
      })
      // Mirror under user for listing
      await setDoc(doc(db, "users", uid, "households", newHousehold.id), {
        householdId: newHousehold.id,
        name: newHousehold.name,
        role: "owner",
        joinedAt: serverTimestamp(),
      })
    }
  }

  const joinHousehold = async () => {
    if (!userName.trim() || !householdCode.trim()) return
    const code = householdCode.trim().toUpperCase()
    const hhRef = doc(db, "households", code)
    const hhSnap = await getDoc(hhRef)
    if (!hhSnap.exists()) {
      alert("Household not found. Please check the code.")
      return
    }
    const hhData = hhSnap.data() as any
    const targetHousehold: Household = {
      id: code,
      name: hhData.name || "",
      members: [],
      createdAt: new Date().toISOString(),
    }
    const user = createUser(userName, householdCode)
    targetHousehold.members.push(user)
    setHousehold(targetHousehold)
    localStorage.setItem("groceryApp_household", JSON.stringify(targetHousehold))

    if (uid) {
      await setDoc(doc(db, "households", code, "members", uid), {
        uid,
        name: userName,
        role: "member",
        joinedAt: serverTimestamp(),
      }, { merge: true })
      await setDoc(doc(db, "users", uid, "households", code), {
        householdId: code,
        name: hhData.name || "",
        role: "member",
        joinedAt: serverTimestamp(),
      }, { merge: true })
    }
  }

  const leaveHousehold = async () => {
    if (household?.id && uid) {
      try { await deleteDoc(doc(db, "households", household.id, "members", uid)) } catch {}
      try { await deleteDoc(doc(db, "users", uid, "households", household.id)) } catch {}
    }
    localStorage.removeItem("groceryApp_user")
    localStorage.removeItem("groceryApp_household")
    setCurrentUser(null)
    setHousehold(null)
    setUserName("")
    setHouseholdName("")
    setHouseholdCode("")
    setGroceryList([])
    setLocationEnabled(false)
    setCurrentLocation(null)
    setNearbyStores([])
    setLocationError(null)
    setNotifications([])
    setNotificationsEnabled(false)
    setLastNotifiedStores(new Set())
  }

  // If not authenticated yet, show Google sign-in gate
  if (!uid) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950 p-4">
        <div className="max-w-md mx-auto pt-20">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-4">
              <ShoppingCart className="h-8 w-8 text-emerald-600" />
              <h1 className="text-3xl font-bold text-emerald-900 dark:text-emerald-100">GroopList</h1>
            </div>
            <p className="text-emerald-700 dark:text-emerald-300 text-balance">Sign in to continue</p>
          </div>

          <Card className="border-emerald-200 dark:border-emerald-800">
            <CardHeader>
              <CardTitle className="text-emerald-900 dark:text-emerald-100">Welcome</CardTitle>
              <CardDescription>Use your Google account to get started</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={signInWithGoogle} className="w-full bg-emerald-600 hover:bg-emerald-700">
                Continue with Google
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  if (!currentUser || !household) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950 p-4">
        <div className="max-w-md mx-auto pt-20">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-4">
              <ShoppingCart className="h-8 w-8 text-emerald-600" />
              <h1 className="text-3xl font-bold text-emerald-900 dark:text-emerald-100">GroopList</h1>
            </div>
            <p className="text-emerald-700 dark:text-emerald-300 text-balance">
              Smart grocery coordination for groups
            </p>
            <div className="mt-2">
              <Link href="/lists" className="text-sm text-emerald-700 hover:underline">Your Lists</Link>
            </div>
          </div>

          <Card className="border-emerald-200 dark:border-emerald-800">
            <CardHeader>
              <CardTitle className="text-emerald-900 dark:text-emerald-100">Get Started</CardTitle>
              <CardDescription>Create a new household or join an existing one</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="create" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="create">Create</TabsTrigger>
                  <TabsTrigger value="join">Join</TabsTrigger>
                </TabsList>

                <TabsContent value="create" className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="userName">Your Name</Label>
                    <Input
                      id="userName"
                      placeholder="Enter your name"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="householdName">Household Name</Label>
                    <Input
                      id="householdName"
                      placeholder="e.g., Apartment 4B"
                      value={householdName}
                      onChange={(e) => setHouseholdName(e.target.value)}
                    />
                  </div>
                  <Button
                    onClick={createHousehold}
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                    disabled={!userName.trim() || !householdName.trim()}
                  >
                    Create Household
                  </Button>
                </TabsContent>

                <TabsContent value="join" className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="userNameJoin">Your Name</Label>
                    <Input
                      id="userNameJoin"
                      placeholder="Enter your name"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="householdCode">Household Code</Label>
                    <Input
                      id="householdCode"
                      placeholder="Enter household code"
                      value={householdCode}
                      onChange={(e) => setHouseholdCode(e.target.value)}
                    />
                  </div>
                  <Button
                    onClick={joinHousehold}
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                    disabled={!userName.trim() || !householdCode.trim()}
                  >
                    Join Household
                  </Button>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const completedItems = groceryList.filter((item) => item.completed).length
  const totalItems = groceryList.length
  const unreadNotifications = notifications.filter((n) => !n.read).length

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950">
      <header className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-emerald-200 dark:border-emerald-800 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-6 w-6 text-emerald-600" />
              <h1 className="text-xl font-bold text-emerald-900 dark:text-emerald-100">GroopList</h1>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">{currentUser.name}</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400">{household.name}</p>
              </div>
              <Link href="/lists" className="text-sm text-emerald-700 hover:underline">Your Lists</Link>
              <Button
                variant="outline"
                size="sm"
                onClick={refetchGroceryList}
                className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 bg-transparent flex items-center gap-2"
                title="Refresh list"
              >
                <RefreshCcw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                <span className="hidden md:inline">Refresh</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await signOut(auth)
                  localStorage.removeItem("groceryApp_user")
                  localStorage.removeItem("groceryApp_household")
                  setCurrentUser(null)
                  setHousehold(null)
                }}
                className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 bg-transparent"
              >
                Sign out
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={leaveHousehold}
                className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 bg-transparent"
              >
                Leave
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main
        className="max-w-4xl mx-auto p-4 space-y-6"
        onTouchStart={(e) => {
          if (typeof window !== 'undefined' && window.scrollY === 0) {
            setPullStartY(e.touches[0].clientY)
            setPullDistance(0)
          } else {
            setPullStartY(null)
          }
        }}
        onTouchMove={(e) => {
          if (pullStartY !== null) {
            const dist = Math.max(0, e.touches[0].clientY - pullStartY)
            setPullDistance(dist)
          }
        }}
        onTouchEnd={async () => {
          if (pullStartY !== null && pullDistance > 60) {
            await refetchGroceryList()
          }
          setPullStartY(null)
          setPullDistance(0)
        }}
        style={{
          // Visual feedback for pull distance (subtle translate)
          transform: pullDistance > 0 ? `translateY(${Math.min(pullDistance, 60)}px)` : undefined,
          transition: pullStartY === null ? 'transform 150ms ease-out' : undefined,
        }}
      >
        <InstallPrompt />
        {uid && household?.id && (
          <PushSetup householdId={household.id} uid={uid} />
        )}
        {(refreshing || pullDistance > 0) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground justify-center">
            <RefreshCcw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Refreshing…' : 'Pull to refresh'}</span>
          </div>
        )}
        {errorBanner && (
          <Alert className="border-red-300 bg-red-50 dark:bg-red-950">
            <AlertDescription className="text-red-700 dark:text-red-300">{errorBanner}</AlertDescription>
          </Alert>
        )}
        {unreadNotifications > 0 && (
          <div className="space-y-2">
            {notifications
              .filter((n) => !n.read)
              .slice(0, 3)
              .map((notification) => (
                <Alert
                  key={notification.id}
                  className="border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950"
                >
                  <Bell className="h-4 w-4 text-emerald-600" />
                  <AlertDescription className="flex items-center justify-between">
                    <div>
                      <strong className="text-emerald-900 dark:text-emerald-100">{notification.title}</strong>
                      <p className="text-emerald-700 dark:text-emerald-300 text-sm">{notification.message}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markNotificationAsRead(notification.id)}
                      className="text-emerald-600 hover:text-emerald-800"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </AlertDescription>
                </Alert>
              ))}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-emerald-200 dark:border-emerald-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-emerald-600" />
                Household
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Code: <Badge variant="secondary">{household.id}</Badge>
                </p>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Members:</p>
                  {members.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No members yet</p>
                  ) : (
                    members.map((member) => (
                      <div key={member.id} className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                        <span className="text-sm">{member.name}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-emerald-200 dark:border-emerald-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="h-5 w-5 text-emerald-600" />
                Location & Alerts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="location-toggle" className="text-sm font-medium">
                    Track Location
                  </Label>
                  <Switch id="location-toggle" checked={locationEnabled} onCheckedChange={toggleLocationTracking} />
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="notifications-toggle" className="text-sm font-medium">
                    Notifications
                  </Label>
                  <Switch
                    id="notifications-toggle"
                    checked={notificationsEnabled}
                    onCheckedChange={toggleNotifications}
                  />
                </div>

                {locationError && <p className="text-xs text-red-500">{locationError}</p>}

                {locationEnabled && currentLocation && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      <Navigation className="h-3 w-3 text-emerald-600" />
                      <span className="text-xs text-muted-foreground">Location active</span>
                    </div>

                    {nearbyStores.length > 0 ? (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Nearby stores:</p>
                        {nearbyStores.map((store) => (
                          <div key={store.id} className="text-xs text-muted-foreground">
                            {store.name}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No nearby stores</p>
                    )}

                    {/* Member locations */}
                    <div className="space-y-1 pt-2">
                      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Member locations:</p>
                      {members.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No members</p>
                      ) : (
                        members.map((m) => {
                          const loc = memberLocations[m.id]
                          return (
                            <div key={m.id} className="text-xs text-muted-foreground flex items-center justify-between">
                              <span>{m.name}</span>
                              <span className="italic">{loc ? `Last seen ${formatLastSeen(loc.timestamp)}` : "No location"}</span>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                )}

                {!locationEnabled && (
                  <p className="text-xs text-muted-foreground">Enable to get notified when near grocery stores</p>
                )}

                {unreadNotifications > 0 && (
                  <div className="flex items-center gap-1">
                    <Bell className="h-3 w-3 text-emerald-600" />
                    <span className="text-xs text-emerald-600 font-medium">
                      {unreadNotifications} unread alert{unreadNotifications !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-emerald-200 dark:border-emerald-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-emerald-600" />
              Shared Grocery List
            </CardTitle>
            <CardDescription>Add items that anyone in your household can check off when shopping</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Add grocery item..."
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && addGroceryItem()}
                className="flex-1"
              />
              <Button
                onClick={addGroceryItem}
                disabled={!newItemName.trim()}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {groceryList.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No items in your grocery list yet. Add some above!
                </p>
              ) : (
                <div className="space-y-4">
                  {groceryList.filter((item) => !item.completed).length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-emerald-900 dark:text-emerald-100 flex items-center gap-2">
                        <ShoppingCart className="h-4 w-4" />
                        Shopping List ({groceryList.filter((item) => !item.completed).length} items)
                      </h4>
                      {groceryList
                        .filter((item) => !item.completed)
                        .map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-3 p-3 rounded-lg border bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 transition-all"
                          >
                            <Checkbox
                              checked={item.completed}
                              onCheckedChange={() => toggleItemCompletion(item.id)}
                              className="data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                            />
                            <div className="flex-1">
                              <p className="font-medium">{item.name}</p>
                              <p className="text-xs text-muted-foreground">Added by {item.addedBy}</p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteGroceryItem(item.id)}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                    </div>
                  )}

                  {groceryList.filter((item) => item.completed).length > 0 && (
                    <div className="space-y-2">
                      <button
                        onClick={() => setCompletedListExpanded(!completedListExpanded)}
                        aria-expanded={completedListExpanded}
                        type="button"
                        className="w-full flex items-center justify-start gap-2 text-left text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {completedListExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        Completed ({groceryList.filter((item) => item.completed).length} items)
                      </button>

                      {completedListExpanded && (
                        <div className="space-y-2">
                          {groceryList
                            .filter((item) => item.completed)
                            .map((item) => (
                              <div
                                key={item.id}
                                className="flex items-center gap-3 p-3 rounded-lg border bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800 transition-all"
                              >
                                <Checkbox
                                  checked={item.completed}
                                  onCheckedChange={() => toggleItemCompletion(item.id)}
                                  className="data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                                />
                                <div className="flex-1">
                                  <p className="font-medium line-through text-muted-foreground">{item.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    Added by {item.addedBy}
                                    {item.completedBy && <span> • Completed by {item.completedBy}</span>}
                                  </p>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => deleteGroceryItem(item.id)}
                                  className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}

                  {groceryList.length > 0 && groceryList.filter((item) => !item.completed).length === 0 && (
                    <div className="text-center py-4">
                      <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900 rounded-full flex items-center justify-center mx-auto mb-2">
                        <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center">
                          <div className="w-3 h-3 bg-white rounded-full"></div>
                        </div>
                      </div>
                      <p className="text-emerald-700 dark:text-emerald-300 font-medium">All done!</p>
                      <p className="text-sm text-muted-foreground">Great job completing your grocery list</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
