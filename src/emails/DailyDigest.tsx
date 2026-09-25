// import { Html, Head, Body, Container, Section, Heading, Text } from '@react-email/components'
// import { ArticleCard } from './components/ArticleCard'
// import { EmailFooter } from './components/EmailFooter'

// interface CuratedItem {
//   title: string
//   summary: string
//   url: string
//   source?: string
// }

// interface FeaturedPodcast {
//   title: string
//   summary: string
//   url: string
// }

// interface DailyDigestProps {
//   items: CuratedItem[]
//   featuredPodcast?: FeaturedPodcast | null
//   unsubscribeUrl: string
//   date?: string
// }

// export default function DailyDigest({
//   items,
//   featuredPodcast,
//   unsubscribeUrl,
//   date = new Date().toLocaleDateString(),
// }: DailyDigestProps) {
//   return (
//     <Html>
//       <Head />
//       <Body style={{ fontFamily: 'Arial, sans-serif', backgroundColor: '#fff' }}>
//         <Container style={{ maxWidth: '600px', margin: '0 auto' }}>
//           <Section style={{ padding: '24px 0', textAlign: 'center', borderBottom: '2px solid #111' }}>
//             <Heading as="h1" style={{ fontSize: '22px', margin: 0 }}>
//               NBT Newsletter
//             </Heading>
//             <Text style={{ fontSize: '12px', color: '#999' }}>{date}</Text>
//           </Section>

//           {featuredPodcast && (
//             <Section style={{ padding: '24px', backgroundColor: '#fff8f0', borderRadius: '8px' }}>
//               <Text
//                 style={{
//                   fontSize: '12px',
//                   textTransform: 'uppercase',
//                   letterSpacing: '1px',
//                   color: '#d64545',
//                   margin: '0 0 8px',
//                 }}
//               >
//                 🎧 Trending Episode
//               </Text>
//               <Heading as="h2" style={{ fontSize: '20px', margin: '0 0 8px' }}>
//                 {featuredPodcast.title}
//               </Heading>
//               <Text style={{ fontSize: '14px', color: '#444', lineHeight: '1.5' }}>
//                 {featuredPodcast.summary}
//               </Text>
//             </Section>
//           )}

//           {items.map((item, i) => (
//             <ArticleCard key={i} {...item} />
//           ))}

//           <EmailFooter unsubscribeUrl={unsubscribeUrl} />
//         </Container>
//       </Body>
//     </Html>
//   )
// }