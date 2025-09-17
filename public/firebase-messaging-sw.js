/* eslint-disable no-undef */
// Firebase Messaging service worker
// Uses compat to keep SW small/easy. Ensure versions match your installed firebase version.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js')

// Important: SW cannot access Next.js env vars. Only messagingSenderId is required here.
firebase.initializeApp({
  messagingSenderId: 'REPLACE_WITH_MESSAGING_SENDER_ID'
})

const messaging = firebase.messaging()

// Background notifications
messaging.onBackgroundMessage((payload) => {
  const { title, body, icon } = payload.notification || {}
  self.registration.showNotification(title || 'GroopList', {
    body: body || '',
    icon: icon || '/icon-192.png',
  })
})
