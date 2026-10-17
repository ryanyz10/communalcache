const operator = 'Ryan Zhou (an individual)'
const contact = 'ryanyz10+communalcache@gmail.com'

export const legalCopy = {
  brand: 'Communal Cache',
  operator,
  contact,
  effectiveDate: '2026-10-17',
  effectiveLabel: 'Effective date',
  back: 'Back to Communal Cache',
  navigation: 'Privacy and terms',
  contactHeading: 'Questions? Get in touch',
  contactIntro: 'For privacy requests, account deletion or questions about these terms, email',
  operatedBy: `Communal Cache at https://communalcache.com is operated by ${operator}.`,
  privacy: {
    title: 'Privacy policy',
    introduction: 'Sharing a ladder shouldn’t mean sharing your whole life. Here’s what we keep, why we need it and who can see it.',
    sections: [
      {
        heading: 'What we collect and why',
        paragraphs: ['We use your information to sign you in, run your caches, handle requests, send service notifications and protect the app from abuse. We collect:'],
        list: [
          'Your sign-in email, chosen display name and optional profile photo and cat appearance.',
          'Items you add, including descriptions, quantities, availability notes and optional item photos; caches you create or join; memberships; and requests, decisions and optional approval messages.',
          'An optional contact method you choose: SMS, WhatsApp, Signal, Messenger, Instagram or a separately entered contact email.',
          'A browser push subscription and its delivery keys if you enable push notifications.',
          'Session and security information, such as sign-in times, IP address, browser details and rate-limit records.',
        ],
      },
      {
        heading: 'Who can see what',
        paragraphs: [
          'Your sign-in email is never shown to other users. Your chosen display name appears to people you share with, including in request history. Your optional profile photo is visible to you and people who currently share a cache with you. A cache’s invite preview can show its name, member count and cats, but not member names or photos.',
          'Your item library is private to you. When you share an item in a cache, its details and private photo are visible only to you and active members of that cache while you are also a member. Request history may retain item details after someone leaves, but does not grant access to the cache or its photos. A cache’s pending item requests are visible to that cache’s members; decided request history and approval messages are limited to the two parties.',
          'Your optional contact method is shared only with the other person on an approved request, while both of you are active members of that request’s cache. A chosen contact email is separate from your sign-in email. Once someone has seen information, the app cannot erase their memory, screenshots or copies.',
        ],
      },
      {
        heading: 'The services that help run the app',
        paragraphs: [
          'Cloudflare provides hosting, the database, private photo storage and the Turnstile bot check. If enabled for administrator sign-in, Cloudflare Access also helps protect that access.',
          'Resend delivers sign-in emails and service notification emails. Notifications use browser push when a live subscription is available, with email as a fallback when none remains. Depending on your browser, push delivery uses services from Apple, Google, Mozilla or Microsoft. Service notifications may include cache and item names, quantities and decision reasons; they do not include your chosen contact method or private approval message.',
          'If you sign in with Google, we receive your Google account email and basic profile to sign you in.',
          'We do not sell your personal data or run ads. The app has no analytics or advertising trackers. If you follow a contact or optional support link to another service, that service’s own privacy policy applies. The app does not handle payments; optional support payments happen on the external provider’s site.',
        ],
      },
      {
        heading: 'Cookies and this browser',
        paragraphs: ['We use strictly necessary session cookies to keep you signed in. Browser storage remembers a saved invite, a sign-in hint, push setup and your cache-opening animation preference. These are app functions, not advertising profiles. You can clear this storage in your browser; doing so may sign you out or reset these settings.'],
      },
      {
        heading: 'Your choices and deletion',
        paragraphs: [
          'In Account, you can change your display name, replace or remove your profile photo, edit or remove your contact method and turn off push. You can edit or delete your own items, replace their photos, or stop sharing them in a cache. Members can leave a cache; its owner cannot leave. Leaving does not delete your private item library or items shared in other caches.',
          'There is no self-serve account deletion yet. Email us to request account deletion or ask about your information. We keep data to operate the app, retain request history and complete notification delivery and photo cleanup; removing something from view is not a promise of instant erasure from every stored record or delivered notification. We do not promise a fixed retention period here.',
        ],
      },
      {
        heading: 'Age, safety and changes',
        paragraphs: [
          'You must be at least 13 to use Communal Cache. It is not intended for children under 13. Contact us if you believe a child under 13 has provided personal information.',
          'Handoffs happen in person. There is no handoff-address field, item-payment processing or return tracking in the app. Please do not put addresses or other sensitive information in item descriptions or photos. No online service can guarantee perfect security.',
          'We may update this policy as the app changes. The effective date above identifies this version. Please check it when deciding what to share.',
        ],
      },
    ],
  },
  terms: {
    title: 'Terms of use',
    introduction: 'A little care makes a shared cupboard work for everyone. By using Communal Cache, you agree to these terms.',
    sections: [
      {
        heading: 'Who can use the app',
        paragraphs: ['You must be at least 13. If you are not old enough to agree to these terms on your own under the law where you live, a parent or guardian must agree for you. Use an email account you control, keep your sign-in links and codes private, and take responsibility for activity on your account.'],
      },
      {
        heading: 'A way to connect, not a lending service',
        paragraphs: [
          'Communal Cache is a directory and an ask-and-approve handshake for lending or giving things within your communities. We do not own, inspect or guarantee listed items. Approval is not a promise that an item is safe or that a handoff will happen.',
          'You are responsible for the items you lend, borrow, give or receive, and for agreeing on safe use, condition and any return arrangements directly with the other person. Plan in-person meetups carefully; younger users should involve a trusted adult. The app does not handle item payments, handoff addresses, deliveries, disputes or returns. A “Lent out” flag is only the owner’s availability note, not return tracking.',
        ],
      },
      {
        heading: 'Be a good neighbor',
        paragraphs: ['Be honest about items and requests, respect other people’s privacy and boundaries, and follow the law. Do not use the app for illegal or dangerous sharing, harassment, discrimination, scams, spam, impersonation or content that infringes someone else’s rights. Do not try to bypass access controls, scrape private information or disrupt the service. Report concerns using the contact below.'],
      },
      {
        heading: 'What you upload and share',
        paragraphs: [
          'You keep ownership of your content. Only upload text and photos you have the right to share. You give us permission to store, display and deliver that content as needed to run the app, including showing shared items to cache members and sending service notifications.',
          'Share thoughtfully: other people may keep information they have already seen. Contact details are optional and are revealed only to the other party on an approved request while both parties remain in that cache. Our privacy policy explains these boundaries and your deletion choices.',
        ],
      },
      {
        heading: 'Access and account restrictions',
        paragraphs: ['Cache owners can approve joins where required and remove members. We reserve the right to restrict or suspend access for misuse, safety concerns, violations of these terms or legal requirements. The app may change or become unavailable. You can stop using it at any time; email us to request account deletion.'],
      },
      {
        heading: 'No warranty; limits on liability',
        paragraphs: [
          'To the extent the law allows, the app is provided “as is” and “as available,” without warranties, including promises of uninterrupted service, accuracy, fitness for a purpose or safety of items or people. You decide whether to trust a listing, use an item or meet another person.',
          'To the extent the law allows, Ryan Zhou is not liable for indirect, incidental, special or consequential losses, lost data or profits, or losses arising from items, sharing arrangements or meetups. Nothing in these terms excludes liability or consumer rights that cannot legally be excluded.',
        ],
      },
      {
        heading: 'Law and future changes',
        paragraphs: ['These terms are governed by the laws of California, USA, except where mandatory law gives you other rights. We may update these terms by posting a new version here with a new effective date. Review changes before continuing to use the app; if you do not agree, stop using it and contact us with any questions.'],
      },
    ],
  },
} as const
