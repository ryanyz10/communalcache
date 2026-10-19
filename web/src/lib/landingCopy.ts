export const SOURCE_CODE_URL = 'https://github.com/ryanyz10/communalcache'

export const landingCopy = {
  brand: 'Communal Cache',
  title: 'Communal Cache — Borrow from people you know',
  hero: 'Borrow from the people you already know.',
  description: 'List what you’re happy to lend or give away. Your neighbors ask. You hand it over in person.',
  signIn: 'Sign in',
  sourceCode: 'Source code on GitHub',
  opensNewTab: '(opens in a new tab)',
  getStarted: 'Get started, it’s free',
  invite: 'I have an invite link',
  inviteNote: 'Open the invite link someone sent you, or sign in and choose Join with an invite on Home to paste it.',
  howHeading: 'How it works',
  steps: [
    { title: 'Start or join a cache', body: 'A cache is a shared cupboard for your street, club or group of friends. Join one with an invite link.' },
    { title: 'Share what you have', body: 'Ladders, pasta makers, spare sourdough starter. Lend it, or give some away.' },
    { title: 'Ask, approve, meet up', body: 'Neighbors ask, you say yes, and you both see how to reach each other. The handoff happens in person.' },
  ],
  communityHeading: 'Made for close communities',
  communityDescription: 'Every cat in a cache is a person you invited. Nobody else can look inside the box.',
  packingSlip: 'PACKING SLIP',
  contents: "Contents: your neighbors' things",
  handleWithCare: 'Handle with care',
  sampleItem: 'ladder',
  faq: {
    heading: 'Questions, unpacked',
    intro: 'Tap a box to open it.',
    items: [
      {
        question: 'What’s a cache?',
        answer: 'A cache is a shared box for one group of people: your street, a club, a group of friends. Everyone in it can see what the others are happy to lend or give away.',
      },
      {
        question: 'Who can see my things?',
        answer: 'Items you share are visible to active members of those caches, not public listings. There’s no handoff-address field; please don’t put addresses in descriptions or photos.',
      },
      {
        question: 'How do I join one?',
        answer: 'Someone in the cache sends you an invite link. Some caches let you straight in. Others ask the owner to approve new members first.',
      },
      {
        question: 'What happens when someone asks for my thing?',
        answer: 'Review asks in Requests and choose to approve or decline, with notifications to help you keep up. If you approve, you can see each other’s chosen contact details if provided, while you’re both active in that cache. You arrange any handoff in person.',
      },
      {
        question: 'What if something breaks or doesn’t come back?',
        answer: 'Communal Cache doesn’t handle payments, deposits or insurance. Sharing works on trust between people who know each other, so only share what you’re comfortable lending.',
      },
      {
        question: 'Does it cost anything?',
        answer: 'No, it’s free. If it helps your neighborhood, you can chip in for hosting.',
      },
    ],
  },
  bottomHeading: "There's room in the box.",
  shelf: [
    { key: 'street', label: 'Street', cats: [{ id: 'street-ada', pose: 'sit', width: 30 }, { id: 'street-otto', pose: 'loaf', width: 58 }] },
    { key: 'friends', label: 'Friends', cats: [{ id: 'friends-mei', pose: 'sit', width: 28 }] },
    { key: 'club', label: 'Club', cats: [] },
    { key: 'neighbors', label: 'Neighbors', cats: [{ id: 'neighbors-kofi', pose: 'loaf', width: 62 }, { id: 'neighbors-lena', pose: 'sit', width: 31 }, { id: 'neighbors-ravi', pose: 'sit', width: 31 }] },
    { key: 'building', label: 'Building', cats: [{ id: 'building-noor', pose: 'sit', width: 30 }] },
    { key: 'garden', label: 'Garden', cats: [{ id: 'garden-felix', pose: 'loaf', width: 60 }] },
    { key: 'community', label: 'Community', cats: [{ id: 'community-iris', pose: 'sit', width: 30 }, { id: 'community-theo', pose: 'sit', width: 30 }] },
  ] as const,
  promises: [
    'Only members of a cache see what’s in it',
    'No addresses and no public listings',
    'Your contact shows only after you approve an ask',
    'Free for small groups',
  ],
  footer: 'Sign in with your email. No password.',
  support: {
    heading: 'Support Communal Cache',
    description: 'Communal Cache is free. If it helps your neighborhood, you can chip in for hosting.',
    button: 'Buy me a coffee ↗',
  },
}
