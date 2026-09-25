// /**
//  * Footer for the *email* template (`DailyDigest.tsx`).
//  *
//  * Kept separate from `Footer.tsx`, which is the on-page footer: that one
//  * relies on `react-icons` SVGs and the class names in `globals.css`, neither
//  * of which survives most email clients. Everything here is inline-styled.
//  *
//  * This is the implementation that previously lived in `Footer.tsx` as a named
//  * `Footer` export, before that file became the web footer.
//  */

// import { Section, Text, Link } from '@react-email/components'

// interface EmailFooterProps {
//   unsubscribeUrl: string
// }

// export function EmailFooter({ unsubscribeUrl }: EmailFooterProps) {
//   return (
//     <Section style={{ padding: '24px 0', textAlign: 'center' }}>
//       <Text style={{ fontSize: '12px', color: '#999' }}>
//         You&apos;re receiving this because you subscribed to NBT Newsletter.
//       </Text>
//       <Link href={unsubscribeUrl} style={{ fontSize: '12px', color: '#999' }}>
//         Unsubscribe
//       </Link>
//     </Section>
//   )
// }
